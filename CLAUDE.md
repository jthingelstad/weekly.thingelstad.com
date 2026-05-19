# The Weekly Thing — Landing Page & Archive Site

## Project Overview

Custom landing page and full archive site for **The Weekly Thing**, a weekly newsletter by Jamie Thingelstad published since 2017. workshop_bot (`apps/workshop_bot/`) is the canonical author surface — it assembles each issue and ships it three ways: email (Buttondown), website archive (this repo), and audio transcript (per-block files for TTS). Buttondown is a delivery channel for email only; the website is canonical.

**Live URL:** `weekly.thingelstad.com`
**Repo:** `jthingelstad/weekly.thingelstad.com`
**Hosting:** GitHub Pages
**Site Generator:** Eleventy 3.x (11ty) with Nunjucks templates
**Issue Source:** `data/issues/{N}/` — written by workshop_bot's ship sequence via the GitHub Git Data API
**Search:** Pagefind (static, runs post-build)
**Analytics:** Tinylytics (privacy-focused, cookie-free)

### Architecture Pattern: Workshop-as-Source

- **workshop_bot** (separate process in `apps/workshop_bot/`) is the canonical author surface. Each `/eddy issue send` runs a six-step ship sequence: `compose-archive` (writes `archive.md` + `links.json`) → `compose-transcript` (writes per-block `transcript/NNN-*.txt`) → POST/PATCH Buttondown draft → re-emit archive.md with absolute_url → atomic commit on this repo's main via the GitHub Git Data API → success card. See `apps/workshop_bot/CLAUDE.md` for the full workshop runtime.
- **`pipeline/content/content.py build`** reads `data/issues/{N}/{archive.md, metadata.json, links.json}` and writes `apps/site/archive/{N}.md` + `apps/site/_data/emails.json` with the 11ty front-matter contract (adds `layout`, `permalink`, `tags`, `audio_*`).
- **11ty** reads the generated `.md` files and renders the site.
- **Pagefind** indexes the built HTML for full-text search.

`data/issues/{N}/archive.md` is the editorial source of truth. Edits land there (via workshop_bot, or hand-edited and committed); the build regenerates `apps/site/archive/{N}.md` from those bytes. The Librarian/Thingy runtime, full env-var list with defaults, IAM cleanup plan, retrieval architecture, Tinylytics events, and deployment checklist live in [`docs/librarian.md`](docs/librarian.md).

### Newsletter Publishing History

The Weekly Thing has been published continuously since May 13, 2017 across three different email platforms. Each platform left its own stylistic fingerprint in the archive bodies, which matters when writing scripts that process older issues.

| Issues | Era | Platform | Body traits |
|---|---|---|---|
| #1–#41 | May 2017 – Feb 2018 | **Tinyletter** | Plain markdown, inline links, no structured sections, no template cruft, date stamps like "Jun 3, 2017" at the top of early issues |
| #42–#~130 | Mar 2018 – late 2019 | **MailChimp** | Templated headers (`Weekly Newsletter from Jamie Thingelstad`, `#42 \| Feb 24, 2018 \| Permalink (*\|ARCHIVE\|*)`); inline links; emoji-suffixed section headings appear in this era (`## Featured Links 🏅`, `## Notable Links 📌`, `## Yet More Links 🍞`); some issues (e.g., #106) are plain-text with bare URLs and no markdown link syntax |
| #~131 onward | 2020 – present | **Buttondown** | Canonical section names (`## Notable`, `## Featured`, `## Briefly`, `## Must Read`); structured H3-under-H2 link format: `### [Title](url)`; Buttondown template tags like `{{ email_url }}`; `<!-- buttondown-editor-mode: plaintext -->` preamble |

