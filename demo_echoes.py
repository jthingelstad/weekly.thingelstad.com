"""One-off demo: generate Echoes for WT348 + WT349 using the new
compose-echoes pipeline (thesis-anchored, Opus, no SKIP path).

Reads each issue's archive.md from data/issues/{N}/, runs:
  1. compose-thesis-shaped Opus call to derive an issue thesis
  2. compose-echoes pipeline (Thingy retrieve → anniversary candidates
     → prior closers → Opus call) with that thesis as anchor

Prints both outputs side-by-side. No Discord posts, no S3 writes.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO))

from dotenv import load_dotenv
load_dotenv()

from apps.workshop_bot.jobs import compose_echoes
from apps.workshop_bot.tools import thingy_retrieve
from apps.workshop_bot.tools.llm import anthropic_client


def _archive_body(n: int) -> tuple[str, str]:
    """Read the published archive.md for issue N and return (body, publish_date)."""
    path = REPO / "data" / "issues" / str(n) / "archive.md"
    text = path.read_text(encoding="utf-8")
    # Strip front matter
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if m:
        fm = m.group(1)
        body = m.group(2).strip()
        date_m = re.search(r"^publish_date:\s*['\"]?(\d{4}-\d{2}-\d{2})", fm, re.MULTILINE)
        pub = date_m.group(1) if date_m else ""
    else:
        body = text.strip()
        pub = ""
    return body, pub


def generate_thesis(n: int, body: str) -> str:
    """One-shot thesis generation mirroring compose-thesis.run."""
    prompt = anthropic_client.load_prompt("eddy-compose-thesis")
    user_msg = (
        f"{prompt}\n\n---\n\nThe assembled draft for WT{n}:\n\n"
        f"```markdown\n{body[:15000]}\n```"
    )
    response = anthropic_client.client().messages.create(
        model=anthropic_client.MODELS["opus"],
        max_tokens=600,
        messages=[{"role": "user", "content": user_msg}],
    )
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    return text


def generate_echoes(n: int, body: str, pub: str, thesis: str) -> str:
    """Run the compose-echoes pipeline for issue N, off-Discord."""
    # Mirror compose_echoes.run's content gathering
    prior = compose_echoes._prior_closers(n)
    passages = compose_echoes._retrieve_passages(body[:15000], n)
    anniversaries = compose_echoes._anniversary_candidates(pub or "2026-01-01", n)
    user_body = compose_echoes._build_user_message(
        issue_number=n,
        publish_date=pub or "(unknown)",
        baseline_body=body[:15000],
        prior=prior,
        passages=passages,
        anniversaries=anniversaries,
        thesis=thesis,
    )
    base_prompt = anthropic_client.load_prompt("eddy-compose-echoes")
    user_msg = f"{base_prompt}\n\n---\n\n{user_body}"[:60000]
    response = anthropic_client.client().messages.create(
        model=anthropic_client.MODELS["opus"],
        max_tokens=1500,
        messages=[{"role": "user", "content": user_msg}],
    )
    text = "".join(b.text for b in response.content if b.type == "text")
    cleaned = compose_echoes._clean_closer(text)
    linked = compose_echoes._linkify_archive_refs(cleaned)
    return linked


def main():
    for n in (348, 349):
        print(f"\n{'='*70}\nWT{n}\n{'='*70}")
        try:
            body, pub = _archive_body(n)
        except FileNotFoundError:
            print(f"  ❌ no archive.md found for WT{n}")
            continue
        print(f"  archive body: {len(body):,} chars · publish_date: {pub or '(unknown)'}")
        print(f"\n  → generating thesis (Opus, ~600 tok)...")
        thesis = generate_thesis(n, body)
        print(f"\n  ## Thesis (Eddy)\n  {thesis}\n")
        print(f"  → generating Echoes (Opus, thesis-anchored, with retrieve + anniversaries)...")
        try:
            echoes = generate_echoes(n, body, pub, thesis)
        except thingy_retrieve.ThingyRetrieveError as exc:
            print(f"  ❌ Thingy retrieval failed: {exc}")
            continue
        print(f"\n  ## Echoes (Thingy)\n  {echoes}\n")


if __name__ == "__main__":
    main()
