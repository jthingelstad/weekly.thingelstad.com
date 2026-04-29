# The Weekly Thing — Landing Page & Archive Site

## Project Overview

Custom landing page and full archive site for **The Weekly Thing**, a weekly newsletter by Jamie Thingelstad published since 2017. The site replaces Buttondown's hosted landing page while continuing to use Buttondown as the email publishing engine.

**Live URL:** `weekly.thingelstad.com`
**Repo:** `jthingelstad/weekly.thingelstad.com`
**Hosting:** GitHub Pages
**Site Generator:** Eleventy 3.x (11ty) with Nunjucks templates
**Data Pipeline:** Python scripts for Buttondown API fetch, link extraction, and archive file generation
**Data Source:** Buttondown API (build-time only)
**Search:** Pagefind (static, runs post-build)
**Analytics:** Tinylytics (privacy-focused, cookie-free)

### Architecture Pattern: Tracked Raw Data + 11ty

- **Python content pipeline** runs first: fetches Buttondown emails into tracked raw data under `data/buttondown/`, transforms the raw Buttondown body into public archive markdown, extracts editorial links and domains, assigns issue numbers, and writes generated files into `site/archive/` and `site/_data/`.
- **11ty** runs second: reads generated `.md` files as a collection and JSON data files, renders all pages with Nunjucks templates, and handles markdown rendering, heading anchors, and TOC generation.
- **Pagefind** runs third: indexes the built HTML for full-text search.

The raw Buttondown body files are the editable source of truth for newsletter content in this repository. Generated archive markdown files are committed for fast static builds and reviewable diffs, but should not be edited directly.

### Newsletter Publishing History

The Weekly Thing has been published continuously since May 13, 2017 across three different email platforms. Each platform left its own stylistic fingerprint in the archive bodies, which matters when writing scripts that process older issues.

| Issues | Era | Platform | Body traits |
|---|---|---|---|
| #1–#41 | May 2017 – Feb 2018 | **Tinyletter** | Plain markdown, inline links, no structured sections, no template cruft, date stamps like "Jun 3, 2017" at the top of early issues |
| #42–#~130 | Mar 2018 – late 2019 | **MailChimp** | Templated headers (`Weekly Newsletter from Jamie Thingelstad`, `#42 \| Feb 24, 2018 \| Permalink (*\|ARCHIVE\|*)`); inline links; emoji-suffixed section headings appear in this era (`## Featured Links 🏅`, `## Notable Links 📌`, `## Yet More Links 🍞`); some issues (e.g., #106) are plain-text with bare URLs and no markdown link syntax |
| #~131 onward | 2020 – present | **Buttondown** | Canonical section names (`## Notable`, `## Featured`, `## Briefly`, `## Must Read`); structured H3-under-H2 link format: `### [Title](url)`; Buttondown template tags like `{{ email_url }}`; `<!-- buttondown-editor-mode: plaintext -->` preamble |

