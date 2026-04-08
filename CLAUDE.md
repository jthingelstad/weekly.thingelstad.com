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

### Architecture Pattern: 11ty + Python Data Pipeline

- **Python scripts** run first: fetch emails from Buttondown API, extract editorial links and domains, assign issue numbers, write individual `.md` files into `src/archive/` and a JSON index into `src/_data/`.
- **11ty** runs second: reads `.md` files as a collection and JSON data files, renders all pages with Nunjucks templates. Handles markdown rendering, heading anchors, TOC generation, and Buttondown template tag stripping.
- **Pagefind** runs third: indexes the built HTML for full-text search.

## Build & Run

```bash
# Setup
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && npm install

# Dev (uses cached API data if <1 hour old)
make serve

# Full production build
make build

# Force fresh API fetch
make fresh

# Sync local edits back to Buttondown
make sync          # dry-run
make sync-push     # actually push
make sync-issue    # single issue (interactive)
```

### Environment Variables

- `BUTTONDOWN_API_KEY` — required for API fetch. Local: `.env` file. CI: GitHub Actions secret.
- `STRIPE_API_KEY` — required for Stripe balance fetch. Same pattern.

## Project Structure

```
weekly.thingelstad.com/
├── .github/workflows/deploy.yml    # Build & deploy to GitHub Pages
├── scripts/
│   ├── build_data.py               # Orchestrator: fetch → process → write
│   ├── fetch_emails.py             # Buttondown API fetch + Stripe balance + caching
│   ├── process_emails.py           # Link extraction, issue numbering, word counts
│   ├── domain_exclusions.py        # Domains excluded from link/domain lists
│   ├── sync_to_buttondown.py       # Push local .md edits back to Buttondown API
│   └── convert_legacy.py           # One-time: HTML/MailChimp → markdown conversion
├── src/
│   ├── _data/
│   │   ├── emails.json             # Metadata index (generated, committed)
│   │   ├── archiveStats.js         # Computed stats from emails.json
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
│   │   ├── 1.md … 343.md          # One .md file per issue (generated, committed)
│   │   └── (plus special issues)
│   ├── index.njk                   # Landing page (/)
│   ├── about.njk                   # About page (/about/)
│   ├── support.njk                 # Supporting Membership (/support/)
│   ├── search.njk                  # Pagefind search (/search/)
│   ├── stats.njk                   # Archive statistics (/stats/)
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

**Domain exclusion list** (`scripts/domain_exclusions.py`): Excludes newsletter's own domains, Buttondown, image CDNs, URL shorteners, social media, Wikipedia, YouTube, and other utility domains from domain lists and stats.

## Archive Files (`src/archive/*.md`)

Each issue is a standalone markdown file with YAML front matter. The body is the **original markdown from Buttondown, unmodified** — Buttondown template tags (`{{ }}`, `{% %}`) are preserved for sync-back fidelity and stripped at render time by 11ty.

Front matter includes: `layout`, `buttondown_id`, `number`, `subject`, `publish_date`, `slug`, `description`, `image`, `absolute_url`, `domains` (list), `links` (list of editorial link objects), `word_count`, `permalink`, `tags`.

The `number` field determines the URL (`/archive/247/`). Assigned by the pipeline from subject line parsing; early issues without numbers are auto-numbered by date.

## 11ty Configuration (`eleventy.config.js`)

- **Input:** `src` / **Output:** `_site`
- **Template formats:** `njk`, `md`
- **Markdown:** `markdown-it` with `markdown-it-anchor` for heading IDs
- **Collections:** `issuesByNumber` (ascending), `issuesByDate` (newest first)
- **Filters:** `dateFormat`, `dateShort`, `currentYear`, `numberFormat`, `year`, `slice`, `truncate`, `issueNumberBase`, `xmlEscape`, `markdownify`, `extractToc`, `groupByYear`
- **Transform:** `stripButtondownTags` — removes Buttondown/Mailchimp template variables from rendered HTML
- **Passthrough copy:** `img/`, `css/`, `CNAME`, `favicon.svg`, `_nojekyll`

## Landing Page (`/`)

The landing page has these sections in order:

1. **Hero** — title, tagline, subscribe form, issue count
2. **Subject ticker** — scrolling list of recent issue topics
3. **Value proposition** — "Not an algorithm. Not a feed." + stats (total links, words, unique domains)
4. **Latest issue** — dedicated card with TOC preview and domain tags
5. **Mid-page subscribe CTA** — "Curious? Get it in your inbox every weekend."
6. **About the author** — photo, short bio, link to /about/
7. **How It Sounds** — 3 actual quotes from newsletter issues
8. **What Readers Say** — survey stats (82% recommend, 58% read whole issue, 73% 3+ year subscribers), feeling words cloud, 6 featured testimonial quotes from reader surveys
9. **Mid-page subscribe CTA** — "Join them. Free, every weekend."
10. **Recent issues** — 5 issue cards linking to archive
11. **Where the Links Come From** — top linked domains
12. **Supporting Membership** — current nonprofit, amount raised, member count
13. **Footer subscribe CTA** — "Start reading this weekend"

Subscribe forms appear 4 times on the page (hero, two mid-page, footer).

## Pages

| Path | Template | Description |
|------|----------|-------------|
| `/` | `index.njk` | Landing page |
| `/archive/` | `archive/archive.njk` | Browsable index, grouped by year |
| `/archive/N/` | Individual `.md` files | Issue pages with TOC, domains, prev/next nav |
| `/about/` | `about.njk` | Full bio, story, photo |
| `/support/` | `support.njk` | Supporting Membership, current nonprofit (EFF 2025), past (CC 2024) |
| `/search/` | `search.njk` | Pagefind search with bookmarkable URLs |
| `/stats/` | `stats.njk` | Archive statistics and records |
| `/faq/` | `faq.njk` | FAQ |
| `/feed.xml` | `feed.njk` | Atom feed (all issues) |
| `/archive/N/links.xml` | `issue-links-feed.njk` | Per-issue links feed |
| `/archive/<slug>/` | `redirects.njk` | Redirects from old Buttondown URLs |

## RSS Feeds

- **Main feed** (`/feed.xml`) — Atom, one entry per issue
- **Per-issue links feeds** (`/archive/N/links.xml`) — each editorial link as a feed item, useful for automation (e.g., posting to r/WeeklyThing)
- Auto-discoverable via `<link>` tags in `<head>`

## GitHub Actions (`.github/workflows/deploy.yml`)

**Triggers:** push to main, manual `workflow_dispatch`, weekly cron (Sunday 6am UTC / midnight CST)

**Pipeline:**
1. Setup Python 3.13 + Node 22
2. `pip install` + `npm ci`
3. `python scripts/build_data.py` (with `BUTTONDOWN_API_KEY` and `STRIPE_API_KEY` secrets)
4. `npx @11ty/eleventy`
5. `npx pagefind --site _site --glob "**/*.html"`
6. Auto-commit new issues to git if data pipeline produced changes
7. Upload and deploy to GitHub Pages

