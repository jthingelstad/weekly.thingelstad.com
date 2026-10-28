// When each hand-written page's own words last changed, for the sitemap's
// <lastmod>: the last commit to the page's template, the partials it includes
// and the hand-authored data it reads, keyed by the page's path. The sitemap
// (sitemap.njk) takes the newer of this and the newest issue the page shows.
//
// Layouts and CSS are left out on purpose: a restyle is not new content, and a
// lastmod that moves on every deploy is one Google learns to ignore.
// stats.json is left out too: CI refreshes its subscriber figures on every
// build without a commit.
//
// A shallow clone has one commit, which would date every page today, so it
// returns nothing (issueEdited.js does the same). CI checks out full history.

const { execFileSync } = require("child_process");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const SOURCES = {
  "/": [
    "apps/site/index.njk",
    "apps/site/_data/homeHero.js",
    "apps/site/_data/quotes.json",
    "apps/site/_data/voiceSamples.json",
    "apps/site/_data/support.json",
    "apps/site/_data/survey.json",
    "apps/site/_includes/partials/subscribe-form.njk",
  ],
  "/archive/": ["apps/site/archive/archive.njk"],
  "/topics/": ["apps/site/topics/index.njk"],
  "/about/": ["apps/site/about.njk", "apps/site/_includes/partials/subscribe-form.njk"],
  "/members/": [
    "apps/site/support.njk",
    "apps/site/_data/support.json",
    "apps/site/_data/supportTotals.js",
    "apps/site/_includes/partials/upgrade-form.njk",
  ],
  "/search/": ["apps/site/search.njk"],
  "/podcast/": ["apps/site/podcast-page.njk"],
  "/faq/": ["apps/site/faq.njk", "apps/site/_data/faq.json"],
};

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function pageEdited() {
  try {
    if (git(["rev-parse", "--is-shallow-repository"]) !== "false") return {};
    const edited = {};
    for (const [page, files] of Object.entries(SOURCES)) {
      const date = git(["log", "-1", "--format=%cI", "--", ...files]);
      if (date) edited[page] = date;
    }
    return edited;
  } catch {
    return {};
  }
}

module.exports = pageEdited;
module.exports.SOURCES = SOURCES;
