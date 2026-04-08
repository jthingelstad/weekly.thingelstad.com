"""Orchestrator: fetch emails from Buttondown, process them, and write output files."""

import json
import sys
from pathlib import Path

# Add scripts dir to path so we can import siblings
sys.path.insert(0, str(Path(__file__).parent))

import yaml

import fetch_emails
import process_emails

SRC_DIR = Path(__file__).parent.parent / "src"
DATA_DIR = SRC_DIR / "_data"
ARCHIVE_DIR = SRC_DIR / "archive"


def write_emails_json(issues):
    """Write the lightweight metadata index (no body content)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    index = []
    for issue in issues:
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
        }
        index.append(entry)

    output_path = DATA_DIR / "emails.json"
    with open(output_path, "w") as f:
        json.dump(index, f, indent=2)

    print(f"Wrote {len(index)} entries to {output_path}")


def write_archive_md(issues):
    """Write individual .md files for each issue with YAML front matter."""
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    # Clean up stale .md files not in current issue set (skip archive.njk)
    current_filenames = {f"{issue['number']}.md" for issue in issues}
    for existing in ARCHIVE_DIR.glob("*.md"):
        if existing.name not in current_filenames:
            print(f"  Removing stale archive file: {existing.name}")
            existing.unlink()

    for issue in issues:
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
            "permalink": f"/archive/{issue['number']}/",
            "tags": "issue",
        }

        # Build the file content
        # Use yaml.dump for front matter, preserving unicode
        fm_str = yaml.dump(
            front_matter,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
            width=1000,
        )

        body = issue.get("body", "")

        # Wrap body in {% raw %} / {% endraw %} to prevent Nunjucks
        # from processing Buttondown template tags
        content = f"---\n{fm_str}---\n{{% raw %}}\n{body}\n{{% endraw %}}\n"

        file_path = ARCHIVE_DIR / f"{issue['number']}.md"
        with open(file_path, "w") as f:
            f.write(content)

    print(f"Wrote {len(issues)} archive files to {ARCHIVE_DIR}")


def main():
    no_cache = "--no-cache" in sys.argv or "--fresh" in sys.argv

    print("=" * 60)
    print("The Weekly Thing — Data Pipeline")
    print("=" * 60)

    # Step 1: Fetch
    print("\n[1/3] Fetching emails...")
    raw_emails = fetch_emails.fetch(no_cache=no_cache)

    # Step 2: Process
    print(f"\n[2/3] Processing {len(raw_emails)} emails...")
    issues = process_emails.process(raw_emails)

    # Step 3: Write outputs
    print(f"\n[3/3] Writing output files for {len(issues)} issues...")
    write_emails_json(issues)
    write_archive_md(issues)

    print(f"\nDone! {len(issues)} issues processed.")
    print(f"  Latest: #{issues[-1]['number']} — {issues[-1]['subject']}")


if __name__ == "__main__":
    main()
