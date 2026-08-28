# apps/site/ — Eleventy static site

The Eleventy site at [weekly.thingelstad.com](https://weekly.thingelstad.com): landing page, full archive,
feeds, search, FAQ, ops report. This is the one app in this repo — weekly is a **render surface**;
content is produced by **WT Builder** (`wt-builder`) and handed in; the topic graph comes from
`librarian-thing`. See [`../../README.md`](../../README.md).

> Operational memory for editing the site lives in [`CLAUDE.md`](CLAUDE.md).

## Run

```bash
# from the repo root
npm ci
npm run build         # production build → _site/
npm run build:search  # Pagefind index over _site/
# dev: npx @11ty/eleventy --config apps/site/eleventy.config.js --serve
```

Eleventy is invoked from the repo root with `--config apps/site/eleventy.config.js`. The output dir
`_site/` stays at the repo root so CI's `upload-pages-artifact` step picks it up unchanged.

## Layout

```
apps/site/
├── README.md             ← this file
├── CLAUDE.md             ← operational memory
├── eleventy.config.js    ← passthroughs, filters, collections, markdown setup
├── _data/                ← JSON + JS data files (see CLAUDE.md for source-of-truth per file)
│   ├── emails.json       ← (pushed by WT Builder) lightweight issue index
│   ├── stats.json        ← (fetched by weekly's CI) subscriber + Stripe figures
│   ├── voiceSamples.json ← home-page pull-quotes (its Studio refresh pipeline is retired)
│   ├── site.js           ← (hand-authored) URL, author, social, Tinylytics UID
│   ├── support.json      ← (hand-authored) current + past nonprofits
│   ├── quotes.json, survey.json, faq.js, redirects.js, topics.js, assets.js
│   ├── archiveStats.js   ← (computed at build) totals, records, streaks
│   └── supportTotals.js  ← (computed at build) supporter program totals
├── _includes/            ← layouts/ + partials/
├── archive/              ← {N}.md per issue — generated upstream, pushed in by WT Builder
├── css/, img/
├── index.njk, about.njk, support.njk, search.njk, faq.njk, …
├── feed.njk, issue-links-feed.njk, podcast.njk
├── librarian.njk, redirects.njk
└── CNAME, robots.txt, _nojekyll, favicon.svg
```

**Don't hand-edit `apps/site/archive/*.md`** — they're generated upstream and overwritten by the next
handoff. Fix the issue in WT Builder and re-send; historical repairs go in
`librarian-thing/data/issues/{N}/archive.md`.

## Pages

| Path | Template | What it is |
|---|---|---|
| `/` | `index.njk` | Landing page — hand-written |
| `/archive/` | `archive/archive.njk` | Year-grouped issue index |
| `/archive/N/` | Generated `{N}.md` | Issue page with TOC, domains, prev/next |
| `/about/` | `about.njk` | Bio + story |
| `/members/` | `support.njk` | Supporting Membership |
| `/search/` | `search.njk` | Pagefind search |
| `/faq/` | `faq.njk` | FAQ |
| `/feed.xml` | `feed.njk` | Atom feed |
| `/archive/N/links.xml` | `issue-links-feed.njk` | Per-issue links feed |
| `/podcast.xml` | `podcast.njk` | Podcast RSS |
| `/thingy/` | `librarian.njk` | Redirect to standalone Thingy chat at thingy.thingelstad.com |

## Design

Editorial, magazine-like. Source Serif 4 for display + italic accents, Source Sans 3 for body/UI,
JetBrains Mono for eyebrows and meta. `#fcfcfa` bg, `#1f6fd6` accent. Dark mode via
`prefers-color-scheme`. Mobile-first, accessible. No JS required for core reading.

## Search

[Pagefind](https://pagefind.app/) runs **after** the Eleventy build and indexes the built HTML in
`_site/`. CI runs `npm run build:search` as a separate step.

## Deploy

GitHub Actions → GitHub Pages on push to `main` (which is when Studio's handoff lands new content). See
[`../../.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

## Related reading

- [`CLAUDE.md`](CLAUDE.md) — operational memory (`_data/` source-of-truth, subscribe-state, Pagefind)
- [`../../README.md`](../../README.md) — this repo (the render surface)
- `wt-builder/` — the producer: authors each issue and writes `archive/{N}.md` on send
- `librarian-thing/` — the archive, corpus, and Librarian API; pushes the topic graph