All archive bodies today live in Buttondown (the Tinyletter and MailChimp issues were migrated in). The editor-mode comment is present on every issue as a consequence. Processing scripts should handle all three eras — in particular, link extraction must accept the emoji-suffixed MailChimp-era section names (`pipeline/content/process_emails.py`'s `NOTABLE_SECTIONS` / `BRIEFLY_SECTIONS` sets include these variants).

## Build & Run

```bash
# Setup
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && npm install

# Dev (uses tracked raw Buttondown data)
make serve

# Full production build
make build

# Fetch content from Buttondown, then rebuild generated data
make content-pull

# Sync raw body/metadata edits back to Buttondown
make content-diff  # preview changed Buttondown fields
make content-push  # PATCH changed fields
```

### Environment Variables

- `BUTTONDOWN_API_KEY` — required for API fetch. Local: `.env` file. CI: GitHub Actions secret.
- `STRIPE_API_KEY` — required for Stripe balance fetch. Same pattern.
- `OPENAI_API_KEY` — required for local audio generation with OpenAI TTS.
- `WEEKLY_THING_ASSETS_BUCKET` — public archive asset bucket; defaults conceptually to `files.thingelstad.com`.
- `LIBRARIAN_BUCKET` — private Thingy code/corpus/eval/log bucket; deploy tooling defaults to `weekly-thing-librarian`.
- `BEDROCK_GUARDRAIL_ENABLED` — optional Thingy Bedrock Guardrail switch; defaults off until explicitly deployed.
- `BEDROCK_EVAL_ROLE_ARN` — required only when starting Bedrock Model Evaluation jobs.

## Project Structure

```
weekly.thingelstad.com/
├── .github/workflows/deploy.yml    # Build & deploy to GitHub Pages
├── pipeline/
│   ├── content/                   # Buttondown pull/build/diff/push and marketing copy refresh
│   ├── librarian/                 # corpus, graph, eval, conversation review, AWS deploy
│   ├── audits/                    # repeatable archive audit and repair tooling
│   ├── links/                     # planned linked-URL retrieval and aggregation step
│   └── one-shot/                  # archived scripts that applied one-time cleanup
├── services/
│   └── librarian/
│       ├── api/                   # Python API Gateway Lambda
│       └── stream/                # Node Lambda Function URL stream handler
├── infra/
│   └── librarian/                 # CloudFormation/SAM templates
├── data/
│   ├── buttondown/
│   │   ├── manifest.json           # Raw data manifest
│   │   ├── emails/                 # Buttondown email metadata JSON snapshots, tracked
│   │   └── bodies/                 # Raw Buttondown body markdown, tracked and editable
│   ├── librarian/                  # tracked corpus and graph artifacts
│   └── links/                      # tracked linked-URL aggregation artifacts
├── docs/
│   └── audits/                     # Snapshot of archive audits — see docs/audits/README.md
│                                   # (archive-audit, llm-audit, missing-photos, missing-microblog-posts)
├── site/
│   ├── _data/
│   │   ├── emails.json             # Metadata index (generated, committed)
│   │   ├── archiveStats.js         # Computed stats for landing page and FAQ
│   │   ├── stats.json              # Subscriber count, premium count, Stripe balance
│   │   ├── site.json               # Site metadata, Tinylytics ID, social links
│   │   ├── support.json            # Supporting Membership nonprofit info
│   │   ├── quotes.json             # Reader survey quotes (25 quotes, tagged)
│   │   ├── survey.json             # Reader survey stats, feeling words, tenure data
│   │   └── redirects.js            # Buttondown slug → issue number redirects
│   ├── _includes/
│   │   ├── layouts/
│   │   │   ├── base.njk            # Base HTML (head, header, footer, analytics)
│   │   │   ├── page.njk            # Standard page wrapper
│   │   │   └── issue.njk           # Individual issue layout (TOC, domains, nav)
│   │   └── partials/
│   │       ├── header.njk
│   │       ├── footer.njk
│   │       ├── subscribe-form.njk
│   │       └── issue-card.njk
│   ├── archive/
│   │   ├── 1.md … 345.md          # One .md file per issue (generated, committed)
│   │   └── (plus special issues)
│   ├── index.njk                   # Landing page (/)
│   ├── about.njk                   # About page (/about/)
│   ├── support.njk                 # Supporting Membership (/members/)
│   ├── search.njk                  # Pagefind search (/search/)
│   ├── faq.njk                     # FAQ (/faq/)
│   ├── feed.njk                    # Atom feed (/feed.xml)
│   ├── issue-links-feed.njk        # Per-issue links feed (/archive/N/links.xml)
│   ├── css/style.css               # Single stylesheet (~32KB)
│   ├── img/                        # Static images
│   ├── CNAME                       # GitHub Pages custom domain
│   ├── _nojekyll                   # Disable Jekyll on GitHub Pages
│   └── favicon.svg
├── eleventy.config.js              # 11ty configuration
├── package.json
├── requirements.txt
├── Makefile
├── .env.example
└── CLAUDE.md
```

## Link Extraction — Editorial Links Only

The Python pipeline extracts only editorially curated links, not incidental inline references.

**Notable sections** (`## Notable`, `## Must Read`, `## Featured`):
- Only links from H3 headings are extracted: `### [Title](url)`
- Inline links in commentary text below headings are ignored (e.g., biographical Wikipedia links, POAP links, reddit references)

**Briefly sections** (`## Briefly`, `## Recommended Links`, `## FYI`):
- Only bolded links are extracted: `**[Title](url)**`
- Commentary text around the link is ignored

**Early issues** (no H2 section structure): all links extracted as fallback.

**Domain exclusion list** (`pipeline/content/domain_exclusions.py`): Excludes newsletter's own domains, Buttondown, image CDNs, URL shorteners, social media, Wikipedia, YouTube, and other utility domains from domain lists and stats.

## Archive Files (`site/archive/*.md`)

Each issue is a standalone generated markdown file with YAML front matter. The body is the public archive rendering of the raw Buttondown body, produced by `pipeline/content/content.py`.

Do not edit these files directly. They include this generated-file notice immediately after front matter:

```md
<!-- Generated by pipeline/content/content.py from data/buttondown; do not edit directly. -->
```

Body corrections, archive cleanup, and broad editorial fixes belong in `data/buttondown/bodies/*.md`, then `python pipeline/content/content.py build` regenerates the archive files. Metadata corrections such as subject, description, image, and slug belong in `data/buttondown/emails/*.json`.

Front matter includes: `layout`, `buttondown_id`, `number`, `subject`, `publish_date`, `slug`, `description`, `image`, `absolute_url`, `domains` (list), `links` (list of editorial link objects), `word_count`, `permalink`, `tags`.

The `number` field determines the URL (`/archive/247/`). Assigned by the pipeline from subject line parsing; early issues without numbers are auto-numbered by date.

Buttondown Liquid/template cleanup also happens in `pipeline/content/content.py`, not in 11ty. The archive transform removes email-only or subscriber-personalized blocks and renders known public variables such as `{{ email_url }}` before link extraction, feeds, search indexing, and page rendering.

## 11ty Configuration (`eleventy.config.js`)

- **Input:** `src` / **Output:** `_site`
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

## RSS Feeds

- **Main feed** (`/feed.xml`) — Atom, one entry per issue
- **Per-issue links feeds** (`/archive/N/links.xml`) — each editorial link as a feed item, useful for automation (e.g., posting to r/WeeklyThing)
- Auto-discoverable via `<link>` tags in `<head>`

## GitHub Actions (`.github/workflows/deploy.yml`)

**Triggers:** push to main, manual `workflow_dispatch`, weekly cron for latest-issue fetch

**Pipeline:**
1. Setup Python 3.13 + Node 22
2. `pip install` + `npm ci`
3. Build content from tracked raw data by default
4. Pull latest Buttondown issue only for the scheduled/manual fetch path
5. `npx @11ty/eleventy`
6. `npx pagefind --site _site --glob "**/*.html"`
7. Auto-commit new raw data and generated files if the fetch path produced changes
8. Upload and deploy to GitHub Pages

**Action versions:** checkout@v5, setup-python@v5, setup-node@v5, upload-pages-artifact@v4, deploy-pages@v5

## Bidirectional Sync

Raw Buttondown body markdown files and metadata JSON files can be edited locally and synced back to Buttondown:

```bash
python pipeline/content/content.py diff                  # preview changes
python pipeline/content/content.py push --yes            # push all changes
python pipeline/content/content.py push --issue 42 --yes # push single issue
```

Compares `data/buttondown/bodies/*.md` and `data/buttondown/emails/*.json` against the committed baseline in `HEAD`, confirms the live Buttondown value has not diverged unexpectedly, then PATCHes changed fields to the Buttondown API.

**Important:** `pipeline/content/content.py build` regenerates `site/archive/*.md` unconditionally from raw Buttondown data. Any local archive `.md` edit will be overwritten. The durability flow is:

1. Edit the raw body in `data/buttondown/bodies/<number>.md` or metadata in `data/buttondown/emails/<number>.json`
2. `python pipeline/content/content.py build` to regenerate archive files and metadata
3. `python pipeline/content/content.py diff` to preview Buttondown API changes
4. `python pipeline/content/content.py push --yes` to push
5. `python pipeline/content/content.py pull --latest` or `python pipeline/content/content.py pull --all` to refresh tracked raw data from Buttondown
6. `python pipeline/content/content.py diff` should now show "No local changes detected"

Step 5 is critical: it verifies Buttondown accepted the update and brings the tracked raw data back in line with the remote source.

## Home Page Copy Refresh ("the creative team")

The home page marketing copy is regenerated on demand by an LLM pipeline rather than hand-written. Three files drive it:

- `docs/creative/brief.md` — persistent creative brief (voice, themes, guardrails, running observations). Read at the start of each run and rewritten at the end so observations accumulate. **Hand-editable** — whatever is here is treated as ground truth on the next run.
- `site/_data/copy.json` — generated marketing copy (hero, value prop, "what you'll actually get" themes, section titles, 4 CTAs). Templates in `site/index.njk` read from this with inline fallbacks.
- `site/_data/voiceSamples.json` — generated pull-quotes for the "How It Sounds" section, pulled verbatim from real issues with verification.

Pipeline: `pipeline/content/refresh_marketing_copy.py` stratified-samples ~48 issues over the last 2 years (8 most-recent anchor + 5 per quarter bucket, seeded). Sonnet 4.6 extracts themes, voice markers, and candidate pull-quotes. Opus 4.7 writes the final copy with hard anti-hype guardrails. Voice samples are verified verbatim against issue bodies before being written.

```bash
make refresh-copy-dry   # full run, prints proposed changes, writes nothing
make refresh-copy       # writes copy.json, voiceSamples.json, brief.md
```

Expected cost: ~$1–2 per run. Run logs land in `tmp/copy-refresh-<timestamp>.json` (gitignored). Expected workflow: run, review `git diff`, commit. Not wired into CI — refreshes are explicit, human-initiated.

`build_data.py` does **not** touch any of these three files.

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

## Email styling

`docs/email/buttondown-email.css` is the production email stylesheet. Paste its contents into Buttondown's **Custom CSS** field so issues delivered to inboxes match the archive site (Source Serif 4 headings, Source Sans 3 body, blue accent, mono section markers). The file uses system-font fallbacks (Charter, Iowan Old Style, SF Mono) since most email clients don't load remote fonts.

## Still Needed

1. **GitHub Actions secrets** — `BUTTONDOWN_API_KEY` and `STRIPE_API_KEY` must be set in repo settings
2. **HTTPS enforcement** — enable in GitHub Pages settings after first successful deploy
3. **Stripe donate URL** — Payment Link for one-time donations on `/members/`

## Future Enhancements

- **"Talk to the Archive" agent interface** — conversational AI over the archive (RAG pipeline)
- **Issue tagging/categorization** — browsable topic categories