**Action versions:** checkout@v5, setup-python@v5, setup-node@v5, upload-pages-artifact@v4, deploy-pages@v5

## Bidirectional Sync

Archive `.md` files can be edited locally and synced back to Buttondown:

```bash
python scripts/sync_to_buttondown.py --dry-run          # preview changes
python scripts/sync_to_buttondown.py                      # push all changes
python scripts/sync_to_buttondown.py --issue 42           # push single issue
```

Compares local body against cached API data, PATCHes changed fields to Buttondown API.

## Data Files

- **`emails.json`** — lightweight metadata index (no body content), used by landing page, archive, feeds, redirects
- **`archiveStats.js`** — computes stats at build time from emails.json: total links, words, domains, per-year breakdowns, records, streaks
- **`stats.json`** — subscriber count, premium subscriber count, Stripe amount raised (generated by pipeline)
- **`site.json`** — title, description, URL, author info, Tinylytics ID (`MVJU_jZJ-3RC6Q14sDky`), social links
- **`support.json`** — current nonprofit (EFF 2025), past nonprofits (CC 2024), Stripe donate URL
- **`quotes.json`** — 25 reader quotes from 2021 and 2025 surveys, with `tags`, `source` year, and `featured` flag
- **`survey.json`** — reader survey stats, feeling words with frequencies, subscriber tenure, reading approach data

## Design

- **Aesthetic:** Clean, editorial, warm. Typography-forward (Charter serif for body/headings, system sans for UI). Generous whitespace.
- **Colors:** `#faf9f7` bg, `#c44d2b` accent, dark mode via `prefers-color-scheme`
- **No JS required** for core reading. JS only for subscribe form, Pagefind search, and Tinylytics.
- **Accessible:** proper heading hierarchy, alt text, color contrast, keyboard nav
- **Mobile-first** responsive design

## Still Needed

1. **GitHub Actions secrets** — `BUTTONDOWN_API_KEY` and `STRIPE_API_KEY` must be set in repo settings
2. **HTTPS enforcement** — enable in GitHub Pages settings after first successful deploy
3. **Stripe donate URL** — Payment Link for one-time donations on `/support/`
4. **Social links** — Mastodon and Bluesky URLs in `site.json` (Reddit is set)

## Future Enhancements

- **"Talk to the Archive" agent interface** — conversational AI over the archive (RAG pipeline)
- **Issue tagging/categorization** — browsable topic categories
- **Open Graph meta tags** — `og:title`, `og:description`, `og:image` per issue
