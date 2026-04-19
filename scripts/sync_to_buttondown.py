"""Sync local .md edits back to the Buttondown API."""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv

# Stream progress in real time when piped through tee, logged to CI, etc.
sys.stdout.reconfigure(line_buffering=True)

load_dotenv()

SRC_DIR = Path(__file__).parent.parent / "src"
ARCHIVE_DIR = SRC_DIR / "archive"
CACHE_FILE = Path(__file__).parent.parent / "cache" / "emails.json"
API_BASE = "https://api.buttondown.com/v1"


def get_headers():
    api_key = os.environ.get("BUTTONDOWN_API_KEY")
    if not api_key:
        raise RuntimeError("BUTTONDOWN_API_KEY environment variable is required")
    return {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json",
    }


def parse_md_file(file_path):
    """Parse a .md file into front matter dict and body string."""
    content = file_path.read_text()

    # Split front matter from body
    match = re.match(r"^---\n(.+?)\n---\n(.*)", content, re.DOTALL)
    if not match:
        return None, None

    fm = yaml.safe_load(match.group(1))
    body = match.group(2).strip()

    # Remove {% raw %} / {% endraw %} wrappers if present
    body = re.sub(r"^\{%\s*raw\s*%\}\n?", "", body)
    body = re.sub(r"\n?\{%\s*endraw\s*%\}$", "", body)

    return fm, body


def load_cached_emails():
    """Load the cached API response to compare against."""
    if not CACHE_FILE.exists():
        print("Error: No cached emails found. Run 'make data' first.")
        sys.exit(1)

    with open(CACHE_FILE) as f:
        emails = json.load(f)

    # Index by ID
    return {e["id"]: e for e in emails}


def find_changes(issue_number=None):
    """Find .md files that differ from the cached API data."""
    cached = load_cached_emails()
    changes = []

    if issue_number:
        files = [ARCHIVE_DIR / f"{issue_number}.md"]
    else:
        files = sorted(ARCHIVE_DIR.glob("*.md"))

    for file_path in files:
        if not file_path.exists():
            print(f"Warning: {file_path.name} not found, skipping.")
            continue

        fm, body = parse_md_file(file_path)
        if fm is None:
            continue

        buttondown_id = fm.get("buttondown_id")
        if not buttondown_id or buttondown_id not in cached:
            continue

        original = cached[buttondown_id]
        original_body = original.get("body", "")

        diff = {}
        if body != original_body:
            diff["body"] = body
        if fm.get("subject") != original.get("subject"):
            diff["subject"] = fm["subject"]
        if fm.get("description") != original.get("description"):
            diff["description"] = fm["description"]
        # Sync image field (allows clearing the profile headshot from legacy issues)
        local_image = fm.get("image") or ""
        original_image = original.get("image") or ""
        if local_image != original_image:
            diff["image"] = local_image

        if diff:
            changes.append(
                {
                    "file": file_path.name,
                    "number": fm.get("number"),
                    "buttondown_id": buttondown_id,
                    "subject": fm.get("subject"),
                    "changes": diff,
                }
            )

    return changes


def _patch_with_retry(url, headers, fields, max_attempts=5):
    """PATCH with Retry-After-aware backoff on 429. Returns the final response,
    or None if all attempts were rate-limited."""
    for attempt in range(max_attempts):
        resp = requests.patch(url, headers=headers, json=fields)
        if resp.status_code != 429:
            return resp
        retry_after = resp.headers.get("Retry-After", "5")
        try:
            wait = max(1, int(retry_after))
        except ValueError:
            wait = 5
        print(f"    429 rate-limited; sleeping {wait}s (attempt {attempt + 1}/{max_attempts})")
        time.sleep(wait)
    return None


def push_changes(changes, dry_run=False):
    """Push changes to the Buttondown API."""
    headers = get_headers()

    for change in changes:
        bid = change["buttondown_id"]
        subject = change["subject"]
        fields = change["changes"]

        field_names = ", ".join(fields.keys())
        print(f"\n  #{change['number']} ({subject})")
        print(f"    Changed fields: {field_names}")

        if "body" in fields:
            body_preview = fields["body"][:80].replace("\n", " ")
            print(f"    Body preview: {body_preview}...")

        if dry_run:
            print("    [DRY RUN] Would update via API")
            continue

        # Validate: never push empty body
        if "body" in fields and not fields["body"].strip():
            print("    ERROR: Refusing to push empty body. Skipping.")
            continue

        url = f"{API_BASE}/emails/{bid}"
        resp = _patch_with_retry(url, headers, fields)

        if resp is None:
            print("    ERROR: giving up after repeated rate-limit retries.")
            continue
        if not resp.ok:
            print(f"    ERROR: {resp.status_code} — {resp.text[:200]}")
            continue

        # Surface a warning when we're approaching the rate limit
        remaining = resp.headers.get("X-RateLimit-Remaining")
        if remaining and remaining.isdigit() and int(remaining) < 50:
            reset = resp.headers.get("X-RateLimit-Reset", "?")
            print(f"    (rate limit remaining={remaining}, resets at {reset})")

        # Verify the response reflects what we sent
        returned = resp.json()
        mismatches = []
        for key, sent_val in fields.items():
            got_val = returned.get(key)
            if (sent_val or "") != (got_val or ""):
                mismatches.append(
                    f"{key}: sent {sent_val!r:.60} got {got_val!r:.60}"
                )
        if mismatches:
            print("    WARNING: API response did not reflect sent values:")
            for m in mismatches:
                print(f"      {m}")
        else:
            print(f"    Updated successfully ({field_names})")


def main():
    parser = argparse.ArgumentParser(description="Sync local edits back to Buttondown")
    parser.add_argument("--issue", type=int, help="Sync a specific issue number")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without making API calls",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="After syncing, refresh the local cache",
    )
    parser.add_argument(
        "--yes", action="store_true", help="Skip confirmation prompt"
    )
    args = parser.parse_args()

    changes = find_changes(issue_number=args.issue)

    if not changes:
        print("No changes detected.")
        return

    print(f"Found {len(changes)} changed issue(s):")
    push_changes(changes, dry_run=args.dry_run or not args.yes)

    if not args.dry_run and not args.yes:
        print(
            "\nThis was a dry run. To push changes, run with --yes or confirm interactively."
        )

    if args.refresh and not args.dry_run:
        print("\nRefreshing local cache...")
        import fetch_emails

        fetch_emails.fetch(no_cache=True)
        print("Cache refreshed.")


if __name__ == "__main__":
    main()
