"""Print retrieval diagnostics for a small librarian RAG question set."""

from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path


QUESTIONS = [
    "What has Jamie said about AI agents recently?",
    "How has Jamie's thinking about RSS changed over time?",
    "What does the archive say about privacy and security?",
    "What themes show up around travel and place?",
    "What has changed in productivity and personal systems over the years?",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    os.environ.setdefault("SESSION_SECRET", "eval-only")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    app = importlib.import_module("librarian_api.app")
    for question in QUESTIONS:
        print(f"\n## {question}")
        for source in app.retrieve(question, limit=args.limit):
            modes = ",".join(source.get("retrieval_modes", []))
            topics = ", ".join(source.get("topics", [])[:3])
            print(
                f"- #{source.get('issue_number')} "
                f"{str(source.get('publish_date') or '')[:10]} "
                f"{source.get('source_kind', 'chunk')} "
                f"[{modes}] "
                f"{source.get('section')}: {source.get('subject')} "
                f"({source.get('age_label', '')}; {topics})"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
