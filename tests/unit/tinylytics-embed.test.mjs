// Tinylytics' one script for every site (2026-11): https://tinylytics.app/js/script.js with only
// data-site set. Kudos, hits, countries, events and beacon live in the site's Tinylytics settings,
// so the tag takes no query; the old per-site embed/<id>.js?... must be gone from every page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../apps/site/", import.meta.url).pathname;

test("the base layout loads the new Tinylytics script with data-site", () => {
  const base = readFileSync(join(root, "_includes/layouts/base.njk"), "utf8");
  assert.match(base, /script\.defer = true;/);
  assert.match(base, /script\.src = 'https:\/\/tinylytics\.app\/js\/script\.js';/);
  assert.match(base, /script\.dataset\.site = '\{\{ site\.tinylyticsId \}\}';/);
  assert.equal((base.match(/tinylytics\.app\/js\/script\.js/g) || []).length, 1);
});

test("no template carries the old Tinylytics embed", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(njk|html|js|mjs|md)$/.test(name) && /tinylytics\.app\/embed\//.test(readFileSync(path, "utf8"))) {
        offenders.push(path.slice(root.length));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
