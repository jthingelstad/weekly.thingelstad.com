# weekly.thingelstad.com

Source for [The Weekly Thing](https://weekly.thingelstad.com), a newsletter Jamie has published every weekend since May 2017. This repo produces several deliverables that share the same archive corpus.

## What lives where

| Path | What it produces |
|---|---|
| `apps/site/` | Eleventy static site — landing page, archive, feeds. Deployed to GitHub Pages. |
| `apps/librarian/` | Thingy — the AWS Lambda agent that answers questions against the archive. Source under `lambda/`, infra under `infra/`, operator scripts under `admin/` (scaffolding). |
| `apps/workshop_bot/` | Five-bot Discord workshop (Eddy, Linky, Marky, Patty + Thingy bridge) for newsletter authoring assistance and reader Q&A. |
| `librarian-core/` | Shared Python package: corpus loader, BM25 retrieval, graph builder. Installed editable. |
| `pipeline/content/` | Build `apps/site/archive/` from `data/issues/`, refresh subscriber stats, and the Buttondown publish helper workshop_bot wraps. |
| `pipeline/corpus/` and `pipeline/graph/` | CLI wrappers around `librarian_core` builders. |
| `pipeline/deploy/` | AWS deploy, corpus/graph upload, Bedrock logging config. |
| `pipeline/audio/`, `pipeline/audits/`, `pipeline/one-shot/` | Domain-specific pipelines and historical cleanup scripts. |
| `data/issues/{N}/` | **Canonical issue store.** archive.md (editorial body + front matter), metadata.json, links.json, transcript/NNN-*.txt. Written by workshop_bot's ship sequence via the GitHub Git Data API. |
| `data/{librarian,audio,links}/` | Generated build artifacts. |
| `content/buttondown/` | Author-managed Buttondown configuration: automation bodies, newsletter CSS, transactional templates. Hand-synced to Buttondown; no automation. |
| `docs/` | Operator guides, audit snapshots, creative brief, email CSS. |

For deeper detail see [`CLAUDE.md`](CLAUDE.md) (architecture overview), [`apps/workshop_bot/CLAUDE.md`](apps/workshop_bot/CLAUDE.md) (the workshop runtime, including the ship sequence), and [`docs/librarian.md`](docs/librarian.md) (Thingy's runtime, env vars, deploy checklist).

## Quick start

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && npm install

make serve              # regenerate archive from data/issues/, then 11ty serves
make build              # full production build
make stats              # refresh subscriber count + Stripe balance
```

Issues are committed by workshop_bot (`/eddy issue send`), not pulled from Buttondown. The website is the canonical archive; Buttondown is the email delivery channel only.

See the per-app README in each `apps/*/` directory for app-specific notes.
