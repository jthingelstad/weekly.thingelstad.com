# weekly.thingelstad.com

Source for [The Weekly Thing](https://weekly.thingelstad.com), a newsletter Jamie has published every weekend since May 2017. This repo produces several deliverables that share the same archive corpus.

## What lives where

| Path | What it produces |
|---|---|
| `apps/site/` | Eleventy static site — landing page, archive, feeds. Deployed to GitHub Pages. |
| `apps/librarian/` | Thingy — the AWS Lambda agent that answers questions against the archive. Source under `lambda/`, infra under `infra/`, operator scripts under `admin/` (scaffolding). |
| `apps/workshop_bot/` | Five-bot Discord workshop (Eddy, Linky, Marky, Patty + Thingy bridge) for newsletter authoring assistance and reader Q&A. |
| `librarian-core/` | Shared Python package: corpus loader, BM25 retrieval, graph builder. Installed editable. |
| `pipeline/content/` | Buttondown pull/build/diff/push and marketing copy refresh. |
| `pipeline/corpus/` and `pipeline/graph/` | CLI wrappers around `librarian_core` builders. |
| `pipeline/deploy/` | AWS deploy, corpus/graph upload, Bedrock logging config. |
| `pipeline/audio/`, `pipeline/audits/`, `pipeline/one-shot/` | Domain-specific pipelines and historical cleanup scripts. |
| `data/buttondown/` | Editable Buttondown source: bodies, emails, manifest. Pulled from Buttondown, edited locally, pushed back. |
| `data/{librarian,audio,links}/` | Generated build artifacts. |
| `content/buttondown/` | Author-managed Buttondown configuration: automation bodies, newsletter CSS, transactional templates. Hand-synced to Buttondown; no automation. |
| `docs/` | Operator guides, audit snapshots, creative brief, email CSS. |

For deeper detail see [`CLAUDE.md`](CLAUDE.md) (architecture overview) and [`docs/`](docs/) — particularly [`docs/content-pipeline.md`](docs/content-pipeline.md) for the Buttondown sync workflow and [`docs/librarian.md`](docs/librarian.md) for Thingy's runtime, env vars, and deploy checklist.

## Quick start

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && npm install

make serve              # local dev server
make build              # full production build
make content-pull       # fetch latest from Buttondown, then rebuild generated data
```

See the per-app README in each `apps/*/` directory for app-specific notes.
