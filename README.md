# weekly.thingelstad.com

The public website for [The Weekly Thing](https://weekly.thingelstad.com) — a newsletter Jamie has
published every weekend since May 2017. **This repo is a render surface.** The editorial source, the
authoring agents, the corpus, and the publishing pipeline live in the **Studio** repo (`studio-thing`);
this repo builds and deploys the site from content Studio produces and hands in.

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
- It does **not** hold the editorial source, the agents, the Thingy/Librarian Lambda, the corpus, or the
  publishing pipeline. Those are all in **Studio** (`studio-thing`).

**Producer → render split.** Studio is the brain: the `workshop_bot` agents (Eddy/Linky/Marky/Patty), the
Librarian Lambda, the corpus, and the canonical issue store (`data/issues`). On each ship, Studio builds
the 11ty inputs and commits them here via one atomic handoff. This repo just builds and deploys. See
`studio-thing/ALIGNMENT.md` for the full model.

---

## What lives where

| Path | What it is |
|---|---|
| [`apps/site/`](apps/site/) | The Eleventy static site — landing page, full archive, feeds. The only app here. |
| [`apps/files-cdn/`](apps/files-cdn/) | `robots.txt` for the `files.thingelstad.com` public asset domain. |
| `apps/site/archive/*.md` | **Generated, pushed in by Studio.** One page per issue. Do not edit here (the next handoff overwrites). |
| `apps/site/_data/` | A mix: pushed by Studio (`emails.json`, `status.json`), fetched by this repo's CI (`stats.json`), and hand-authored (`site.json`, `support.json`, `quotes.json`, `faq.json`, …). |
| `data/librarian/graph.json` | Topic graph, pushed by Studio; powers the site's topic pages. |
| [`tests/e2e/`](tests/e2e/) | Playwright end-to-end tests for the rendered site + the on-site Thingy UI. |

Editorial body, the agents, the pipeline, the publishing eras, link-extraction rules — all moved to
**Studio**. Start at `studio-thing/README.md` / `studio-thing/CLAUDE.md`.

---

## Architecture in one paragraph

Studio produces, weekly renders. `data/issues/{N}/archive.md` (in Studio) is the editorial source of
truth; Studio's CI builds the 11ty inputs (`apps/site/archive/*.md`, `_data/emails.json`,
`_data/status.json`, `data/librarian/graph.json`) and commits them here via the handoff. This repo's CI
runs Eleventy + Pagefind, fetches its own landing-page stats, and deploys to GitHub Pages. The Thingy
chat on the site is served by the Librarian Lambda (deployed from Studio) and also has its own standalone
home at [`thingy.thingelstad.com`](https://thingy.thingelstad.com).

---

## Quick start

```bash
npm ci
npm run build         # Eleventy
npm run build:search  # Pagefind
```

**Working on issue content?** That's a Studio task, not a weekly one. The `apps/site/archive/*.md` files
here are generated and overwritten by Studio's next handoff — edit the canonical body in
`studio-thing/data/issues/{N}/archive.md` instead.

---

## Secrets

Weekly holds only the credentials its **own** concerns require — currently the landing-page stats fetch
(subscriber/supporter numbers). It is not the producer: the production secrets (Buttondown publish,
OpenAI TTS, AWS, Librarian) live in Studio. Note that Studio reads the same stat figures too, but for a
different concern (agent analysis), so each repo holding its own access is by design, not duplication.

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
| `/thingy/` | `librarian.njk` | On-site Thingy chat (also standalone at thingy.thingelstad.com) |
| `/ops/` | `ops.njk` | **Unlinked, noindex.** Per-issue pipeline state. Reads `_data/status.json`. |

### Design

Editorial, magazine-like. Source Serif 4 for display + italic accents, Source Sans 3 for body/UI,
JetBrains Mono for eyebrows and meta. Generous whitespace. `#fcfcfa` background, `#1f6fd6` accent (deep
`#134d99`, soft `#e1edff`), dark mode via `prefers-color-scheme`. No JS required for core reading — JS
only for the subscribe form, Pagefind search, archive year filter, Thingy chat, and Tinylytics.
Mobile-first and accessible: heading hierarchy, alt text, color contrast, keyboard nav.

---

## How an issue reaches this site

The authoring happens in **Studio**, not here. Jamie works the issue with the agents in Discord;
`/eddy issue send` ships it (email to Buttondown, audio to S3, canonical commit to `studio-thing`).
Studio's CI then builds the 11ty inputs and commits them to this repo, which triggers the render-and-deploy
below. Weekly is purely the last hop.

---

## Tech stack

- **Node 22** — Eleventy site, Pagefind
- **Eleventy 3.x** — static site generator
- **Nunjucks** — templates
- **markdown-it** + `markdown-it-anchor` — body rendering with heading IDs
- **Pagefind** — search index
- **Playwright** — end-to-end tests
- **Tinylytics** — privacy-focused analytics

---

## Newsletter publishing history

Published continuously since May 13, 2017, across three email platforms (Tinyletter → MailChimp →
Buttondown). All bodies live in `studio-thing/data/issues/{N}/`; the era-specific stylistic fingerprints
and the scripts that process them are documented in `studio-thing/CLAUDE.md`.
