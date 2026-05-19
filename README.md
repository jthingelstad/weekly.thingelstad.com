# weekly.thingelstad.com

Source for [The Weekly Thing](https://weekly.thingelstad.com), a newsletter Jamie has published every weekend since May 2017. This monorepo produces several deliverables that share one archive corpus: the public website, the email newsletter, an audio podcast feed, and a Discord-hosted authoring workshop.

**Live URL:** `weekly.thingelstad.com`
**Site generator:** Eleventy 3.x with Nunjucks templates
**Hosting:** GitHub Pages
**Search:** Pagefind (static, runs post-build)
**Analytics:** Tinylytics (privacy-focused, cookie-free)

---

## What lives where

| Path | What it produces |
|---|---|
| [`apps/site/`](apps/site/) | Eleventy static site — landing page, full archive, feeds. Deployed to GitHub Pages. |
| [`apps/librarian/`](apps/librarian/) | Thingy — the AWS Lambda agent that answers reader questions against the archive. `lambda/` (Node source), `infra/` (CloudFormation), `admin/` (operator scripts). |
| [`apps/workshop_bot/`](apps/workshop_bot/) | Author-facing Discord workshop. Four agent personas (Eddy, Linky, Marky, Patty) help Jamie assemble each week's issue. |
| [`apps/thingy_bridge/`](apps/thingy_bridge/) | Discord ↔ Lambda bridge for the public reader Q&A surface in `#ask-thingy`. Separate process from workshop_bot. |
| [`librarian-core/`](librarian-core/) | Shared Python package — corpus loader, BM25 retrieval, graph builder. Installed editable. |
| [`pipeline/content/`](pipeline/content/) | Build `apps/site/archive/` from `data/issues/`, refresh subscriber stats, the Buttondown publish helper. |
| [`pipeline/audio/`](pipeline/audio/) | Audio script transform + OpenAI TTS + ffmpeg loudnorm + S3 upload + manifest. |
| [`pipeline/deploy/`](pipeline/deploy/) | AWS deploy for the Thingy Lambda, corpus/graph upload, Bedrock logging config. |
| [`pipeline/audits/`](pipeline/audits/) | Repeatable archive audit + repair tooling (static + LLM passes). |
| [`pipeline/one-shot/`](pipeline/one-shot/) | Retired one-time cleanup scripts, kept as reference. |
| [`pipeline/corpus/`](pipeline/corpus/), [`pipeline/graph/`](pipeline/graph/) | CLI wrappers around `librarian_core`. |
| [`pipeline/status.py`](pipeline/status.py) | Generates `apps/site/_data/status.json` for the `/ops/` page. |
| [`data/issues/{N}/`](data/issues/) | **Canonical issue store.** `archive.md` (editorial body + front matter), `metadata.json`, `links.json`, `transcript/NNN-*.txt`. Written by workshop_bot's ship sequence via the GitHub Git Data API. |
| [`data/{librarian,audio}/`](data/) | Generated build artifacts (tracked). |
| [`content/buttondown/`](content/buttondown/) | Author-managed Buttondown configuration (automation bodies, newsletter CSS, transactional templates). Hand-synced to Buttondown. |
| [`docs/`](docs/) | Operator guides, audit snapshots, creative brief, design notes. See [`docs/librarian.md`](docs/librarian.md) for the Lambda runtime detail. |

For deeper operational detail, each major directory has a `CLAUDE.md` next to its `README.md`: [`/CLAUDE.md`](CLAUDE.md) for the architecture pattern + cross-cutting conventions, [`apps/workshop_bot/CLAUDE.md`](apps/workshop_bot/CLAUDE.md) for the workshop runtime, [`apps/librarian/CLAUDE.md`](apps/librarian/CLAUDE.md) for the Lambda, and so on. READMEs (these files) are for human readers; CLAUDE.md files are operational memory.

---

## Architecture in one paragraph

`data/issues/{N}/archive.md` is the editorial source of truth. workshop_bot assembles each issue and atomically commits it there + ships the email to Buttondown + uploads audio to S3. The website build (`pipeline/content/content.py build`) reads `data/issues/` and writes the 11ty-shaped `apps/site/archive/*.md`. Eleventy renders the site; Pagefind indexes the built HTML. The Thingy Lambda answers reader Q&A against an embedded corpus (Bedrock Cohere embed + rerank) built from the same archive. Two Discord processes share the server: workshop_bot for the author, thingy_bridge for readers.

---

## Quick start

```bash
# Setup
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && npm install

# Dev — regenerates apps/site/archive/ from data/issues/, then 11ty serves
make serve

# Full production build (regenerate archive + 11ty + Pagefind)
make build

# Refresh subscriber count + Stripe balance in apps/site/_data/stats.json
make stats

# Run tests
make test                # Python unit + Lambda tests
make test-workshop       # workshop_bot suite
```

Per-app run commands live in each app's README — see `apps/<name>/README.md`.

---

## Environment variables

All secrets live in `.env` at the repo root (see `.env.example` for the full template). The same file is read by every Python entrypoint and by Jamie's local launchd services.

| Variable | Used by | Notes |
|---|---|---|
| `BUTTONDOWN_API_KEY` | stats refresh, workshop_bot ship | Required for `make stats` and `/eddy issue send` |
| `STRIPE_API_KEY` | stats refresh | Stripe balance for the supporter program |
| `OPENAI_API_KEY` | audio pipeline | OpenAI `tts-1-hd` for voiceovers |
| `ANTHROPIC_API_KEY` | workshop_bot, thingy_bridge | Claude API |
| `GITHUB_PAT_TOKEN` | workshop_bot ship | Fine-grained PAT with Contents:write on this repo |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | audio + Lambda deploy + corpus upload | The `wt-archive` IAM user |
| `WEEKLY_THING_ASSETS_BUCKET` | many | Public archive asset bucket; defaults to `files.thingelstad.com` |
| `LIBRARIAN_BUCKET` | librarian deploy | Private code/corpus/log bucket; defaults to `weekly-thing-librarian` |
| `LIBRARIAN_BRIDGE_SECRET` | thingy_bridge, workshop_bot's semantic retrieval | Shared secret for the Lambda's bridge-secret auth |
| `MICROBLOG_API_KEY` | workshop_bot | micro.blog Micropub source query (journal pull) |
| `PINBOARD_API_TOKEN` | workshop_bot (Linky) | Bookmark surfaces |
| `TINYLYTICS_API_KEY` / `TINYLYTICS_SITE_UID` | workshop_bot (Marky) | Site engagement |

Per-app env tables live in each app's README; the cross-cutting ones are above. CI uses GitHub Actions secrets with the same names.

---

## Site overview

### Pages

| Path | Template | What it is |
|---|---|---|
| `/` | `index.njk` | Landing page — hero, value prop, reader quotes, latest issue, membership |
| `/archive/` | `archive/archive.njk` | Browsable index of every issue, grouped by year |
| `/archive/N/` | Generated `.md` per issue | Issue page with TOC, domains, prev/next nav |
| `/about/` | `about.njk` | Full bio + story |
| `/members/` | `support.njk` | Supporting Membership, current + past nonprofits |
| `/search/` | `search.njk` | Pagefind search with bookmarkable URLs |
| `/faq/` | `faq.njk` | FAQ |
| `/feed.xml` | `feed.njk` | Atom feed (all issues) |
| `/archive/N/links.xml` | `issue-links-feed.njk` | Per-issue links feed (useful for r/WeeklyThing automation) |
| `/podcast.xml` | `podcast.njk` | Podcast RSS feed |
| `/librarian/` | `librarian.njk` | Thingy chat interface |
| `/ops/` | `ops.njk` | **Unlinked, noindex.** Per-issue pipeline state. Reads `_data/status.json`. |

### Design

Editorial, magazine-like. Source Serif 4 for display + italic accents, Source Sans 3 for body/UI, JetBrains Mono for eyebrows and meta. Generous whitespace. `#fcfcfa` background, `#1f6fd6` accent (deep `#134d99`, soft `#e1edff`), dark mode via `prefers-color-scheme`. No JS required for core reading — JS only for the subscribe form, Pagefind search, archive year filter, librarian chat, and Tinylytics. Mobile-first. Accessible: proper heading hierarchy, alt text, color contrast, keyboard nav.

---

## Publishing flow

A new issue is zero-touch on the operator side:

1. Jamie works through the issue in `#editorial` (Discord) with Eddy across the week — drafts pulled from Pinboard + micro.blog into a daily-refreshed preview.
2. `/eddy issue send` runs the ship sequence: compose archive → compose audio transcript → render MP3 → POST/PATCH Buttondown draft → atomic commit of `data/issues/{N}/*` to this repo.
3. The push triggers `.github/workflows/deploy.yml` — rebuilds the site, refreshes the Lambda corpus, deploys to GitHub Pages.
4. Jamie schedules + sends the email from the Buttondown UI by hand (workshop_bot never sets `publish_date`).

The website is canonical; Buttondown is the email delivery channel only. If workshop_bot is down on publish day, the week skips — there's no operator-side pull recovery flow.

---

## Tech stack

- **Python 3.14** — workshop_bot, thingy_bridge, pipeline
- **Node 22** — Lambda, Eleventy site, Pagefind
- **Eleventy 3.x** — static site generator
- **Nunjucks** — templates
- **markdown-it** + `markdown-it-anchor` — body rendering with heading IDs
- **Pagefind** — search index
- **discord.py** — both bot processes
- **APScheduler** — cron scheduling inside the bot processes
- **anthropic** — Claude API
- **AWS Bedrock** — Cohere embed + rerank for the Lambda
- **boto3** — S3, CloudFormation, CloudWatch
- **OpenAI** — `tts-1-hd` for podcast audio
- **ffmpeg** — audio concat + loudnorm

---

## Newsletter publishing history

Published continuously since May 13, 2017, across three email platforms (Tinyletter → MailChimp → Buttondown). All bodies migrated forward into `data/issues/{N}/`. Era-specific stylistic fingerprints survive in older issues — see [`CLAUDE.md`](CLAUDE.md) for the table when writing scripts that process the archive.

---

## Contributing / running locally

This is a personal project, but the code is open. Per-app setup lives in:

- [`apps/site/README.md`](apps/site/README.md) — running the Eleventy site
- [`apps/workshop_bot/README.md`](apps/workshop_bot/README.md) — running the Discord workshop
- [`apps/thingy_bridge/README.md`](apps/thingy_bridge/README.md) — running the reader-facing bridge
- [`apps/librarian/README.md`](apps/librarian/README.md) — deploying the Lambda

Operator service control (launchd plists for the Discord bots, online SQLite backups, cache cleanup) is in `apps/<name>/scripts/` — see each app's `scripts/README.md`.
