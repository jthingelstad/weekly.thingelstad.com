// An issue link's heading_context is the Markdown source of the heading it sat
// under. The per-issue links feed printed it raw until 2026-11-23:
// From "[Title](https://…)" in Weekly Thing 346.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { headingLink } = require("../../apps/site/lib/headingLink.js");

test("a Markdown link gives its title and its address", () => {
  assert.deepEqual(
    headingLink("[The Other Reasons Why Podcasting is Hot](https://doc.searls.com/2026/04/24/the-other-reasons-why-podcasting-is-hot/)"),
    { text: "The Other Reasons Why Podcasting is Hot", url: "https://doc.searls.com/2026/04/24/the-other-reasons-why-podcasting-is-hot/" }
  );
});

test("brackets in the title and parentheses in the address stay whole", () => {
  assert.deepEqual(headingLink("[A [bracketed] title](https://example.com/a_(b))"), {
    text: "A [bracketed] title",
    url: "https://example.com/a_(b)",
  });
});

test("anything else is left as it is, with no address", () => {
  assert.deepEqual(headingLink("Journal"), { text: "Journal", url: null });
  assert.deepEqual(headingLink("[Not a link](javascript:alert(1))"), { text: "[Not a link](javascript:alert(1))", url: null });
  assert.deepEqual(headingLink("[]()"), { text: "[]()", url: null });
  assert.deepEqual(headingLink(null), { text: "", url: null });
});

test("every heading_context in the archive reads as a link", () => {
  const dir = new URL("../../apps/site/archive/", import.meta.url);
  let seen = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const frontMatter = readFileSync(new URL(name, dir), "utf8").split("\n---\n")[0];
    for (const match of frontMatter.matchAll(/^ {2}heading_context: (.+)$/gm)) {
      const raw = match[1].trim();
      if (raw === "null" || raw === "~" || raw === "''" || raw === '""') continue;
      // A YAML scalar on one line: single quotes double a quote, double quotes
      // escape with a backslash, plain is as written.
      const value = raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : raw.startsWith('"') ? JSON.parse(raw) : raw;
      const link = headingLink(value);
      assert.ok(link.url, `${name}: ${raw}`);
      assert.ok(!link.text.includes("]("), `${name}: ${raw}`);
      seen += 1;
    }
  }
  assert.ok(seen > 3000, `only ${seen} heading contexts read`);
});