Migration history note: all archive bodies were migrated forward into a single canonical store under `data/issues/{N}/`. Link extraction in `librarian_core.links` (shared by the website build and workshop_bot's `compose-archive`) accepts the era-specific Notable/Briefly section names — including the emoji-suffixed MailChimp-era variants (`## Notable Links 📌`, `## Featured Links 🏅`, `## Yet More Links 🍞`) — via the `NOTABLE_SECTIONS` / `BRIEFLY_SECTIONS` sets.

## Build & Run

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
```

Issues themselves are committed by workshop_bot (`/eddy issue send`), not by an operator-side pull. If workshop_bot is down on publish day, the week skips.

### Environment Variables

- `BUTTONDOWN_API_KEY` — required for stats refresh + workshop_bot's email ship. Local: `.env`. CI: GitHub Actions secret.
- `STRIPE_API_KEY` — required for Stripe balance refresh. Same pattern.
- `OPENAI_API_KEY` — required for audio TTS generation.
- `GITHUB_PAT_TOKEN` — fine-grained PAT with Contents:write on this repo, used by workshop_bot's ship sequence to commit `data/issues/{N}/*` via the GitHub Git Data API. Workshop-only env var.
- `WEEKLY_THING_ASSETS_BUCKET` — public archive asset bucket; defaults to `files.thingelstad.com`.
- `LIBRARIAN_BUCKET` — private Thingy code/corpus/log bucket; deploy tooling defaults to `weekly-thing-librarian`.

## Project Structure

```
weekly.thingelstad.com/
├── .github/workflows/deploy.yml    # Build & deploy to GitHub Pages
├── apps/
│   ├── site/                       # Eleventy static site (deployed to GitHub Pages)
│   │   ├── eleventy.config.js      # 11ty configuration
│   │   ├── _data/                  # JSON/JS data (emails, stats, site, support, quotes, survey, status, voiceSamples, redirects, archiveStats, faq)
│   │   ├── _includes/              # layouts/ + partials/
│   │   ├── archive/                # 1.md … 345.md, generated per-issue pages
│   │   ├── css/                    # style.css
│   │   ├── img/                    # static images
│   │   ├── index.njk, about.njk, support.njk, search.njk, faq.njk, feed.njk, issue-links-feed.njk, podcast.njk, ops.njk, librarian.njk, …
│   │   └── CNAME, robots.txt, _nojekyll, favicon.svg
│   ├── librarian/                  # Thingy intelligence — Lambda agent for archive Q&A
│   │   ├── lambda/                 # Node Lambda code (chat/, auth/, shared/, prompts/, tests/)
│   │   ├── infra/                  # CloudFormation template
│   │   └── admin/                  # operator scripts for the live stack (scaffolding)
│   ├── thingy_bridge/              # Discord ↔ Lambda bridge for the public reader Q&A surface (#ask-thingy)
│   └── workshop_bot/               # Discord workshop: Eddy, Linky, Marky, Patty (author-facing)
├── librarian-core/                 # shared Python package (corpus, BM25 retrieval, graph) — installed editable
├── pipeline/
│   ├── content/                    # build (data/issues/ → apps/site/archive/) + stats refresh + Buttondown publish helper
│   ├── corpus/                     # archive corpus build CLI (lib in librarian-core)
│   ├── graph/                      # archive graph build CLI (lib in librarian-core)
│   ├── deploy/                     # AWS deploy, corpus/graph upload, Bedrock logging
│   ├── audio/                      # audio script + TTS rendering + manifest + cover (per-block or legacy single-string)
│   ├── audits/                     # repeatable archive audit and repair tooling
│   ├── one-shot/                   # archived scripts that applied one-time cleanup
│   └── status.py                   # generates apps/site/_data/status.json for /ops/
├── content/
│   └── buttondown/                 # author-managed Buttondown config (automations/, newsletter/) — scaffolding
├── data/
│   ├── issues/{N}/                 # CANONICAL: archive.md + metadata.json + links.json + transcript/NNN-*.txt
│   ├── librarian/                  # tracked corpus and graph artifacts
│   ├── links/                      # tracked linked-URL aggregation artifacts
│   └── audio/                      # tracked audio manifest + scripts (legacy issues only)
├── docs/
│   └── audits/                     # Snapshot of archive audits — see docs/audits/README.md
│                                   # (archive-audit, llm-audit, missing-photos, missing-microblog-posts)
├── tests/                          # Python unittest + Playwright e2e
├── package.json
├── requirements.txt
├── Makefile
├── .env.example
└── CLAUDE.md
```

## Link Extraction — Editorial Links Only

`librarian_core.links` (shared between the website build and workshop_bot's `compose-archive`) extracts only editorially curated links, not incidental inline references.

**Notable sections** (`## Notable`, `## Must Read`, `## Featured`, plus the emoji-suffixed MailChimp-era variants):
- Only links from H3 headings are extracted: `### [Title](url)`
- Inline links in commentary text below headings are ignored (e.g., biographical Wikipedia links, POAP links, reddit references)

**Briefly sections** (`## Briefly`, `## Recommended Links`, `## FYI`):
- Only bolded links are extracted: `**[Title](url)**`
- Commentary text around the link is ignored

**Early issues** (no H2 section structure): all links extracted as fallback.

**Domain exclusion list** (`pipeline/content/domain_exclusions.py`): Excludes newsletter's own domains, Buttondown, image CDNs, URL shorteners, social media, Wikipedia, YouTube, and other utility domains from domain lists and stats. workshop_bot's `tools/avoid_domains.py` is a separate hand-maintained copy used for Pinboard pre-filtering (keep them loosely in sync).

## Archive Files (`apps/site/archive/*.md`)

Each issue is a standalone generated markdown file with YAML front matter. The body is a verbatim re-emit of `data/issues/{N}/archive.md`'s body — no Liquid-strip transform, no link re-extraction at build time. workshop_bot's `compose-archive` did both before commit.

Do not edit these files directly. They include this generated-file notice immediately after front matter:

```md
<!-- Generated by pipeline/content/content.py from data/issues; do not edit directly. -->
```

Body corrections, archive cleanup, and broad editorial fixes belong in `data/issues/{N}/archive.md`. `python pipeline/content/content.py build` regenerates `apps/site/archive/{N}.md` from those bytes plus the audio manifest. Metadata corrections (subject, description, image, slug) edit the front matter in `data/issues/{N}/archive.md` directly — `data/issues/{N}/metadata.json` is a structured sibling for non-markdown consumers (status report, workshop_bot reads).

Front matter includes: `layout`, `buttondown_id`, `number`, `subject`, `publish_date`, `slug`, `description`, `image`, `absolute_url`, `domains` (list), `links` (list of editorial link objects), `word_count`, `permalink`, `tags`, plus `audio_*` fields injected at build time from `data/audio/manifest.json`.

The `number` field determines the URL (`/archive/247/`). For Workshop-shipped issues, the number comes from `/eddy issue start <N>`; for migrated legacy issues, it was assigned during the one-time backfill from subject-line parsing or auto-numbered by date.

## 11ty Configuration (`apps/site/eleventy.config.js`)

Invoked from the repo root via `eleventy --config apps/site/eleventy.config.js` (see `package.json`). The output dir `_site/` stays at the repo root so CI's `upload-pages-artifact` step picks it up unchanged.

- **Input:** `apps/site` / **Output:** `_site`
- **Template formats:** `njk`, `md`
- **Markdown:** `markdown-it` with `markdown-it-anchor` for heading IDs
- **Collections:** `issuesByNumber` (ascending), `issuesByDate` (newest first)
- **Filters:** `dateFormat`, `dateShort`, `currentYear`, `numberFormat`, `year`, `slice`, `truncate`, `issueNumberBase`, `xmlEscape`, `markdownify`, `extractToc`, `groupByYear`
- **Passthrough copy:** `img/`, `css/`, `CNAME`, `favicon.svg`, `_nojekyll`

## Landing Page (`/`)

The landing page has these sections in order:

1. **Hero** — title, tagline, subscribe form, issue count
2. **Value proposition** — "Not an algorithm. Not a feed." + stats (total links, words, unique domains)
3. **What Readers Say** — survey stats (82% recommend, 58% read whole issue, 73% 3+ year subscribers), feeling words cloud, 6 featured testimonial quotes from reader surveys
4. **Mid-page subscribe CTA** — "Join them. Free, every weekend."
5. **About the author** — photo, short bio, link to /about/
6. **How It Sounds** — 3 actual quotes from newsletter issues
7. **Latest issue** — dedicated card with TOC preview, link to archive
8. **Mid-page subscribe CTA** — "Curious? Get it in your inbox every weekend."
9. **Membership** — current nonprofit, amount raised, member count
10. **Footer subscribe CTA** — "Start reading this weekend"

Subscribe forms appear 4 times on the page (hero, two mid-page, footer).

## Pages

| Path | Template | Description |
|------|----------|-------------|
| `/` | `index.njk` | Landing page |
| `/archive/` | `archive/archive.njk` | Browsable index, grouped by year |
| `/archive/N/` | Individual `.md` files | Issue pages with TOC, domains, prev/next nav |
| `/about/` | `about.njk` | Full bio, story, photo |
| `/members/` | `support.njk` | Supporting Membership, current nonprofit (EFF 2025), past (CC 2024) |
| `/search/` | `search.njk` | Pagefind search with bookmarkable URLs |
| `/faq/` | `faq.njk` | FAQ |
| `/feed.xml` | `feed.njk` | Atom feed (all issues) |
| `/archive/N/links.xml` | `issue-links-feed.njk` | Per-issue links feed |
| `/archive/<slug>/` | `redirects.njk` | Redirects from old Buttondown URLs |
| `/ops/` | `ops.njk` | **Unlinked, noindex.** Per-issue pipeline state report — archive edits, audio (rendered, stale, missing), Thingy corpus freshness. Reads from `apps/site/_data/status.json`, regenerated by `pipeline/status.py` at build time. |
| `/status.json` | `status-json.njk` | Same data, JSON form. Both `/ops/` and `/status.json` are `Disallow`'d in robots.txt. |

## RSS Feeds

- **Main feed** (`/feed.xml`) — Atom, one entry per issue
- **Per-issue links feeds** (`/archive/N/links.xml`) — each editorial link as a feed item, useful for automation (e.g., posting to r/WeeklyThing)
- Auto-discoverable via `<link>` tags in `<head>`

## GitHub Actions (`.github/workflows/deploy.yml`)

**Triggers:** push to main, manual `workflow_dispatch`. No cron, no webhook, no `repository_dispatch` — workshop_bot's ship sequence commits `data/issues/{N}/*` directly via the GitHub Git Data API, and the resulting push triggers this workflow.

**Pipeline:**
1. Setup Python 3.14 + Node 22; `pip install` + `npm ci`
2. Run Python + Lambda tests
3. Refresh stats (`pipeline/content/content.py stats`) — subscriber counts + Stripe balance, `continue-on-error`
4. Render audio for the latest issue (`apt-get install ffmpeg`, `pipeline/audio/audio.py build --latest`) — idempotent, `continue-on-error` so a TTS hiccup doesn't block the deploy
5. Build archive from `data/issues/` (`pipeline/content/content.py build`)
6. Build librarian corpus, embed + upload to S3 (`pipeline/deploy/upload_corpus.py`) — `continue-on-error`
7. Detect + deploy Thingy Lambda if its code/infra changed
8. `pipeline/status.py` writes the `/ops/` snapshot
9. `npx @11ty/eleventy` + Pagefind
10. Auto-commit downstream artifacts (audio manifest, regenerated archive, emails.json, stats.json) on non-push triggers
11. Upload and deploy to GitHub Pages

**Required GitHub Actions secrets:** `BUTTONDOWN_API_KEY` (stats), `STRIPE_API_KEY` (balance), `OPENAI_API_KEY` (TTS), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (the `wt-archive` IAM user's keys — must have S3 write to `weekly-thing-librarian` and `files.thingelstad.com`, CloudFront `CreateInvalidation` on E3AEA6KRKI2B7E, and Bedrock `InvokeModel` on the embedding model).

**Action versions:** checkout@v6, setup-python@v6, setup-node@v6, upload-pages-artifact@v5, deploy-pages@v4

A new issue is zero-touch on the operator side: workshop_bot ships → repo gets a commit → this workflow rebuilds the site (with the new issue's audio rendered + corpus refreshed). If workshop_bot is down on publish day, the week skips — there's no operator-side pull recovery.

## Home Page Voice Samples Refresh

The "How It Sounds" pull-quotes on the home page are regenerated on demand by an LLM pipeline rather than hand-curated. Two files drive it:

- `docs/creative/brief.md` — persistent creative brief (voice, themes, guardrails, running observations). Read at the start of each run and rewritten at the end so observations accumulate. **Hand-editable** — whatever is here is treated as ground truth on the next run.
- `apps/site/_data/voiceSamples.json` — generated pull-quotes for the "How It Sounds" section, pulled verbatim from real issues with verification.

Pipeline: `pipeline/content/refresh_marketing_copy.py` stratified-samples ~32 issues over the last 2 years (6 most-recent anchor + buckets, seeded). Sonnet 4.6 extracts themes and voice markers, picks 3–5 verbatim pull-quotes, and rewrites the brief. Voice samples are machine-verified verbatim against issue bodies before being written.

```bash
make refresh-copy-dry   # full run, prints proposed changes, writes nothing
make refresh-copy       # writes voiceSamples.json, brief.md
```

Expected cost: ~$0.20–$0.40 per run. Run logs land in `tmp/copy-refresh-<timestamp>.json` (gitignored). Expected workflow: run, review `git diff`, commit. Not wired into CI — refreshes are explicit, human-initiated.

A previous version of this pipeline also generated `apps/site/_data/copy.json` with home-page hero/value-prop/CTAs via an Opus 4.7 second pass. That output didn't deliver enough quality to justify the cost; it was removed and the home page is now hand-written in `apps/site/index.njk` directly.

`build_data.py` does **not** touch any of these files.

## Archive Audits

Audit outputs are snapshotted in `docs/audits/` and checked in so future sessions can pick up context. See `docs/audits/README.md` for the full inventory. Open cleanup work is tracked in GitHub issues — filter by labels `quick-win`, `editorial-review`, `s3-migration`, `exploration`, `low-priority`, `blocked-external` plus size labels `size-small` / `size-medium` / `size-large`.

Re-run audits:

```bash
python pipeline/audits/audit_archive.py             # static regex/DOM audit
python pipeline/audits/llm_audit_archive.py --full  # LLM audit (~$20 on Opus 4.7)
python pipeline/audits/audit_missing_micropost_photos.py  # find silently-lost photos
```

Each writes to `tmp/` (gitignored). Copy outputs to `docs/audits/` to snapshot.

## Data Files

- **`emails.json`** — lightweight metadata index (no body content), used by landing page, archive, feeds, redirects
- **`archiveStats.js`** — computes stats at build time from emails.json: total links, words, domains, per-year breakdowns, records, streaks
- **`stats.json`** — subscriber count, premium subscriber count, Stripe amount raised (generated by pipeline)
- **`site.json`** — title, description, URL, author info, Tinylytics ID (`a2YQr3ZMqkySNYSwz4uF`), social links
- **`support.json`** — current nonprofit (EFF 2025), past nonprofits (CC 2024), Stripe donate URL
- **`quotes.json`** — 25 reader quotes from 2021 and 2025 surveys, with `tags`, `source` year, and `featured` flag
- **`survey.json`** — reader survey stats, feeling words with frequencies, subscriber tenure, reading approach data

## Design

- **Aesthetic:** Editorial, magazine-like. Source Serif 4 for display + italic accents, Source Sans 3 for body/UI, JetBrains Mono for eyebrows and meta. Generous whitespace.
- **Colors:** `#fcfcfa` bg, `#1f6fd6` accent (deep `#134d99`, soft `#e1edff`), dark mode via `prefers-color-scheme`.
- **No JS required** for core reading. JS only for subscribe form, Pagefind search, archive year filter, librarian chat, and Tinylytics.
- **Accessible:** proper heading hierarchy, alt text, color contrast, keyboard nav.
- **Mobile-first** responsive design.

## Workshop bot — jobs spine

The workshop_bot (`apps/workshop_bot/`) is built around a **jobs spine**: every user-facing action is a deterministic Python job in `apps/workshop_bot/jobs/`, fired by a **per-persona slash tree** (each persona is its own Discord bot with its own token and its own `CommandTree`, `manage_guild`-gated) and/or by cron. There is no `/workshop` umbrella; each persona hosts its own verbs:

- **Eddy** (`/eddy`) — issue assembly + bot health: `/eddy issue {start,update,status,final,haiku,subject,publish}`, `/eddy status`, `/eddy review <text>`, `/eddy archive <issue>`, `/eddy followup {list,add,cancel}`.
- **Linky** (`/linky`) — link curation: `/linky scan`, `/linky research <url>`, `/linky pile`, `/linky stats`, `/linky followup {list,add,cancel}`.
- **Marky** (`/marky`) — syndication + analytics: `/marky prep`, `/marky metrics`, `/marky engagement`, `/marky referrers`, `/marky campaign {add,edit,report,copy,sunset}`, `/marky followup {list,add,cancel}`.
- **Patty** (`/patty`) — supporters: `/patty cta`, `/patty goal {set,done}`, `/patty progress`, `/patty nonprofit`, `/patty supporters`, `/patty followup {list,add,cancel}`.

Internal job names are dash-cased (`update-draft`, `create-final`, `compose-meta`, `compose-cta`, `send-to-buttondown`, `pinboard-scan`, `daily-metrics`, `goal-achieved`, `follow-up-sweep`, …); the slash names are operator-facing aliases (`/eddy issue update` → `update-draft`, `/eddy issue subject` → `compose-meta`, `/eddy issue send` → `send-to-buttondown`, `/linky scan` → `pinboard-scan`, `/marky metrics` → `daily-metrics`, `/patty cta` → `compose-cta`, `/patty goal done` → `goal-achieved`, …). The full map lives in [`apps/workshop_bot/CLAUDE.md`](apps/workshop_bot/CLAUDE.md). Some jobs make small encapsulated LLM calls; most are pure Python. Single-asset locking (`job_locks` table) serializes jobs that write the same workspace file.

Issue-assembly flow: `/eddy issue start` → `/eddy issue update` (also daily 17:00 CT; pure projection of Pinboard/micro.blog/asset files into `draft.md`; Eddy reviews Tue–Fri) → `/eddy issue final` (Eddy's editorial pass: **code does the moving — the LLM only specifies the order**. Returns a JSON proposal — thesis, per-section reorders, optional 0–2 promotions of a Journal entry to its own featured section, membership-block markers — and the job validates strictly and reassembles `final.md` from the original byte-exact chunks. Writes `final.md` + `thesis.md`) → `/eddy issue haiku` / `/eddy issue subject` / `/patty cta` (run on demand, any order; downstream jobs read `thesis.md` so subject/description/haiku/CTAs anchor on the same narrative; `/patty cta` scans `final.md` for `<!-- cta:N -->` / `<!-- thanks:N -->` markers and fills the supporter-ask and member-thanks copy per slot) → `/eddy issue publish` (assembles `publish.md`; substitutes each membership marker with an **audience-aware Liquid block** — non-members see the supporter CTA, premium members see the thank-you; refuses with a missing-list until the required assets exist) → `/eddy issue send` (pushes `publish.md` to Buttondown as a draft, **idempotently**: POST on first run, PATCH on every subsequent run via a `buttondown_id` stored in `metadata.json`; never sets `publish_date` — Jamie schedules and ships from the Buttondown UI by hand). Parallel tracks: `/linky scan` (hourly 07:00–22:00 CT year-round), `/marky prep` (RSS-triggered post-ship), `/marky metrics` (daily 19:00 CT) + `/marky campaign {add,report}`. Issue assets are standalone files in `s3://files.thingelstad.com/weekly-thing/{N}/` (`intro.md`, `outro.md`, `currently.md`, `haiku.md`, `metadata.json`, `thesis.md`, `cta-*.md`, `thanks-*.md`, `draft.md`, `final.md`, `publish.md`).

Per-persona heartbeats and the `agent_inbox` / `s3_personas__*` / `WORKSHOP_BUCKET` machinery from the prior design were all decommissioned; `s3_issues__*` tools were renamed `workspace__*`. New SQLite tables: `job_locks`, `draft_digests`, `goals`, `campaigns`, `campaign_metrics`, `follow_ups`. Source: `apps/workshop_bot/` (see `apps/workshop_bot/CLAUDE.md` for project memory and `docs/workshop-content-loop-design-brief.md` for the full design). The old iOS Shortcuts assemble pipeline stays as a recovery tool until a few ships succeed via the new flow.

**Two-process Discord topology.** The reader-facing Thingy bot (`#ask-thingy` + the `thingy-watch` operator mirror + `/thingy {recent,show,sync}` slash tree) lives in [`apps/thingy_bridge/`](apps/thingy_bridge/) as a separate Python process — independent restart, independent SQLite (`apps/thingy_bridge/data/thingy_bridge.db` with the `thingy_tokens` / `thingy_requests` / `thingy_conversations` tables). workshop_bot is purely author-facing; the two processes share the Discord server (and `#chatter`, where the bridge's `thingy-watch` posts operator-side conversation cards) but no code or DB. A workshop_bot restart for an author-flow change no longer drops `#ask-thingy`.

**Follow-ups** are the targeted replacement for the retired per-persona heartbeats: an agent (via the `followup__schedule` tool) or Jamie (via `/<persona> followup add` — each persona has its own `followup` subgroup) registers a commitment — time-based ("I'll check in tomorrow evening", any distance) or issue-based ("when we get to issue 387") — in the `follow_ups` table; the hourly `follow-up-sweep` job fires the due ones, running the persona's agent loop with the note + current context so it posts a check-in in its channel. `jobs/follow_up.py`; `/<persona> followup {list,add,cancel}`.

## Email styling

`content/buttondown/newsletter/buttondown-email.css` is the production email stylesheet. Paste its contents into Buttondown's **Custom CSS** field so issues delivered to inboxes match the archive site (Source Serif 4 headings, Source Sans 3 body, blue accent, mono section markers). The file uses system-font fallbacks (Charter, Iowan Old Style, SF Mono) since most email clients don't load remote fonts.

## Future Enhancements

- **Issue tagging/categorization** — browsable topic categories
- **Workshop_bot ↔ Thingy corpus consolidation** — workshop_bot loads its own BM25 corpus in-memory at startup from `apps/site/archive/` and only refreshes on bot restart. Thingy's S3 corpus (with Bedrock embeddings + rerank) auto-refreshes via the GH Action on every new issue. Bridge auth already exists (`DiscordBridgeSecret`, `apps/thingy_bridge/tools/thingy_client.py`). Three viable consolidation paths: add a thin `/retrieve` endpoint on the Lambda; have workshop_bot auto-reload its local corpus on a schedule; or fetch the S3 corpus directly from workshop_bot. Decision deferred.

(The "Talk to the Archive" agent — Thingy — shipped to private beta. Source: `apps/librarian/lambda/`, infra: `apps/librarian/infra/cloudformation.yaml`. Full architecture, env vars, IAM, retrieval, deploy checklist in [`docs/librarian.md`](docs/librarian.md).)
