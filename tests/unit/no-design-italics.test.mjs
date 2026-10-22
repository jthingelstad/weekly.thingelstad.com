// No slanted sans in the design. Jamie, 2026-10-22: "I really dislike italics
// with san serif fonts … I like the color and I like using font weight with
// san serif". Accents are the accent colour at the heading's own weight; quotes
// and captions stand upright. The one italic rule left is the base `em, i`
// for emphasis Jamie writes inside an issue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../apps/site/css/style.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

test("only the base em and i rule sets an italic", () => {
  const slanted = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/font-style:\s*(italic|oblique)/.test(body)) slanted.push(selector.trim().replace(/\s+/g, " "));
  }
  assert.deepEqual(slanted, ["em, i"]);
});

test("nothing turns on a synthetic slant some other way", () => {
  assert.doesNotMatch(css, /font-variation-settings:[^;]*"slnt"/);
  assert.doesNotMatch(css, /transform:[^;]*skew/);
});
