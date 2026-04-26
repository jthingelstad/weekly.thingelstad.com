"""Fetch only the latest email from Buttondown and add it to the archive."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import requests
import yaml
from dotenv import load_dotenv

import process_emails
import fetch_emails

load_dotenv()

SRC_DIR = Path(__file__).parent.parent / "src"
DATA_DIR = SRC_DIR / "_data"
ARCHIVE_DIR = SRC_DIR / "archive"


def load_existing_stats():
    """Load committed stats so transient API failures do not zero them out."""
    stats_path = DATA_DIR / "stats.json"
    if not stats_path.exists():
        return {}
    with open(stats_path) as f:
        return json.load(f)


def fetch_latest_email():
    """Fetch just the most recent sent, public email from Buttondown."""
    headers = fetch_emails.get_headers()
    resp = requests.get(
        f"{fetch_emails.API_BASE}/emails",
        headers=headers,
        params={"status": "sent", "email_type": "public", "page_size": 1},
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        print("No emails found.")
        sys.exit(0)
    return results[0]


def main():
    skip_existing = "--skip-existing" in sys.argv

    print("=" * 60)
    print("The Weekly Thing — Fetch Latest Issue")
    print("=" * 60)

    # Fetch latest email
    print("\nFetching latest email from Buttondown...")
    email = fetch_latest_email()
    print(f"  Got: {email.get('subject', '(no subject)')}")

    # Process it through the same pipeline as a single-item list
    print("Processing...")
    issues = process_emails.process([email])
    if not issues:
        print("No issues produced.")
        sys.exit(1)
    issue = issues[0]

    # Check if this issue already exists
    md_path = ARCHIVE_DIR / f"{issue['number']}.md"
    if md_path.exists():
        if skip_existing:
            print(f"Issue #{issue['number']} already exists at {md_path}; nothing to do.")
            sys.exit(0)
        print(f"Issue #{issue['number']} already exists at {md_path}, updating.")

    # Write the archive .md file
    front_matter = {
        "layout": "layouts/issue.njk",
        "buttondown_id": issue["id"],
        "number": issue["number"],
        "subject": issue["subject"],
        "publish_date": issue["publish_date"],
        "slug": issue["slug"],
        "description": issue["description"],
        "image": issue["image"],
        "absolute_url": issue["absolute_url"],
        "domains": issue["domains"],
        "links": issue["links"],
        "word_count": issue.get("word_count", 0),
        "permalink": f"/archive/{issue['number']}/",
        "tags": "issue",
    }

    fm_str = yaml.dump(
        front_matter,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
        width=1000,
    )

    body = issue.get("body", "")
    content = f"---\n{fm_str}---\n{{% raw %}}\n{body}\n{{% endraw %}}\n"

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with open(md_path, "w") as f:
        f.write(content)
    print(f"Wrote {md_path}")

    # Update emails.json — add or replace this issue's entry
    emails_path = DATA_DIR / "emails.json"
    index = []
    if emails_path.exists():
        with open(emails_path) as f:
            index = json.load(f)

    entry = {
        "id": issue["id"],
        "number": issue["number"],
        "subject": issue["subject"],
        "publish_date": issue["publish_date"],
        "slug": issue["slug"],
        "description": issue["description"],
        "image": issue["image"],
        "absolute_url": issue["absolute_url"],
        "domains": issue["domains"],
        "links": issue["links"],
        "notable_links": issue.get("notable_links", []),
        "briefly_links": issue.get("briefly_links", []),
        "word_count": issue.get("word_count", 0),
    }

    # Replace if exists, append if new
    replaced = False
    for i, existing in enumerate(index):
        if existing.get("number") == issue["number"]:
            index[i] = entry
            replaced = True
            break
    if not replaced:
        index.append(entry)
        # Keep sorted by publish_date
        index.sort(key=lambda e: e.get("publish_date", ""))

    with open(emails_path, "w") as f:
        json.dump(index, f, indent=2)
    print(f"Updated {emails_path} ({len(index)} entries)")

    # Update stats
    existing_stats = load_existing_stats()

    print("Fetching subscriber stats...")
    try:
        headers = fetch_emails.get_headers()
        subscriber_count = fetch_emails.fetch_subscriber_count(headers)
        premium_count = fetch_emails.fetch_premium_subscriber_count(headers)
    except Exception as e:
        print(f"  Warning: Could not fetch subscriber stats: {e}")
        subscriber_count = existing_stats.get("subscriber_count", 0)
        premium_count = existing_stats.get("premium_subscriber_count", 0)

    print("Fetching Stripe balance...")
    try:
        amount_raised = fetch_emails.fetch_stripe_balance()
    except Exception as e:
        print(f"  Warning: Could not fetch Stripe balance: {e}")
        amount_raised = existing_stats.get("amount_raised", 0)

    stats_path = DATA_DIR / "stats.json"
    stats = {
        "subscriber_count": subscriber_count,
        "premium_subscriber_count": premium_count,
        "amount_raised": round(amount_raised, 2),
    }
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"\nDone! Issue #{issue['number']} — {issue['subject']}")


if __name__ == "__main__":
    main()
