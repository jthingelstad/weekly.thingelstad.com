# apps/site/ — project memory

Operational notes for working in the Eleventy site. Human-facing overview lives in
[`README.md`](README.md). This repo is a **render surface**; the producer is WT Builder (`wt-builder`).
Repo-wide notes: [`../../AGENTS.md`](../../AGENTS.md).

## Eleventy invocation

Invoked from the **repo root** via `eleventy --config apps/site/eleventy.config.js` (see `package.json`
scripts: `npm run build`, `npm run build:search`). The output dir `_site/` stays at the repo root so CI's
`upload-pages-artifact` step picks it up unchanged. **Don't move `_site/` under `apps/site/`.**

- **Input:** `apps/site` / **Output:** `_site` (at the repo root)
- **Template formats:** `njk`, `md`
- **Markdown:** `markdown-it` with `markdown-it-anchor` for heading IDs (Pagefind needs them)
- **Collections:** `issuesByNumber` (ascending), `issuesByDate` (newest first)
- **Filters:** `dateFormat`, `dateShort`, `currentYear`, `numberFormat`, `year`, `slice`, `truncate`,
  `issueNumberBase`, `xmlEscape`, `htmlEscape`, `markdownify`, `extractToc`, `groupByYear`, `itunesDuration`, `clock`,
  `siteById` (one entry of `sites.json` by its id), `cardVersion` and `journalCount` (Share images)
- **Dates are Chicago days.** `dateFormat` (default and `month-year`), `dateShort`, `dateTimeShort`,
  `year`, `groupByYear` and `archiveStats` read the day in America/Chicago through `lib/siteTime.js`;
  `dateFormat('iso')` and `('rfc822')` stay UTC instants for feeds and the sitemap. Never slice a UTC
  date for a reader (`tests/unit/date-filters.test.mjs`, run in CI with `TZ=UTC`).
- **Passthrough copy:** `img/`, `css/`, `CNAME`, `favicon.svg`, `apple-touch-icon.png`, `_nojekyll`

## Where the content comes from — WT Builder, not here

`apps/site/archive/{N}.md` is **generated upstream and pushed in by WT Builder's website send**, not
built in this repo. WT Builder renders the 11ty-shaped `{N}.md` (front matter: layout, `permalink:
/archive/{N}/`, `tags: issue`, audio fields) from its canonical issue and commits it here; the same
issue's canonical text is committed to `librarian-thing/data/issues/{N}/` for the corpus.

Every generated file carries an inline notice (`<!-- Generated … do not edit directly. -->`).
**Editorial fixes go upstream in WT Builder**, never in `apps/site/archive/` here — the next handoff
overwrites local edits.

## `_data/` files — source of truth

Knowing which is which matters: hand-edits to non-authored files get clobbered.

The topic graph `data/librarian/graph.json` is pushed too.

**Fetched by weekly's own CI:** `stats.json` — subscriber + Stripe figures. This is a *presentation*
concern (the landing-page numbers), so weekly owns it. Don't hand-edit `stats.json`.

**Committed snapshot:** `voiceSamples.json` — home-page pull-quotes, pulled verbatim from real issues.
Its Studio refresh pipeline retired with Studio (2026-08-28); any refresh is infrequent, explicit,
human-reviewed — not in CI.

**Hand-authored** (edit directly): `site.js`, `support.json`, `quotes.json`, `survey.json`, `topics.js`,
`redirects.js`, `assets.js`, `faq.js`.

**Vendored from the thingelstad.com tree:** `sites.json` — a byte-for-byte copy of
`../shared/sites.json`, the one list of Jamie's sites. Never hand-edit it: change the shared file, then
`npm run sites:sync` (copy in) and commit; `npm run sites:check` fails when the copy is stale
(`scripts/sync-sites.mjs`, `SITES_SOURCE` overrides the source path).

The home page puts every `quotes.json` quote and every `voiceSamples.json` excerpt in the HTML, and an
inline script draws three of each on every visit (the wide lead slot only takes quotes of 90+
characters). `featured` now means only the no-JavaScript fallback: the first three featured quotes,
in file order. Adding a quote or an excerpt puts it in the rotation.

**Computed at build time** (JS data files run during 11ty):
- `archiveStats.js` — totals (links, words, domains), per-year breakdowns, records, streaks. Reads the
  issue pages' front matter through `lib/issueIndex.js`, as `topics.js` and `redirects.js` do.
- `supportTotals.js` — supporter program totals. Reads `support.json` + `stats.json`.
- `faq.js` — self-contained FAQ page data (previously re-exported from the Librarian Lambda; that
  dependency was dropped so weekly carries no brain code).

## Pages

`/` (hand-written landing), `/archive/` (year-grouped from `issuesByDate`), `/archive/N/` (generated
per-issue, `layout: archive`), `/archive/<slug>/` redirects (`redirects.njk` + `_data/redirects.js`),
hand-written `/about/ /members/ /faq/ /search/`, `/feed.xml`, `/feed.json`, `/archive/N/links.xml`, `/podcast.xml`,

