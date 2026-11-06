// librarian-thing reads the source of these two templates as its site_page
// passages, dropping template tags and keeping the rest (pipeline/library/library.py,
// WEEKLY_SITE_FILES; librarian_core/corpus.py, _site_page_chunks). Thingy's words
// never enter the corpus, so on /members/, the page he hosts, they stay in
// partials/thingy-members.njk, which the library does not pull. support.njk keeps
// the neutral facts, which are what the corpus needs from the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const whatTheCorpusKeeps = (source) =>
  source.replace(/\{%.*?%\}/gs, "").replace(/\{\{.*?\}\}/gs, "");

test("the pages the corpus reads carry none of Thingy's words", async () => {
  for (const file of ["apps/site/about.njk", "apps/site/support.njk"]) {
    const kept = whatTheCorpusKeeps(await readFile(file, "utf8"));
    assert.doesNotMatch(kept, /thingy-host|from-thingy|From Thingy/i, file);
  }
  const members = whatTheCorpusKeeps(await readFile("apps/site/support.njk", "utf8"));
  assert.doesNotMatch(members, /\b(I|me|my)\b/, "support.njk speaks as nobody");
});

test("support.njk has no template comment, which the corpus would keep as text", async () => {
  // _strip_njk_page removes {% %} and {{ }} but not {# #}.
  assert.doesNotMatch(await readFile("apps/site/support.njk", "utf8"), /\{#/);
});

test("Jamie's why for this year's nonprofit is quoted exactly from where it links", async () => {
  const support = JSON.parse(await readFile("apps/site/_data/support.json", "utf8"));
  const { quote, url } = support.current.why;
  const issue = await readFile(`apps/site/archive/${url.match(/\d+/)[0]}.md`, "utf8");
  assert.ok(issue.includes(quote), `${quote} in ${url}`);
});
