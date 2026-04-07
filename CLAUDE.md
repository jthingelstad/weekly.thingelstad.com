# The Weekly Thing — Custom Landing Page & Archive Site

## Project Overview

Build a custom landing page and full archive site for **The Weekly Thing**, a weekly newsletter by Jamie Thingelstad published for 8+ years. The site replaces Buttondown's limited hosted landing page while continuing to use Buttondown as the email publishing engine.

**Live URL:** `weekly.thingelstad.com` (currently points to Buttondown's hosted page)
**Hosting:** GitHub Pages
**Site Generator:** Eleventy (11ty) for templating and site generation
**Data Pipeline:** Python scripts for Buttondown API fetch, link/domain extraction, and writing archive markdown files
**Data Source:** Buttondown API (build-time only)

### Architecture Pattern: 11ty + Python Data Pipeline

This project uses **11ty for site generation** and **Python for the data pipeline**. This is a pattern Jamie uses in other projects.

- **Python scripts** run first: fetch emails from the Buttondown API, extract links and domains, assign issue numbers, and write the results as individual `.md` files (with YAML front matter and original markdown body) into `src/archive/` plus a lightweight JSON index into `src/_data/`.
- **11ty** runs second: reads the `.md` files as a collection and the JSON index for metadata, then renders all pages using Nunjucks templates. 11ty handles markdown → HTML rendering, heading anchors, and TOC generation.
- **Pagefind** runs third: indexes the built HTML for search.

This separation keeps the data processing in Python (easier to maintain) while leveraging 11ty's strengths for templating, collections, markdown rendering, and static site generation.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub Repository                                           │
│                                                              │
│  Step 1: Python data pipeline (scripts/)                     │
│  ├── fetch_emails.py        ← Buttondown API fetch + cache   │
│  ├── process_emails.py      ← extract links, assign numbers   │
│  ├── build_data.py          ← orchestrator                   │
│  ├── writes → src/_data/emails.json   (metadata index)       │
│  └── writes → src/archive/<number>.md (one per issue)        │
│                                                              │
│  Step 2: 11ty site generation                                │
│  ├── src/archive/*.md       ← issue collection               │
│  ├── src/_data/emails.json  ← metadata for index/feeds       │
│  ├── src/*.njk              ← landing, about, search, etc.   │
│  └── _site/                 ← build output                   │
│                                                              │
│  Step 3: Pagefind indexing                                   │
│                                                              │
│  Bidirectional sync                                          │
│  └── sync_to_buttondown.py  ← push .md edits back to API    │
│                                                              │
│  GitHub Actions                                              │
│  ├── Build & deploy to Pages on push                         │
│  └── Rebuild on Buttondown webhook                           │
└──────────────────────────────────────────────────────────────┘

Subscribe form: plain HTML POST to Buttondown embed endpoint
Archive content: individual .md files committed to repo
Search: Pagefind (runs post-build, indexes static HTML)
Analytics: Tinylytics (privacy-focused, cookie-free)
```

### Key Architectural Decisions

- **All archive content is hosted locally as static HTML.** No runtime API calls for readers.
- **Buttondown API key is only used at build time** (stored as a GitHub Actions secret: `BUTTONDOWN_API_KEY`).
- **Subscribe form POSTs directly to Buttondown's embed endpoint** — no serverless proxy needed, no API key exposed.
- **Python data pipeline runs before 11ty build**, writing a metadata index to `src/_data/emails.json` and individual issue files to `src/archive/<number>.md`.
- **Archive .md files are committed to git** — the repo contains the full archive, builds work without the API key, and files can be edited and synced back to Buttondown.
- **Pagefind runs after the 11ty build** to generate a static search index.
- **Buttondown webhook triggers a GitHub Actions workflow_dispatch** to rebuild on new issue publish.

## Python Dependencies

The data pipeline requires the following Python packages (manage via `requirements.txt`):

```
requests          # Buttondown API calls
stripe            # Stripe API for balance/amount raised
python-dotenv     # .env file support for local dev
pyyaml            # YAML front matter generation for .md files
```

Link and domain extraction from raw markdown can be done with regex or a lightweight parser — no heavy HTML rendering needed in Python since 11ty handles that.

Note: Markdown → HTML rendering, TOC generation, and heading anchors are all handled by 11ty's markdown-it configuration, not Python.

## Data Fetching

### `fetch_emails.py`

Fetch all published emails from the Buttondown API at build time using `requests`.

**Emails endpoint:** `GET https://api.buttondown.com/v1/emails`
**Auth:** `Authorization: Token <BUTTONDOWN_API_KEY>`
**Pagination:** The API paginates results. Fetch all pages by following the `next` URL in the response JSON.

Filter to only `status: "sent"` and `email_type: "public"` emails.

**Subscriber count:** Also fetch `GET https://api.buttondown.com/v1/subscribers` to get the total subscriber count. The response includes a `count` field in the paginated result. Write this count to `src/_data/site.json` (or a separate `src/_data/stats.json`) so it's available to templates for the landing page CTA (e.g., "Join 2,500+ readers").

**Premium subscriber count (Supporting Members):** Fetch `GET https://api.buttondown.com/v1/subscribers?type=premium` to get the count of supporting members. Write alongside the total subscriber count.

**Stripe balance (Amount Raised):** Fetch `GET https://api.stripe.com/v1/balance` using the Stripe secret key. The response returns `available` and `pending` amounts in cents. Sum both to get the total amount raised for the current campaign year. Write to `src/_data/stats.json` so it's available to the landing page and `/support/` page.

```
GET https://api.stripe.com/v1/balance
Authorization: Bearer <STRIPE_SECRET_KEY>
```

The `STRIPE_SECRET_KEY` is stored as a GitHub Actions secret and in the local `.env` file.

**Fields to use from each email object:**

| Field | Use |
|---|---|
| `id` | Unique identifier |
| `subject` | Issue title / page title |
| `body` | Markdown source content |
| `publish_date` | Publication date |
| `slug` | Buttondown archive slug (used for redirect pages from old URLs) |
| `description` | Meta description / summary |
| `image` | Featured image (if present) |
| `secondary_id` | Issue number if present (may be null for early issues — see auto-numbering below) |
| `absolute_url` | Original Buttondown archive URL (for redirects/reference) |

### Buttondown Template Tag Handling

Buttondown uses Django/Jinja-style template variables (e.g., `{{ subscriber.first_name }}`, `{{ subscribe_form }}`, `{{ unsubscribe_url }}`). These are rendered at send time for email recipients and will appear as raw template tags in the API response body.

**These tags must be preserved in the `.md` source files** so that the bidirectional sync with Buttondown works correctly. The tags are only stripped at render time by 11ty.

**The challenge:** Nunjucks (11ty's template engine) uses the same `{{ }}` and `{% %}` syntax. If left unhandled, 11ty will try to process Buttondown's template tags and either error or produce wrong output.

**Solution:** Implement a pre-render step in 11ty (transform, filter, or markdown-it preprocessor) that neutralizes Buttondown template tags before Nunjucks processes the file:
- Replace `{{ subscriber.* }}` with empty string or sensible defaults
- Remove `{{ subscribe_form }}` (we have our own subscribe UI)
- Remove `{{ unsubscribe_url }}`, `{{ manage_subscription_url }}`, `{{ upgrade_url }}`
- Remove `{% if %}` / `{% for %}` / `{% endif %}` / `{% endfor %}` blocks that reference subscriber-specific data
- Alternatively, escape all `{{ }}` and `{% %}` patterns in issue content using Nunjucks' `{% raw %}` / `{% endraw %}` blocks — the Python pipeline could wrap the body in these tags when writing the `.md` files, which tells Nunjucks to pass the content through without processing. Then a markdown-it plugin or 11ty transform strips the Buttondown-specific tags from the rendered HTML.
- Log any unhandled template tags during build so they can be reviewed

The key constraint: **the `.md` source files always contain the original Buttondown content, unmodified.**

### Markdown Processing

The markdown body from Buttondown is the source of truth for all archive content. The Python pipeline and 11ty split responsibilities:

**Python pipeline responsibilities:**
- **Preserve the original markdown body exactly as received from Buttondown.** Do not strip or modify Buttondown template tags (`{{ }}`, `{% %}`). The `.md` files must round-trip cleanly for the sync-back feature.
- **Link extraction:** Parse links from the markdown to extract `{ text, url, domain, heading_context }` for the links data and domain list. Use a lightweight markdown parse or regex — full HTML rendering is NOT needed here since 11ty handles that.
- **Domain extraction:** Derive unique FQDNs from extracted links, filtering through the exclusion list.
- **Write the original markdown** as the body of each issue's `.md` file.

**11ty responsibilities (via markdown-it configuration and pre-processing):**
- **Markdown → HTML rendering**
- **Buttondown template tag handling:** Before markdown rendering, strip or replace Buttondown template variables (`{{ subscriber.* }}`, `{{ subscribe_form }}`, `{{ unsubscribe_url }}`, `{% if %}` blocks, etc.). This must happen at render time in 11ty, NOT in the source `.md` files. Implement as an 11ty transform or a custom markdown-it plugin that preprocesses the raw markdown before rendering. Replace subscriber references with sensible defaults (e.g., `{{ subscriber.first_name }}` → empty string) and remove subscriber-specific conditional blocks entirely.
- **Heading anchor IDs:** Use `markdown-it-anchor` to generate stable, URL-friendly IDs on all headings (e.g., `## Interesting Article` → `id="interesting-article"`) with permalink icons.
- **Table of Contents:** Generate TOC from heading structure, either via `markdown-it-toc-done-right` or a custom 11ty filter/shortcode that extracts headings from the rendered content.

## Site Structure & Pages

### 1. Landing Page (`/`)

This is the most important page. It needs to convert visitors into subscribers.

**Content & Sections:**

1. **Hero / Header**
   - Newsletter name: "The Weekly Thing"
   - Tagline — something that communicates the value proposition clearly. Think: "A weekly collection of interesting links, ideas, and observations from across the internet." (To be refined collaboratively after archive is built.)
   - Prominent subscribe form (email input + submit button)
   - Social proof: "Published weekly for 8+ years" and subscriber count (e.g., "Join 2,500+ readers") — pulled from Buttondown API at build time

2. **About the Author**
   - Brief section about Jamie Thingelstad
   - Photo: `https://www.thingelstad.com/uploads/2020/29b8d62872.jpg` (download and host locally in `src/img/`)
   - Use the "Short" bio from https://www.thingelstad.com/about/bio/
   - Link to full about page
   - This section matters because Jamie's curation and perspective IS the product

3. **Latest Issue** (special prominent placement)
   - Dedicated section for the most recent issue — not just first in a list
   - Section heading like "This Week's Issue" or "Latest Issue"
   - Full title, publish date, description/excerpt
   - TOC preview (the heading structure of the issue)
   - Linked domains from the issue
   - Clear "Read this issue →" link

4. **What You'll Get / What to Expect**
   - Brief description of what a typical issue looks like
   - Mention: curated links, commentary, variety of topics (tech, culture, indie web, interesting finds)
   - Set expectations: arrives weekly (weekends), free, no spam

5. **Reader Quotes / Testimonials**
   - Pull from `src/_data/quotes.json` (see Content & Configuration section)
   - Display 2-4 quotes with attribution
   - Social proof from real readers

6. **Recent Issues Preview**
   - Show the 3-5 most recent issues (after the latest, so issues 2-6):
     - Subject/title
     - Publish date
     - Description or first ~100 words
     - Link to full archive page
   - This gives prospective subscribers a taste of actual content

7. **Browse the Archive**
   - Teaser/link to the full archive
   - Quick stats: total issues, years active

8. **Supporting Membership**
   - Compact section highlighting the community giving program
   - Current nonprofit being supported, amount raised so far, number of supporting members
   - Brief explanation: "100% of membership fees go to a nonprofit each year"
   - CTA to the `/support/` page for full details and to become a member or make a one-time gift
   - Keep this lighter than the subscribe CTA — it's an "and also" not the primary conversion

9. **Footer Subscribe CTA**
   - Second subscribe form at the bottom of the page
   - Social links: Mastodon, Bluesky, Reddit (r/weeklything)

**Subscribe Form HTML:**

```html
<form
  action="https://buttondown.com/api/emails/embed-subscribe/weekly-thing"
  method="post"
  class="embeddable-buttondown-form"
>
  <input type="email" name="email" placeholder="you@example.com" required />
  <input type="hidden" value="1" name="embed" />
  <button type="submit">Subscribe</button>
</form>
```

### 2. Archive Index (`/archive/`)

A browsable index of all issues.

**Features:**
- List of all issues, newest first
- Each entry shows: issue number, title/subject, publish date, description/excerpt
- Group by year with year headings for easy scanning
- Each entry links to the individual issue page
- Pagefind search box at the top of the archive
- Quick stats: total issues count

### 3. Individual Issue Pages (`/archive/<number>/`)

One page per newsletter issue. **Archive URLs use the issue number, not the title slug.** For example: `/archive/247/`. This makes URLs easy to type, share, and remember.

**Features:**
- Issue title (from `subject`)
- Publish date
- **Table of Contents** — generated from the markdown heading structure. Displayed as a sidebar or collapsible section at the top. Each TOC entry is an anchor link to that section within the page.
- **Linked Domains** — below the TOC, show a list of unique FQDNs linked to in this issue (e.g., `arstechnica.com`, `simonwillison.net`, `github.com`). Extract from the issue's links data. Exclude common utility domains (e.g., the newsletter's own domain, buttondown.com, common image hosts). This is a visual summary that gives readers a quick sense of what sources appear in the issue. Use `data-pagefind-filter="domain"` on each domain so Pagefind can filter search results by domain.
- Full rendered content from the markdown body
- **Every heading has a stable anchor ID** so that specific sections can be linked to directly. URL format: `/archive/247/#section-heading-id`. Include a small permalink icon next to each heading for easy copying.
- Previous/Next issue navigation
- Subscribe CTA at the bottom
- `data-pagefind-body` attribute on the content container for search indexing

### 4. About Page (`/about/`)

- Full bio for Jamie — use the "Full" bio from https://www.thingelstad.com/about/bio/
- Why The Weekly Thing exists — the story behind 8+ years of publishing
- Photo (same headshot as landing page)
- Links to Jamie's blog (thingelstad.com), social accounts
- Subscribe CTA

### 5. Support Page (`/support/`)

A page for the Supporting Membership program — the community fundraising initiative where all membership fees go to a nonprofit selected each year.

**Content:**
- **What Supporting Membership is** — brief explanation: all funds go to a nonprofit, changes annually, members get a gold star in each issue, newsletter remains free for everyone
- **Current nonprofit being supported** — name, description, link, logo/image. Pull from `src/_data/support.json`.
- **Amount raised this year** — pulled from Stripe API at build time. Displayed prominently (e.g., "$1,247 raised for Creative Commons this year").
- **Number of supporting members** — pulled from Buttondown API (premium subscriber count) at build time.
- **How to become a Supporting Member** — link to the Buttondown premium subscribe flow
- **One-time giving option** — a direct Stripe Payment Link or Stripe Checkout URL that allows anyone to contribute without subscribing through Buttondown. This bypasses the subscription model for people who just want to give.
- **Past nonprofits supported** — a simple list/history of previous years' nonprofits and amounts raised. Store in `src/_data/support.json`.

**`src/_data/support.json` structure:**

```json
{
  "current": {
    "nonprofit": "Creative Commons",
    "url": "https://creativecommons.org",
    "description": "Creative Commons stewards open licensing infrastructure...",
    "logo": "/img/creative-commons-logo.png",
    "year": 2025,
    "stripe_donate_url": "https://donate.stripe.com/XXXXXX"
  },
  "past": [
    {
      "nonprofit": "Previous Org",
      "url": "https://...",
      "year": 2024,
      "amount_raised": 1500.00
    }
  ]
}
```

### 6. Search Page (`/search/`)

- Pagefind search interface
- Full-text search across all archive issues
- Results should show issue title, date, and a content excerpt with highlighted matches
- **Bookmarkable search URLs:** The search query must be synced to the URL via a query parameter (e.g., `/search/?q=indie+web`). On page load, read the `q` parameter and pre-populate the search. On search input, update the URL with `history.replaceState`. This allows search results to be bookmarked and shared as direct links.

## RSS Feeds

Generate RSS feeds during the build:

### Main Feed (`/feed.xml`)
- Standard RSS/Atom feed with one entry per newsletter issue
- Include: title, publish date, description, link to archive page, full content or summary
- This is the primary feed

### Per-Issue Links Feeds (`/archive/<number>/links.xml`)
- One feed per issue, where each item is an individual link featured in that issue
- Each entry: link title/text, destination URL, the issue it appeared in, publish date of the issue
- This enables automation — e.g., a script can read the links feed for the latest issue and post each link to r/WeeklyThing on Reddit
- The links feed URL should be discoverable from each issue's archive page

**All feeds should be auto-discoverable** via `<link>` tags in the HTML `<head>`:
```html
<!-- On all pages -->
<link rel="alternate" type="application/rss+xml" title="The Weekly Thing" href="/feed.xml" />
<!-- On individual issue pages -->
<link rel="alternate" type="application/rss+xml" title="Links from Issue #247" href="/archive/247/links.xml" />
```

## Search — Pagefind

Use [Pagefind](https://pagefind.app/) for static full-text search.

### Setup
- Pagefind is language-agnostic — it just indexes the built HTML. Run via npx after the 11ty build:
  ```bash
  npx pagefind --site _site --glob "**/*.html"
  ```

### Indexing
- Add `data-pagefind-body` to the main content area of each archive issue page
- Use `data-pagefind-ignore` on navigation, footers, and subscribe forms
- Use `data-pagefind-meta` for structured metadata (issue title, date, issue number)
- Use `data-pagefind-filter="year"` to enable filtering by year
- Use `data-pagefind-filter="domain"` on each linked domain in the issue's domain list, enabling search queries like "show me issues linking to arstechnica.com"

### Search UI
- Use Pagefind's built-in UI component on the search page
- Style it to match the site's design
- Also consider adding a compact search input in the archive index page header and/or site navigation

## Design Direction

### Overall Aesthetic
- **Clean, editorial, and warm.** Think quality independent publication, not SaaS marketing page.
- Typography-forward: choose a distinctive serif or display font for headings, paired with a highly readable body font.
- Generous whitespace. The content is the star.
- Subtle, purposeful color palette. Not flashy. Confident and understated.
- Should feel personal — this is one person's curated newsletter, not a corporate product.
- Mobile-first responsive design.

### Design Constraints
- No JavaScript required for core reading experience (subscribe form, search, and Tinylytics analytics are acceptable exceptions)
- Fast page loads — it's a static site, keep it fast
- Accessible: proper heading hierarchy, alt text, color contrast, keyboard navigation
- Dark mode support via `prefers-color-scheme` media query

### Inspiration Direction
- Think: personal blogs with great typography (e.g., Craig Mod, Robin Rendle, Frank Chimero)
- The landing page should feel inviting, not pushy
- Archive pages should feel like a well-organized library

## GitHub Actions Workflow

### Build & Deploy

```yaml
name: Build and Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:  # For webhook-triggered rebuilds

permissions:
  contents: write    # For auto-committing new issues
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: pip install -r requirements.txt
      - run: python scripts/build_data.py
        env:
          BUTTONDOWN_API_KEY: ${{ secrets.BUTTONDOWN_API_KEY }}
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
      - run: npm ci
      - run: npx @11ty/eleventy
      - run: npx pagefind --site _site --glob "**/*.html"
      # If new issues were fetched, commit them back to the repo
      - name: Commit new issues
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add src/archive/ src/_data/emails.json
          git diff --staged --quiet || (git commit -m "Add new newsletter issue(s)" && git push)
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Webhook Rebuild

Configure Buttondown to send a webhook on email publish. The webhook should call the GitHub Actions API to trigger a `workflow_dispatch` event. This can be done via:

1. A simple Buttondown webhook pointing to:
   `https://api.github.com/repos/<owner>/<repo>/dispatches`
   with a `repository_dispatch` event type. (Requires a GitHub PAT stored in Buttondown's webhook config.)

2. Alternatively, use a scheduled rebuild (e.g., daily cron in GitHub Actions) as a simpler fallback.

**Cron fallback:**
```yaml
on:
  schedule:
    - cron: '0 6 * * 0'  # Every Sunday at 6am UTC (midnight CST)
```

## Custom Domain Setup

- Configure GitHub Pages custom domain to `weekly.thingelstad.com`
- Add `CNAME` file to the build output (`_site/`) containing: `weekly.thingelstad.com`
- Update DNS: CNAME record for `weekly` subdomain pointing to `<username>.github.io`
- Enable HTTPS in GitHub Pages settings

## Project Structure

```
weekly-thing-site/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── scripts/                     # Python data pipeline
│   ├── fetch_emails.py          # Buttondown API fetch + caching
│   ├── process_emails.py        # Link/domain extraction, issue numbering
│   ├── build_data.py            # Orchestrator: fetch → process → write files
│   ├── sync_to_buttondown.py    # Push local .md edits back to Buttondown API
│   └── domain_exclusions.py     # List of domains to exclude from domain lists
├── src/                         # 11ty source
│   ├── _data/
│   │   ├── emails.json          # Generated by Python pipeline (lightweight index, committed to repo)
│   │   ├── stats.json           # Generated by Python pipeline (subscriber count, supporting members, amount raised)
│   │   ├── support.json         # Supporting Membership config (nonprofit info, manually curated)
│   │   ├── quotes.json          # Reader testimonials (manually curated)
│   │   └── site.json            # Site metadata (title, description, URLs, Tinylytics ID)
│   ├── _includes/
│   │   ├── layouts/
│   │   │   ├── base.njk         # Base HTML layout
│   │   │   ├── page.njk         # Standard page layout
│   │   │   └── issue.njk        # Individual issue layout
│   │   ├── partials/
│   │   │   ├── header.njk
│   │   │   ├── footer.njk
│   │   │   ├── subscribe-form.njk
│   │   │   ├── toc.njk          # Table of contents partial
│   │   │   ├── linked-domains.njk  # Linked domains list partial
│   │   │   └── issue-card.njk   # Issue preview card
│   ├── index.njk                # Landing page
│   ├── about.njk                # About page
│   ├── support.njk              # Supporting Membership page
│   ├── search.njk               # Search page
│   ├── archive/
│   │   ├── archive.njk          # Archive index page
│   │   ├── 1.md                 # Generated by Python pipeline
│   │   ├── 2.md                 # one .md file per issue
│   │   ├── ...                  # (committed to repo)
│   │   └── 247.md
│   ├── feed.njk                 # Main RSS feed (one entry per issue)
│   ├── issue-links-feed.njk     # Per-issue links feed (pagination, generates /archive/<number>/links.xml)
│   ├── css/
│   │   └── style.css            # Main stylesheet
│   ├── img/                     # Static images (Jamie's photo, etc.)
│   └── CNAME                    # GitHub Pages custom domain
├── cache/                       # Local API response cache (gitignored)
├── _site/                       # Build output (gitignored)
├── .eleventy.js                 # 11ty configuration
├── package.json                 # Node/11ty dependencies
├── requirements.txt             # Python dependencies
├── Makefile                     # Convenience commands
├── .env.example                 # Example env vars
├── .gitignore
├── CLAUDE.md                    # This file
└── README.md
```

## Technical Notes

### Python Data Pipeline (`scripts/`)

The Python scripts run before 11ty and produce two outputs: a lightweight JSON index and individual markdown files for each issue.

**`scripts/build_data.py`** — Orchestrator script:
1. Calls `fetch_emails.py` to get raw email data from Buttondown API (with local caching)
2. Calls `process_emails.py` to process each email:
   - Extract links and unique FQDNs from the markdown (filtering through exclusion list)
   - Assign issue numbers (prefer `secondary_id` if numeric, otherwise auto-number sequentially by publish date)
   - Preserve the original markdown body exactly as received from Buttondown
3. Writes outputs:
   - **`src/_data/emails.json`** — lightweight index with metadata only (no body content)
   - **`src/archive/<number>.md`** — one markdown file per issue with YAML front matter and cleaned body content

### Output: Index File (`src/_data/emails.json`)

A lightweight index of all issues. Contains metadata only — no body content. Used by 11ty for the landing page (recent issues, latest issue), archive index, feed generation, and redirect pages.

```json
[
  {
    "id": "...",
    "number": 247,
    "subject": "The Weekly Thing #247",
    "publish_date": "2024-03-15T12:00:00Z",
    "slug": "the-weekly-thing-247",
    "description": "Meta description",
    "image": "https://...",
    "absolute_url": "https://buttondown.com/weekly-thing/archive/...",
    "domains": ["arstechnica.com", "simonwillison.net", "github.com"],
    "links": [
      {"text": "Article Title", "url": "https://example.com/article", "domain": "example.com", "heading_context": "Interesting Article"}
    ]
  }
]
```

### Output: Individual Issue Files (`src/archive/<number>.md`)

Each issue is a standalone markdown file. The Python pipeline writes these with YAML front matter containing metadata, and the body is the **original markdown content exactly as received from Buttondown** (including any template tags). 11ty handles template tag neutralization at render time. This preserves round-trip fidelity for the sync-back feature.

```markdown
---
layout: layouts/issue.njk
buttondown_id: "497f6eca-6276-4993-bfeb-53cbbbba6f08"
number: 247
subject: "The Weekly Thing #247"
publish_date: "2024-03-15T12:00:00Z"
slug: "the-weekly-thing-247"
description: "Meta description"
image: "https://..."
absolute_url: "https://buttondown.com/weekly-thing/archive/..."
domains:
  - arstechnica.com
  - simonwillison.net
  - github.com
links:
  - text: "Article Title"
    url: "https://example.com/article"
    domain: "example.com"
    heading_context: "Interesting Article"
permalink: "/archive/{{ number }}/"
tags: issue
---

The actual markdown content of the issue goes here...

## Some Heading

Content, links, commentary, etc.
```

**Key points about this approach:**
- 11ty handles markdown rendering natively — no need for the Python pipeline to pre-render HTML. The `toc` plugin and heading anchors are handled by 11ty's markdown-it configuration instead.
- The `tags: issue` field creates an 11ty collection, making it easy to iterate over all issues in templates.
- The `permalink` in front matter sets the URL to `/archive/247/`.
- Individual files are diffable, browsable, and easy to inspect or manually edit.
- The archive `.md` files are **committed to git**. This means the archive is browsable in the repo, builds don't require the Buttondown API key, and edits can be synced back to Buttondown via the sync script.

**Domain exclusion list:** Maintain a list in `scripts/domain_exclusions.py` or a simple text file. Exclude:
- The newsletter's own domain(s)
- `buttondown.com`, `buttondown.email`
- Common image CDNs (`imgur.com`, `cloudinary.com`, `cdn.*`)
- URL shorteners (`t.co`, `bit.ly`, `tinyurl.com`)
- Generic utility domains (`fonts.google.com`, `cdnjs.cloudflare.com`)

The exclusion list should be easy to edit as new noise domains are discovered.

The `number` field is critical — it determines the archive URL (`/archive/247/`). Assigned by the Python pipeline: prefer `secondary_id` if numeric, otherwise auto-number sequentially by publish date (oldest = 1).

### 11ty Configuration (`.eleventy.js`)

- Input directory: `src`
- Output directory: `_site`
- Template formats: `njk, md`
- **Collections:** Issues are a collection via the `issue` tag in front matter. Use `collections.issue` in templates, sorted by `number`.
- **Markdown-it configuration:** Configure with `markdown-it-anchor` for heading IDs and permalink icons, and `markdown-it-toc-done-right` or a custom TOC filter for generating table of contents from the markdown headings.
- Add date formatting filters
- Add truncation/excerpt filters
- Copy static assets (images, CSS, CNAME)
- Run Pagefind in the `eleventy.after` event or as a post-build step

**No pagination needed for issue pages** — each issue is its own `.md` file with a `permalink` in front matter. 11ty processes them directly.

### RSS Feeds (11ty)

Generate feeds using 11ty's Nunjucks templates (`.njk` files that output XML). 11ty handles this natively — no need for a separate feed library.

### Bidirectional Sync: Editing Archive Content

The archive `.md` files are committed to git and can be edited directly — by hand or with Claude Code. Changes can then be pushed back to Buttondown via the API, making the local files the source of truth for archive content.

**`scripts/sync_to_buttondown.py`**

This script compares local `.md` files against the cached API data and pushes changes back to Buttondown.

**How it works:**

1. Read each `src/archive/<number>.md` file — parse the YAML front matter to get the `buttondown_id`, and extract the markdown body (everything after the front matter).
2. Compare the local body against the last-fetched body from `cache/emails.json`.
3. If the body has changed, call `PATCH https://api.buttondown.com/v1/emails/{id}` with the updated `body` field.
4. If front matter fields like `subject` or `description` have changed, include those in the PATCH as well.
5. Report what was updated.

**Usage:**

```bash
# Sync all changed issues back to Buttondown
python scripts/sync_to_buttondown.py

# Sync a specific issue
python scripts/sync_to_buttondown.py --issue 42

# Dry run — show what would change without making API calls
python scripts/sync_to_buttondown.py --dry-run

# Sync and then refresh the local cache
python scripts/sync_to_buttondown.py --refresh
```

**Buttondown API for updates:**

```
PATCH https://api.buttondown.com/v1/emails/{id}
Authorization: Token <BUTTONDOWN_API_KEY>
Content-Type: application/json

{
  "body": "Updated markdown content...",
  "subject": "Updated subject line",
  "description": "Updated description"
}
```

**Safety considerations:**
- Always show a diff summary before pushing (unless `--yes` flag is passed)
- Never sync an empty body — treat this as an error
- Log all API calls and responses
- The `--dry-run` flag should be the recommended default for first-time use
- Consider storing a hash of the last-synced body in the front matter or a separate tracking file to detect conflicts (local edit vs. Buttondown edit)

**Workflow for archive cleanup with Claude Code:**

1. `make data` — pull latest archive from Buttondown
2. Open an issue file: `src/archive/42.md`
3. Ask Claude Code to clean it up — fix formatting, broken links, heading structure, etc.
4. Review the changes in git diff
5. `python scripts/sync_to_buttondown.py --issue 42 --dry-run` — preview what will be pushed
6. `python scripts/sync_to_buttondown.py --issue 42` — push the cleanup to Buttondown
7. Commit the cleaned file to git

This means the archive can be progressively cleaned up over time, with git tracking every change and Buttondown staying in sync.

### Local Development Caching

To avoid hitting the Buttondown API on every build during development:

- `fetch_emails.py` writes the API response to `cache/emails.json` after fetching
- On subsequent runs, if the cache file exists and is less than 1 hour old, use the cached data
- Add a `--no-cache` or `--fresh` flag to force a fresh API fetch
- The `cache/` directory is in `.gitignore`

### Makefile

```makefile
.PHONY: build serve clean data sync

data:
	python scripts/build_data.py

build: data
	npx @11ty/eleventy
	npx pagefind --site _site --glob "**/*.html"

serve: data
	npx @11ty/eleventy --serve

clean:
	rm -rf _site cache

fresh:
	python scripts/build_data.py --no-cache
	npx @11ty/eleventy --serve

sync:
	python scripts/sync_to_buttondown.py --dry-run

sync-push:
	python scripts/sync_to_buttondown.py

sync-issue:
	@read -p "Issue number: " num; \
	python scripts/sync_to_buttondown.py --issue $$num
```

### Environment Variables
- `BUTTONDOWN_API_KEY` — required for build-time data fetch and subscriber counts. In dev, use a `.env` file (add to `.gitignore`). In CI, use GitHub Actions secret.
- `STRIPE_SECRET_KEY` — required for fetching the Stripe balance (amount raised). Same `.env` / GitHub Actions secret pattern.
- Load via `python-dotenv` in the fetch script.

### Performance Considerations
- The initial build will fetch 400+ issues. The local cache avoids re-fetching during development.
- Each issue becomes its own HTML page. 11ty handles this volume easily.
- Images referenced in issues will still load from Buttondown's CDN or wherever they're hosted. This is fine for v1.
- Write a `_site/.nojekyll` file (via 11ty passthrough copy) to prevent GitHub Pages from running Jekyll on the output.

## Future Enhancements (Not in Scope for v1)

- **"Talk to the Archive" agent interface** — conversational AI that can answer questions about newsletter content. Build a RAG pipeline over the archive. This is a planned v2 feature.
- **Issue tagging/categorization** — tag issues by topic for browsable categories.
- **Reading time estimates** — calculate from word count and display on issue pages.
- **Social sharing meta tags** — Open Graph and Twitter Card meta for each issue page. **Include in v1** — high value, low effort. Each issue page should have `og:title`, `og:description`, `og:url`, and `og:image` (if the issue has a featured image). The landing page and about page should also have OG tags.

## Content & Configuration

### Resolved

1. **Buttondown username:** `weekly-thing` — subscribe form action URL is `https://buttondown.com/api/emails/embed-subscribe/weekly-thing`
2. **Bio and headshot:** Pull from https://www.thingelstad.com/about/bio/ — headshot URL is `https://www.thingelstad.com/uploads/2020/29b8d62872.jpg`, bio text available in micro/short/full versions. Use the "Short" bio for the landing page and the "Full" bio for the about page.
3. **Landing page content:** Will be developed iteratively after the archive is downloaded and integrated. Get the archive working first, then collaborate on the landing page copy.
4. **Issue numbering:** Early issues used dates instead of numbers. The Python pipeline must auto-number all issues sequentially by publish date (oldest = 1). Do NOT rely on `secondary_id` being present. Sort all emails by `publish_date` ascending and assign sequential numbers. If `secondary_id` is present and numeric, prefer it; otherwise auto-assign.
5. **Buttondown archive redirects:** The existing Buttondown archive uses slug-based URLs like `/archive/weekly-thing-244-fans-sameness-fediverse-ukraine/`. Since we have the `slug` field from the API, generate redirect pages (HTML meta refresh or 11ty redirect mechanism) from `/archive/<slug>/` → `/archive/<number>/` for all issues. This preserves existing links.

### Reader Quotes on Landing Page

Instead of a "best of" or "featured issues" section, the landing page should include a **reader quotes / testimonials section**. This needs a mechanism to provide and manage quotes:

- Store quotes in a data file: `src/_data/quotes.json`
- Each quote entry: `{ "text": "...", "author": "...", "source": "optional — e.g. email, Twitter" }`
- The landing page template renders a selection of these quotes as social proof
- Jamie will populate this file with reader feedback over time

```json
[
  {"text": "The best newsletter I look forward to every week.", "author": "A Reader"},
  {"text": "I always find something interesting I wouldn't have discovered on my own.", "author": "Another Reader"}
]
```

### Most Recent Issue — Special Landing Page Placement

The most recent issue should get prominent, special placement on the landing page — not just listed first in a "recent issues" list, but given a dedicated section (e.g., "This Week's Issue" or "Latest Issue") with the full title, date, description/excerpt, TOC preview, and a clear link to read it. This is above the general "Recent Issues" list which shows the next 3-5 issues.

### Tinylytics Integration

Tinylytics (tinylytics.app) is the analytics platform for this site. It is privacy-focused, cookie-free, and GDPR-compliant.

**Setup:** Add the Tinylytics embed script to the base template (`base.njk`), before the closing `</body>` tag:

```html
<script defer src="https://tinylytics.app/embed/TINYLYTICS_SITE_ID.js?kudos&hits"></script>
```

**Features to enable:**
- **Hit tracking** — automatic page view tracking on all pages
- **Kudos button** — add a `<button class="tinylytics_kudos"></button>` to each archive issue page, allowing readers to "like" individual issues. For the archive index with multiple issues, use `data-path` attributes: `<button class="tinylytics_kudos" data-path="/archive/247/"></button>`
- **Hit counter** — optionally display hit counts on pages
- **Event tracking** — add `?events` parameter to the script URL and use `data-tinylytics-event` attributes to track subscribe form submissions and other interactions

**Configuration:**
- `TINYLYTICS_SITE_ID` should be stored in `src/_data/site.json` so it's easy to update
- Style the kudos button to match the site's design
- The Tinylytics script is lightweight and doesn't require cookies, aligning with the site's privacy-respecting approach

### Still Needed from Jamie

1. **Buttondown API key** — for the build data fetch
2. **Stripe secret key** — for fetching the balance/amount raised at build time
3. **Stripe donate URL** — a Stripe Payment Link or Checkout URL for one-time donations on the `/support/` page
4. **Tinylytics site ID** — create a site in Tinylytics for `weekly.thingelstad.com` and provide the embed code ID
5. **Social links** — confirm current social accounts (Mastodon, Bluesky, Reddit are on current page)
6. **GitHub repo name** — where this project will live
7. **Reader quotes** — initial set of reader feedback/testimonials for the landing page
8. **Support page content** — current nonprofit info (name, URL, description, logo), and history of past nonprofits/amounts if available

## Development Workflow

1. Clone repo
2. `python -m venv venv && source venv/bin/activate`
3. `pip install -r requirements.txt && npm install`
4. Create `.env` with `BUTTONDOWN_API_KEY=<key>` and `STRIPE_SECRET_KEY=<key>`
5. `make serve` — runs Python data pipeline, then 11ty in serve mode with hot reload
6. `make build` — full production build (data pipeline + 11ty + pagefind)
7. Push to `main` → GitHub Actions builds and deploys to Pages

## Open Questions

- **Tagline:** The current "A Newsletter for Curious Minds" is a placeholder. Will be refined collaboratively after the archive is integrated and the landing page takes shape.
- **Landing page content:** The full copy for the landing page (hero, what to expect, etc.) will be developed iteratively once the archive is built and browsable. Get the architecture and archive working first.
