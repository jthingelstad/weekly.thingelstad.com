# apps/site/ — project memory

Operational notes for working in the Eleventy site. Human-facing overview lives in
[`README.md`](README.md). This repo is a **render surface**; the producer is Studio (`studio-thing`).
Repo-wide notes: [`../../CLAUDE.md`](../../CLAUDE.md).

## Eleventy invocation

Invoked from the **repo root** via `eleventy --config apps/site/eleventy.config.js` (see `package.json`
scripts: `npm run build`, `npm run build:search`). The output dir `_site/` stays at the repo root so CI's
`upload-pages-artifact` step picks it up unchanged. **Don't move `_site/` under `apps/site/`.**

- **Input:** `apps/site` / **Output:** `_site` (at the repo root)
- **Template formats:** `njk`, `md`
- **Markdown:** `markdown-it` with `markdown-it-anchor` for heading IDs (Pagefind needs them)
- **Collections:** `issuesByNumber` (ascending), `issuesByDate` (newest first)
- **Filters:** `dateFormat`, `dateShort`, `currentYear`, `numberFormat`, `year`, `slice`, `truncate`,
  `issueNumberBase`, `xmlEscape`, `markdownify`, `extractToc`, `groupByYear`
- **Passthrough copy:** `img/`, `css/`, `CNAME`, `favicon.svg`, `_nojekyll`

## Where the content comes from — Studio, not here

`apps/site/archive/{N}.md` is **generated upstream and pushed in by Studio's handoff**, not built in this
repo. The canonical body lives in `studio-thing/data/issues/{N}/archive.md`; Studio's
`pipeline/content/content.py build` writes the 11ty-shaped `{N}.md` (front matter: `layout: archive`,
`permalink: /archive/{N}/`, `tags: ["issue"]`, audio fields) and commits it here.

Every generated file carries an inline notice (`<!-- Generated … do not edit directly. -->`).
**Editorial fixes go upstream in Studio**, never in `apps/site/archive/` here — the next handoff
overwrites local edits.

## `_data/` files — source of truth

Knowing which is which matters: hand-edits to non-authored files get clobbered.

**Pushed in by Studio** (don't hand-edit): `emails.json` (issue index), `status.json` (`/ops/` state).
The topic graph `data/librarian/graph.json` is pushed too.

**Fetched by weekly's own CI:** `stats.json` — subscriber + Stripe figures. This is a *presentation*
concern (the landing-page numbers), so weekly owns it. Studio reads the same figures for agent analysis —
a separate concern — so both holding access is by design, not duplication. Don't hand-edit `stats.json`.

**Refreshed via a Studio copy pipeline (then committed here):** `voiceSamples.json` — home-page
pull-quotes, pulled verbatim from real issues. Infrequent, explicit, human-reviewed — not in CI.

**Hand-authored** (edit directly): `site.js`, `support.json`, `quotes.json`, `survey.json`, `topics.js`,
`redirects.js`, `assets.js`, `faq.js`.

**Computed at build time** (JS data files run during 11ty):
- `archiveStats.js` — totals (links, words, domains), per-year breakdowns, records, streaks. Reads `emails.json`.
- `supportTotals.js` — supporter program totals. Reads `support.json` + `stats.json`.
- `faq.js` — self-contained FAQ page data (previously re-exported from the Librarian Lambda; that
  dependency was dropped so weekly carries no brain code).

## Pages

`/` (hand-written landing), `/archive/` (year-grouped from `issuesByDate`), `/archive/N/` (generated
per-issue, `layout: archive`), `/archive/<slug>/` redirects (`redirects.njk` + `_data/redirects.js`),
hand-written `/about/ /members/ /faq/ /search/`, `/feed.xml`, `/archive/N/links.xml`, `/podcast.xml`,
`/thingy/` (redirect to standalone Thingy), `/ops/` + `/status.json` (unlinked, noindex, `Disallow`'d in
`robots.txt`, read from `_data/status.json`).

## Pagefind

Runs **after** the Eleventy build and indexes the built HTML in `_site/`. CI does this as a separate step
(`npm run build:search`). UI styling overrides need `!important` because Pagefind UI resets its
container's CSS; `data-pagefind-filter` survives until reindex.

## Subscribe forms + reader-recognized state

Multiple subscribe forms read from `localStorage`:

- `tokenKey` (JWT, hash-only) — drives the "you're already subscribed" recognized state
- `emailKey` (plaintext, prefill only)

A recognized reader sees a dim subscribe button + placeholder email — **no new panels**, just the existing
form acknowledges them. The "Forget me" link clears both keys; the label is **Forget me** site-wide (not
Logout / Sign out / Use different email).

## Deploy

GitHub Actions → GitHub Pages, triggered by push to `main` (Studio's handoff commit, or a hand-authored
change). Render-only: `npm ci` → fetch stats → `npm run build` → `npm run build:search` → deploy. No
Python, no Lambda — those run in Studio.

## Conventions

- **Never edit `apps/site/archive/*.md` or the pushed `_data` files.** Fix upstream in Studio.
- **Tinylytics site UID** lives in `_data/site.js` — safe in the repo (it's a public identifier).
- **CSS** lives in `apps/site/css/style.css`. (The Buttondown email CSS moved to Studio with the rest of
  the newsletter config.)
- **`topics.js`** reads the pushed `data/librarian/graph.json`; a stale code comment may still mention
  `librarian-core` (the generator), which now lives in Studio.
