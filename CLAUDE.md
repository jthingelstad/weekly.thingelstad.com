# Project memory — weekly.thingelstad.com

Operational notes for working in this repo as Claude. Human-facing overview lives in
[`README.md`](README.md). Site detail: [`apps/site/CLAUDE.md`](apps/site/CLAUDE.md).

## What this repo is — a render surface

**Studio (`studio-thing`) is the brain; this repo renders.** The editorial source of truth
(`data/issues/{N}/archive.md`), the authoring agents (`workshop_bot`), the Librarian/Thingy Lambda, the
corpus, and the whole publishing pipeline live in Studio. This repo builds the 11ty site from inputs
Studio generates and commits here, and deploys to GitHub Pages.

Do not look for the pipeline, the agents, `data/issues`, or `librarian-core` here — they're gone (moved
to Studio). The architecture model lives in `studio-thing/ALIGNMENT.md`; the producer workflow + handoff
in `studio-thing/PHASE_1.md` and `pipeline/deploy/push_site_inputs.py` (in Studio).

## The handoff — what Studio pushes in

On each ship, Studio's CI builds and commits these to this repo as one atomic commit (which triggers the
render below):

- `apps/site/archive/{N}.md` — generated issue pages.
- `apps/site/_data/emails.json` — lightweight issue index.
- `apps/site/_data/status.json` — pipeline state for `/ops/`.
- `data/librarian/graph.json` — topic graph for the topic pages.

**Never edit `apps/site/archive/*.md` (or the pushed `_data` files) here.** They're regenerated upstream
and overwritten by the next handoff. Editorial fixes go in `studio-thing/data/issues/{N}/archive.md`.

## Data files in `apps/site/_data/`

- **Pushed by Studio** (don't hand-edit): `emails.json`, `status.json` (and `data/librarian/graph.json`).
- **Owned by this repo:** `stats.json` — subscriber + Stripe figures, fetched by *weekly's own CI* (a
  landing-page presentation concern). Studio reads the same figures separately, for agent analysis — a
  different concern, so both holding access is by design.
- **Hand-authored** (edit directly): `site.json`, `support.json`, `quotes.json`, `survey.json`,
  `faq.json`, `redirects.json`.

`archiveStats.js` computes stats at build time from `emails.json` (records, streaks, per-year breakdowns).

## GitHub Actions — `.github/workflows/deploy.yml`

Render-only. Triggered by push to `main` (Studio's handoff commit) + manual `workflow_dispatch`. Steps:
`npm ci` → fetch landing-page stats → `npm run build` (11ty) → `npm run build:search` (Pagefind) →
install Playwright Chromium → `npm run test:e2e` → upload + deploy to GitHub Pages. No Python, no
Lambda, no corpus build — those run in Studio.

## Secrets

This repo holds only what its own concerns need — the credentials for the landing-page stats fetch.
Production secrets (Buttondown publish, OpenAI, AWS, Librarian) live in Studio. Pages deploys with the
default `GITHUB_TOKEN`.

## Conventions worth knowing (site-only)

- **Pagefind UI** reset blocks CSS overrides — use `!important`. `data-pagefind-filter` survives until
  reindex.
- **Tinylytics kudos** overwrites innerHTML — render heart/label via CSS `::before` so they survive.
- **Don't hand-edit generated files** (`apps/site/archive/*.md`, the pushed `_data/*.json`,
  `data/librarian/graph.json`) — fix upstream in Studio.
- **e2e tests** (`tests/e2e/`) are Playwright specs against the rendered site + Thingy redirects. The
  deploy workflow installs Chromium and runs them before uploading the Pages artifact.

## Pointer to Studio

Editorial process, the agents, the publishing eras + link-extraction rules, the Buttondown config, the
Lambda runtime, and all production conventions now live in the **Studio** repo. Start at
`studio-thing/README.md` and `studio-thing/CLAUDE.md`.
