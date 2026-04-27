"""Evaluate live Thingy answer quality with OpenAI and local retrieval.

This runs the same local retrieval and answer-generation path used by the
Lambda, then asks a separate OpenAI call to score whether the answer is useful,
grounded, conversational, and insightful.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import sys
import time
from pathlib import Path
from statistics import mean
from typing import Any

import httpx


QUESTIONS = [
    "What has Jamie been trying to figure out about AI agents lately?",
    "How has Jamie's thinking about RSS and the open web changed over time?",
    "If I care about privacy, what should I read first in the archive?",
    "What are the recurring themes around travel and place?",
    "What has changed in Jamie's productivity and personal systems over the years?",
    "Where does the archive show tension between convenience and control?",
    "What should I revisit if I want a hopeful thread about the web?",
    "What does the archive suggest about software becoming more fluid?",
]

RUBRIC = """
Score from 1 to 5 on each dimension:
- grounded: answer uses archive evidence and citations without inventing unsupported claims.
- insight: answer synthesizes patterns, tensions, or evolution instead of summarizing mechanically.
- voice: answer sounds like Thingy: a personal, genuine, friendly librarian for The Weekly Thing, not a generic bot or enterprise search assistant.
- usefulness: answer gives a reader concrete orientation or next reading steps.
- specificity: answer names concrete ideas from the sources, not generic categories.
Penalize answers that end with customer-support phrasing like "if you want", "should I", or "which would you prefer".

Return only JSON:
{"grounded":0,"insight":0,"voice":0,"usefulness":0,"specificity":0,"overall":0,"notes":"...","missing":"..."}
"""


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip().strip("'\""))


def extract_openai_text(data: dict[str, Any]) -> str:
    if data.get("output_text"):
        return str(data["output_text"])
    parts = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"}:
                parts.append(content.get("text", ""))
    return "\n".join(part for part in parts if part)


def extract_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError(f"No JSON object in evaluator response: {text[:200]}")
    return json.loads(match.group(0))


def evaluate_answer(question: str, answer: str, sources: list[dict[str, Any]], model: str) -> dict[str, Any]:
    source_lines = []
    for source in sources[:10]:
        source_lines.append(
            f"#{source.get('issue_number')} {str(source.get('publish_date') or '')[:10]} "
            f"{source.get('section')}: {source.get('subject')} | {source.get('text', '')[:700]}"
        )
    payload = {
        "model": model,
        "instructions": "You are a strict evaluator for an archive RAG assistant. Be fair but demanding.",
        "input": (
            f"{RUBRIC}\n\nQuestion:\n{question}\n\nAnswer:\n{answer}\n\n"
            "Retrieved sources:\n" + "\n\n".join(source_lines)
        ),
        "reasoning": {"effort": "low"},
        "text": {"verbosity": "low"},
        "max_output_tokens": 700,
    }
    response = httpx.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
            "content-type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    result = extract_json(extract_openai_text(response.json()))
    for key in ["grounded", "insight", "voice", "usefulness", "specificity", "overall"]:
        result[key] = float(result.get(key, 0))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--sample-limit", type=int, default=len(QUESTIONS))
    parser.add_argument("--answer-model", default=os.environ.get("OPENAI_MODEL", "gpt-5-mini"))
    parser.add_argument("--judge-model", default=os.environ.get("OPENAI_EVAL_MODEL", "gpt-5-mini"))
    parser.add_argument("--output", default="tmp/librarian-answer-eval.json")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    os.environ.setdefault("SESSION_SECRET", "eval-only")
    os.environ["OPENAI_MODEL"] = args.answer_model
    sys.path.insert(0, str(root))
    app = importlib.import_module("librarian_api.app")

    results = []
    for index, question in enumerate(QUESTIONS[: args.sample_limit], 1):
        print(f"\n[{index}/{min(args.sample_limit, len(QUESTIONS))}] {question}")
        started = time.perf_counter()
        sources = app.retrieve(question, limit=args.limit)
        answer = app.call_openai(question, sources)
        score = evaluate_answer(question, answer, sources, args.judge_model)
        elapsed = round(time.perf_counter() - started, 2)
        result = {
            "question": question,
            "answer": answer,
            "sources": [
                {
                    "issue_number": source.get("issue_number"),
                    "date": str(source.get("publish_date") or "")[:10],
                    "section": source.get("section"),
                    "subject": source.get("subject"),
                    "age_label": source.get("age_label"),
                    "source_kind": source.get("source_kind"),
                    "modes": source.get("retrieval_modes", []),
                }
                for source in sources
            ],
            "score": score,
            "elapsed_seconds": elapsed,
        }
        print(
            "overall={overall:.1f} insight={insight:.1f} voice={voice:.1f} usefulness={usefulness:.1f} "
            "{notes}".format(**score)
        )
        if score.get("missing"):
            print(f"missing: {score['missing']}")
        results.append(result)

    summary = {
        "answer_model": args.answer_model,
        "judge_model": args.judge_model,
        "averages": {
            key: round(mean(item["score"][key] for item in results), 2)
            for key in ["grounded", "insight", "voice", "usefulness", "specificity", "overall"]
        },
        "results": results,
    }
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("\nAverages:", json.dumps(summary["averages"], indent=2))
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
