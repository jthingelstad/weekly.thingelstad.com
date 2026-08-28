# Repository guide — weekly.thingelstad.com

Operational notes for working in this repo. Human-facing overview lives in
[`README.md`](README.md). Site detail: [`apps/site/CLAUDE.md`](apps/site/CLAUDE.md).

## What this repo is — a render surface

**WT Builder (`wt-builder`) publishes; `librarian-thing` keeps the archive; this repo renders.**
WT Builder authors each issue and commits the 11ty inputs here on send. The canonical issue store
(`data/issues/{N}/archive.md`), the corpus, and the Librarian/Thingy Lambda live in `librarian-thing`
(renamed from `studio-thing` 2026-08-28; the Studio application is retired). This repo builds the 11ty
site from the committed inputs and deploys to GitHub Pages.

Do not look for the pipeline, `data/issues`, or `librarian-core` here — they're upstream. The
architecture model lives in `librarian-thing/ALIGNMENT.md`; the website handoff in WT Builder's
`src/server/publish.ts`.

## The handoffs — what gets pushed in

WT Builder's website send commits these as one atomic commit (which triggers the render below):

- `apps/site/archive/{N}.md` — generated issue pages.
- `apps/site/_data/emails.json` — lightweight issue index.

`librarian-thing` pushes one file on corpus rebuilds:

- `data/librarian/graph.json` — topic graph for the topic pages.

`apps/site/_data/status.json` is a frozen snapshot of the retired Studio pipeline; `/ops/` reads it and
is pending rework against WT Builder.

**Never edit `apps/site/archive/*.md` (or the pushed files) here.** They're regenerated upstream and
overwritten by the next handoff. Fix the issue in WT Builder and re-send; historical repairs go in
`librarian-thing/data/issues/{N}/archive.md`.

## Data files in `apps/site/_data/`

- **Pushed in** (don't hand-edit): `emails.json` by WT Builder; `data/librarian/graph.json` by
  `librarian-thing`. `status.json` is frozen (see above).
- **Owned by this repo:** `stats.json` — subscriber + Stripe figures, fetched by *weekly's own CI* (a
  landing-page presentation concern).
- **Hand-authored** (edit directly): `site.json`, `support.json`, `quotes.json`, `survey.json`,
  `faq.json`, `redirects.json`.

`archiveStats.js` computes stats at build time from `emails.json` (records, streaks, per-year breakdowns).

## GitHub Actions — `.github/workflows/deploy.yml`

Render-only. Triggered by push to `main` (a handoff commit) + manual `workflow_dispatch`. Steps:
`npm ci` → validate tracked documentation links → fetch landing-page stats → `npm run build` (11ty) →
`npm run build:search` (Pagefind) → install Playwright Chromium → `npm run test:e2e` → upload + deploy
to GitHub Pages. No Python, no Lambda, no corpus build — those run in `librarian-thing`.

## Secrets

This repo holds only what its own concerns need — the credentials for the landing-page stats fetch.
Publishing secrets live in WT Builder; corpus/Lambda secrets live in `librarian-thing`. Pages deploys
with the default `GITHUB_TOKEN`.

## Conventions worth knowing (site-only)

- **Pagefind UI** reset blocks CSS overrides — use `!important`. `data-pagefind-filter` survives until
  reindex.
- **Tinylytics kudos** overwrites innerHTML — render heart/label via CSS `::before` so they survive.
- **Don't hand-edit generated files** (`apps/site/archive/*.md`, the pushed `_data/*.json`,
  `data/librarian/graph.json`) — fix upstream in WT Builder or `librarian-thing`.
- **e2e tests** (`tests/e2e/`) are Playwright specs against the rendered site + Thingy redirects. The
  deploy workflow installs Chromium and runs them before uploading the Pages artifact.
- **Agent guide compatibility:** `AGENTS.md` is canonical and `CLAUDE.md` is its one-way symlink.
  `npm run test:docs` validates every tracked Markdown symlink and both root entry points.

## Pointers upstream

Authoring and publishing: **WT Builder** — start at `wt-builder/README.md`. The archive, the
era-specific link-extraction rules, and the Lambda runtime: **`librarian-thing`** — start at its
`README.md`. The Studio application and its agents are retired; their history lives in
`librarian-thing`'s git history.
