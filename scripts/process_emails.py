"""Process raw Buttondown email data: extract links, assign issue numbers, write output files."""

import re
from urllib.parse import urlparse

from domain_exclusions import is_excluded


def _add_link(links, text, url, heading_context):
    """Helper to validate and add a link to the list."""
    if not url or url.startswith("#") or url.startswith("mailto:"):
        return
    try:
        parsed = urlparse(url)
        domain = parsed.hostname or ""
        domain = domain.lower()
    except Exception:
        return
    if domain:
        links.append(
            {
                "text": text,
                "url": url,
                "domain": domain,
                "heading_context": heading_context,
            }
        )


def extract_links(markdown_body):
    """Extract links from markdown content.

    Handles three link formats found across the archive:
    - Markdown links: [text](url)
    - HTML links: <a href="url">text</a>
    - Bare URLs in parentheses: Title (https://example.com) — used in early TinyLetter-era issues

    Returns list of dicts: {text, url, domain, heading_context}
    """
    links = []
    current_heading = None
    seen_urls = set()

    for line in markdown_body.split("\n"):
        # Track current heading for context
        heading_match = re.match(r"^#{1,6}\s+(.+)", line)
        if heading_match:
            current_heading = heading_match.group(1).strip()

        # 1. Markdown links: [text](url)
        for match in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)", line):
            text = match.group(1).strip()
            url = match.group(2).strip()
            if url not in seen_urls:
                seen_urls.add(url)
                _add_link(links, text, url, current_heading)

        # 2. HTML links: <a href="url">text</a>
        for match in re.finditer(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', line, re.IGNORECASE):
            url = match.group(1).strip()
            text = re.sub(r"<[^>]+>", "", match.group(2)).strip()
            if url not in seen_urls:
                seen_urls.add(url)
                _add_link(links, text, url, current_heading)

        # 3. Bare URLs in parentheses: Title (https://example.com)
        for match in re.finditer(r"\(\s*(https?://[^\s)]+)\s*\)", line):
            url = match.group(1).strip()
            if url not in seen_urls:
                seen_urls.add(url)
                _add_link(links, "", url, current_heading)

    return links


def extract_domains(links):
    """Extract unique, non-excluded FQDNs from a list of link dicts."""
    domains = set()
    for link in links:
        domain = link.get("domain", "")
        if domain and not is_excluded(domain):
            domains.add(domain)
    return sorted(domains)


def extract_subject_number(subject):
    """Extract the issue number from the email subject line.

    Matches patterns like:
      "Weekly Thing #42 / ..."
      "Weekly Thing 343 / ..."
      "Special Thing #140 / ..."
      "Weekly Thing #2^8 / ..." → 256
    """
    # Handle exponential notation (e.g., #2^8 = 256)
    m_exp = re.search(r"(?:Weekly|Special)\s+Thing\s*#?\s*(\d+)\^(\d+)", subject)
    if m_exp:
        return int(m_exp.group(1)) ** int(m_exp.group(2))

    m = re.search(r"(?:Weekly|Special)\s+Thing\s*#?\s*(\d+)", subject)
    if m:
        return int(m.group(1))
    return None


def is_special_issue(subject):
    """Check if this is a 'Special Thing' bonus issue (not a regular weekly issue)."""
    return subject.strip().lower().startswith("special thing")


def assign_issue_numbers(emails):
    """Assign issue numbers to emails.

    Sort by publish_date ascending (oldest first).
    Extract issue number from subject line when available.
    For early issues without numbers in subjects, auto-number sequentially by date.
    Special issues (e.g., "Special Thing #140") get a string suffix to avoid collision.
    """
    sorted_emails = sorted(emails, key=lambda e: e.get("publish_date", ""))

    # First pass: extract subject numbers
    numbered = []
    for email in sorted_emails:
        subject = email.get("subject", "")
        subj_num = extract_subject_number(subject)
        special = is_special_issue(subject)
        numbered.append((subj_num, special, email))

    # Collect all regular issue numbers to detect collisions
    regular_numbers = set()
    for subj_num, special, email in numbered:
        if subj_num is not None and not special:
            regular_numbers.add(subj_num)

    # Second pass: assign final numbers
    auto_number = 1
    result = []
    for subj_num, special, email in numbered:
        if subj_num is not None:
            if special and subj_num in regular_numbers:
                # Special issue collides with a regular issue — use string suffix
                result.append((f"{subj_num}-special", email))
            else:
                result.append((subj_num, email))
        else:
            result.append((auto_number, email))
            auto_number += 1

    return result


def process(emails):
    """Process raw email data into structured issue data.

    Returns list of dicts ready for output, sorted by number ascending.
    """
    numbered_emails = assign_issue_numbers(emails)
    issues = []

    for number, email in numbered_emails:
        body = email.get("body", "")
        links = extract_links(body)
        domains = extract_domains(links)

        issue = {
            "id": email.get("id", ""),
            "number": number,
            "subject": email.get("subject", ""),
            "publish_date": email.get("publish_date", ""),
            "slug": email.get("slug", ""),
            "description": email.get("description", ""),
            "image": email.get("image"),
            "absolute_url": email.get("absolute_url", ""),
            "body": body,
            "domains": domains,
            "links": links,
        }
        issues.append(issue)

    # Sort by number ascending (special issues like "140-special" sort after their base number)
    def sort_key(issue):
        n = issue["number"]
        if isinstance(n, int):
            return (n, "")
        # String like "140-special" — sort after the base number
        base = int(re.match(r"(\d+)", str(n)).group(1))
        return (base, str(n))

    issues.sort(key=sort_key)
    return issues