The sitemap lists the pages and every issue, not the topic pages (2026-10-26; Jamie: "They are for
people, should we even include them in the sitemap?"). An issue's `<lastmod>` is its page's last
commit (`_data/issueEdited.js`, so CI checks out full history), falling back to the publish date.
The topics themselves are `graph.topics`, named upstream in `librarian-thing`
(`librarian_core.graph.site_topics`); `topics.js` only renders them.


## Share images

`layouts/base.njk` sets `og:image` and a large Twitter card on every page. An issue shares its own
card from cards.thingelstad.com (2026-10-25; Jamie: "Weekly Thing and Another Thing issues should get
custom share images with cards.thingelstad.com solution", then "text overlaid on the issue image with
the subtitle/dek included. Counts of links and journal entries?"):
`https://cards.thingelstad.com/weekly/archive/<n>.png?v=<hash>`, where `v` is the `cardVersion` hash
of what the card shows (subject, date, dek, cover, link count, word count), so an issue re-sent with
new words gets a new card. A topic page shares its newest cover (`topics.js` `image`). Any other page
(the home page, About, the FAQ, the archive, a topic with no cover) shares the newsletter's own card,
`https://cards.thingelstad.com/weekly/index.png?v=<hash>` (2026-10-25; Jamie: "make it rich and
inviting and equal to the quality of the thing it is previewing"): the hero line over the newest
cover, with the archive's size.

The front page's hero is an h-feed for it: `p-name` (`site.title`), `p-kicker` (the eyebrow),
`e-summary` (the hero line; its `<br>` and `<em>` are the card's lines and accent), `u-featured`
(`_data/defaultShareImage.js`, the newest cover) and `p-issue-count` / `p-link-count`
(`archiveStats.regularIssues` and `totalLinks`, the numbers the home page shows). The eyebrow and hero
line live in `_data/homeHero.js`, so the hero and the card's `v` read the same words.

The card maker reads only the page, so `layouts/issue.njk` is an h-entry: `p-name` (the subject),
`dt-published`, `p-summary` (the dek), `e-content`, `u-url`, `u-featured` (the cover, when there is
one) and two counts as `<data>`: `p-link-count` (the front matter's `links`) and `p-journal-count`
(the `journalCount` filter: the level-3 headings under the TOC's "Journal"). Keep those class names:
cards.thingelstad.com's `src/post.mjs` reads them. `tests/e2e/site.spec.js` pins the card URLs, the
h-entry and the front page's h-feed.

The issue lists are h-feeds too, for IndieWeb readers and parsers, not the card maker (it reads only the
front page's h-feed and the issue pages): `/archive/` (named by a `<data>` p-name) and each topic page
(named by its h1), with an h-entry per issue row (`p-name` and `u-url` on the title link,
`dt-published` on the date, `p-summary` on the dek). Classes on the markup already there, so nothing
readers see changes. Leave the front page's hero h-feed as it is.

The front page shows the newest issue as its card, with Read, Listen and Chat under it (2026-10-25;
Jamie: "The new share cards for weekly thing issues are so nice I think they would be better for the
current issue on the front page. The controls can go under it."). The `issueCard` filter builds an
issue's card URL for both that image and the issue page's `og:image`, so they stay one URL: the card
maker draws only the `v` the issue page names, and any other would cost a redirect.

## The sites strip

Every page on `layouts/base.njk` opens (right after the skip link, above the sticky header) with the
sites strip that tops all of Jamie's sites (`partials/sites-strip.njk`, CSS under "The
sites strip" in `css/style.css`). Its markup, class names, colours, sizes, phone behaviour and dark
values are a shared contract — thingelstad.com `AGENTS.md`, "The sites strip" — so change them there
first, never here alone; only the inner width (`--container-wide`) and side padding follow this site's
frame. It is built from `_data/sites.json` (sites with `in_sites_strip`, in file order, no client
JavaScript); this site is the `weekly` entry, marked current; every site reads as its `strip_label`, this one
included, so the wording matches every other site, and every link carries `?ref=sites-strip-weekly`
for Tinylytics. The strip
is set in Inter, the site's own face since it moved onto the shared type (`css/shared/`). Redirect pages
(`librarian*.njk`, `archive/redirects.njk`) have no layout and no strip. `tests/e2e/site.spec.js`
pins the links, the current marker, the phone row, and the Another Thing crimson and Things I've built
green marks, light and dark.

## Jamie, and links to his other sites

The conventions are thingelstad.com `AGENTS.md`, "Jamie on every site" and "Links between the sites".
The footer carries Jamie's h-card and `base.njk` a `<link rel="me">` for every `owner.rel_me`, both
from `_data/sites.json`; identity links never carry a ref. Photos are the bird-on-the-hat picture:
`owner.avatar` at 64px or less (issue byline, footer), `img/jamie-bird.jpg` (a copy of
`shared/jamie.jpg`) larger (home About, `/about/`). Every template link to another of Jamie's sites
carries `?ref=weekly-<placement>` (`&ref=` after Thingy's `?prompt=`/`?issue=`/`?from=`): footer,
byline, issue, archive, topic, card, search, 404, about, podcast, members, confirmed, subscribed.
Issue content, `_data/faq.json` (hand-synced with librarian-thing) and the `/thingy/` and
`/librarian/` redirects carry none. The favicon is the header's logo mark (accent circle, Source Serif 4
bold italic W as a path); `favicon.svg` and `apple-touch-icon.png` load with `?v=<hash>` from
`_data/assets.js`.

## The audio edition on the page and in the feed

WT Builder stamps `audio_url`, `audio_duration_seconds`, `audio_byte_size`, `audio_voice` and — since
WT350's regeneration (2026-09-21) — `audio_chapters_url`, `audio_transcript_url`, and the `audio_chapters`
list (`start`, `title`, `url?`, `image?`) into each issue page's front matter. `podcast.njk` prints the
enclosure, `<podcast:chapters>` and `<podcast:transcript>` (Podcasting 2.0; Apple Podcasts and Pocket
Casts read them, Overcast reads the same chapters from inside the mp3), and show notes listing every
chapter with its minute and link. `layouts/issue.njk` adds a "Listen by chapter" sidebar section (closed
until playback starts; the time seeks the hidden player) and a Transcript `<details>` under the article
that fetches the WebVTT from the CDN when opened (CORS is open there) and highlights the cue being
spoken. Cue text carries WebVTT's escapes (`&amp;` `&lt;` `&gt;`); the panel decodes them in a detached
textarea and sets each cue as `textContent`, never as HTML (2026-09-29). Every part is guarded on the fields existing,
though the back catalogue's audio is done: on 2026-10-25 all 354 issue pages (WT1 to WT353 and 140-special) carry
every one of them, a chapter list included.

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

GitHub Actions → GitHub Pages, triggered by push to `main` (a WT Builder handoff commit, a
`librarian-thing` graph push, or a hand-authored change). Render-only: `npm ci` → fetch stats →
`npm run build` → `npm run build:search` → install Playwright Chromium → `npm run test:e2e` → deploy.
No Lambda or corpus build — those run in `librarian-thing`.

## Conventions

- **Never edit `apps/site/archive/*.md` or the pushed `_data` files.** Fix upstream in WT Builder (or
  `librarian-thing` for the topic graph).
- **Feeds escape text twice inside HTML content.** A reader XML-decodes Atom `type="html"` content and RSS
  `<description>`, then reads it as HTML, so text set there goes through `htmlEscape | xmlEscape` (WT3's
  "D&D" is `D&amp;amp;D` in the file). Plain-text elements (Atom `type="text"`, titles, `itunes:summary`)
  take `xmlEscape` alone; CDATA (`content:encoded`) takes one HTML escape. `/archive.json` is listed in
  llms.txt and not in the head: `application/json` is JSON Feed 1.0's discovery type.
- **llms.txt keeps the llmstxt.org shape** (`llms.njk`): under every `##` heading (`###` starts a
  section too) each non-empty line is one `- [name](url): note` item, one link, no `[` or `]` in the
  name, and prose goes above the first `##`, because the reference parser (`llms-txt`) fails the whole
  file on one line without a link. The e2e test `llms.txt reads in the llmstxt.org reference parser`
  pins it; issue items go through the `issueItem` macro, and `## Optional` keeps its llmstxt.org name
  (links a reader may skip).
- **Tinylytics site UID** lives in `_data/site.js` — safe in the repo (it's a public identifier).
- **CSS** lives in `apps/site/css/style.css`. (Email styling is not here; WT Builder renders the email
  edition.)
- **`topics.js`** reads the pushed `data/librarian/graph.json`; a stale code comment may still mention
  `librarian-core` (the generator), which now lives in `librarian-thing`.

## The shared type

The site is set in the type all of Jamie's sites share: `css/shared/tokens.css` and its fonts, a
byte-for-byte copy of thingelstad.com `shared/tokens.css` and `shared/fonts/`, vendored with
`sites.json` by `npm run sites:sync` and checked by `npm run sites:check`. Headings are Inter Tight
800, reading text, labels and controls Inter, code a system mono; sizes follow the blog's scale
(`--jt-size-base` 19px body, 18px on phones, nothing below 14px) and `--container-wide` is the
shared 1120px frame. `style.css` names faces by role (`--font-heading`, `--font-body`, `--font-ui`,
`--font-label`, `--font-code`); never reintroduce a face by name. The serif lives on only in the W
mark, an SVG path (the favicon's), so no serif font loads.

No italics in the design (Jamie, 2026-10-22: "I really dislike italics with san serif fonts … I
like the color and I like using font weight with san serif"). Heading accents are the accent
colour at the heading's own weight, upright; quotes, captions and stamps stand upright too. Only the
base `em, i` rule slants, for emphasis inside an issue's text. `tests/unit/no-design-italics.test.mjs`
fails on any other italic rule. The header nav has no Thingy link: the sites strip carries it.
