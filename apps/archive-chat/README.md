# apps/archive-chat/

Local-only admin CLI for unrestricted archive research. Loads the same corpus Thingy uses, runs BM25 retrieval, and calls the Anthropic API directly with a minimal admin system prompt — no Bedrock, no Thingy persona, no guardrails.

Use this for marketing draft research, editorial pattern-matching, and anything else where the production agent's restraint gets in the way.

## Run

```bash
make librarian-ask                                       # REPL
make librarian-ask ARGS='-q "what recurring themes show up around RSS"'
make librarian-ask ARGS='--brief docs/draft.md --model opus'
make librarian-ask ARGS='--top-k 12 --rebuild'
```

Requires `ANTHROPIC_API_KEY` in `.env`. The corpus is built locally on first run from `apps/site/archive/*.md` (or use `--rebuild` to force).

## Layout

- `archive_chat.py` — single-file CLI; imports `build_corpus` and BM25 helpers from `librarian_core`.
