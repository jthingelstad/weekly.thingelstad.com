# weekly.thingelstad.com

The public website for [The Weekly Thing](https://weekly.thingelstad.com) — a newsletter Jamie has
published every weekend since May 2017. **This repo is a render surface.** Authoring and publishing
live in **WT Builder** (`wt-builder`); the canonical issue archive, corpus, and Librarian API live in
**`librarian-thing`**. This repo builds and deploys the site from the inputs they commit in.

**Live URL:** `weekly.thingelstad.com`
**Site generator:** Eleventy 3.x with Nunjucks templates
**Hosting:** GitHub Pages
**Search:** Pagefind (static, runs post-build)
**Analytics:** Tinylytics (privacy-focused, cookie-free)

---

## What this repo is (and isn't)

A **pure render surface, plus its own landing-page stats**:

- It renders the 11ty site from generated inputs and deploys to GitHub Pages.
- It fetches its *own* landing-page numbers (subscriber/supporter stats) in CI — a presentation concern
  that belongs to the site.
- It does **not** hold the editorial source, the publishing pipeline, the Librarian Lambda, or the
  corpus. Publishing is **WT Builder** (`wt-builder`); the archive, corpus, and API are
  **`librarian-thing`**.

**Producer → render split.** WT Builder authors each issue and, on send, commits the 11ty inputs here
as one atomic handoff — and commits the canonical issue text into `librarian-thing/data/issues/`.
`librarian-thing` pushes one file here: the topic graph. This repo just builds and deploys. See
`librarian-thing/ALIGNMENT.md` for the full model. (Until WT Builder's first real issue ships, the
Shortcuts workflow remains the fallback producer.)

---

## What lives where

| Path | What it is |
|---|---|
| [`apps/site/`](apps/site/) | The Eleventy static site — landing page, full archive, feeds. The only app here. |
| [`apps/files-cdn/`](apps/files-cdn/) | `robots.txt` for the `files.thingelstad.com` public asset domain. |
| `apps/site/archive/*.md` | **Generated, pushed in by WT Builder.** One page per issue. Do not edit here (the next handoff overwrites). |
| `apps/site/_data/` | A mix: pushed by WT Builder (`emails.json`), fetched by this repo's CI (`stats.json`), and hand-authored (`site.json`, `support.json`, `quotes.json`, `faq.json`, …). `status.json` is a frozen snapshot of the retired Studio pipeline until `/ops/` is reworked. |
| `data/librarian/graph.json` | Topic graph, pushed by `librarian-thing`; powers the site's topic pages. |
| [`tests/e2e/`](tests/e2e/) | Playwright end-to-end tests for the rendered site + the legacy Thingy redirect. |

Editorial bodies and the archive live in **`librarian-thing`** (`data/issues/{N}/`); authoring and
publishing live in **WT Builder**. Start at `wt-builder/README.md` and `librarian-thing/README.md`.

---

## Architecture in one paragraph

WT Builder produces, weekly renders. WT Builder holds the live issue, renders the editions, and on
send commits the 11ty inputs here (`apps/site/archive/*.md`, `_data/emails.json`) and the canonical
text into `librarian-thing/data/issues/{N}/`. `librarian-thing` rebuilds the corpus from that and
pushes `data/librarian/graph.json` here. This repo's CI
runs Eleventy + Pagefind, fetches its own landing-page stats, and deploys to GitHub Pages. Thingy runs
as a standalone app at [`thingy.thingelstad.com`](https://thingy.thingelstad.com); this site links and
redirects readers to its chat surface.

---

## Quick start

```bash
npm ci
npm run build         # Eleventy
npm run build:search  # Pagefind
```

**Working on issue content?** That's a WT Builder task, not a weekly one. The `apps/site/archive/*.md`
files here are generated and overwritten by the next handoff — edit the issue in WT Builder and
re-send; historical repairs go in `librarian-thing/data/issues/{N}/archive.md`.

---

## Secrets

Weekly holds only the credentials its **own** concerns require — currently the landing-page stats fetch
(subscriber/supporter numbers). It is not the producer: the publishing secrets (Buttondown, OpenAI
TTS, AWS, GitHub handoff) live in WT Builder, and the corpus/Lambda deploy secrets live in
`librarian-thing`.

GitHub Pages deploys with the default `GITHUB_TOKEN`.

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
| `/archive/N/links.xml` | `issue-links-feed.njk` | Per-issue links feed |
| `/podcast.xml` | `podcast.njk` | Podcast RSS feed |
| `/thingy/` | `librarian.njk` | Redirect to standalone Thingy chat at thingy.thingelstad.com |
| `/ops/` | `ops.njk` | **Unlinked, noindex.** Reads `_data/status.json` — a frozen snapshot of the retired Studio pipeline, pending rework against WT Builder. |

### Design

Editorial, magazine-like. Source Serif 4 for display + italic accents, Source Sans 3 for body/UI,
JetBrains Mono for eyebrows and meta. Generous whitespace. `#fcfcfa` background, `#1f6fd6` accent (deep
`#134d99`, soft `#e1edff`), dark mode via `prefers-color-scheme`. No JS required for core reading — JS
only for the subscribe form, Pagefind search, archive year filter, Thingy handoffs, and Tinylytics.
Mobile-first and accessible: heading hierarchy, alt text, color contrast, keyboard nav.

---

## How an issue reaches this site

The authoring happens in **WT Builder**, not here. Jamie assembles the issue there; sending runs per
destination — audio to the CDN, the email draft to Buttondown, the site inputs committed to this repo
(which triggers the render-and-deploy below), and the canonical text committed to
`librarian-thing/data/issues/` for the corpus. Weekly is purely the last hop.

---

## Tech stack

- **Node 24** — Eleventy site, Pagefind
- **Eleventy 3.x** — static site generator
- **Nunjucks** — templates
- **markdown-it** + `markdown-it-anchor` — body rendering with heading IDs
- **Pagefind** — search index
- **Playwright** — end-to-end tests
- **Tinylytics** — privacy-focused analytics

---

## Newsletter publishing history

Published continuously since May 13, 2017, across three email platforms (Tinyletter → MailChimp →
Buttondown). All bodies live in `librarian-thing/data/issues/{N}/`; the era-specific extraction rules
live in `librarian-thing`'s `librarian_core.links`.
