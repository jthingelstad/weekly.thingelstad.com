// IndexNow after a deploy: which changed files become URLs, and that a failed ping never throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEY, KEY_LOCATION, changedPageUrls, pingIndexNow, publicUrl } from "../../scripts/indexnow.mjs";

const sitemap = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://weekly.thingelstad.com/</loc></url>
  <url>
    <loc>https://weekly.thingelstad.com/archive/</loc>
  </url>
  <url><loc>https://weekly.thingelstad.com/archive/354/</loc></url>
  <url><loc>https://weekly.thingelstad.com/archive/355/</loc></url>
</urlset>`;

test("a built file maps to its public URL", () => {
  assert.equal(publicUrl("index.html"), "https://weekly.thingelstad.com/");
  assert.equal(publicUrl("archive/355/index.html"), "https://weekly.thingelstad.com/archive/355/");
  assert.equal(publicUrl("404.html"), "https://weekly.thingelstad.com/404.html");
});

test("only changed pages the sitemap lists are sent, once each and sorted", () => {
  const changed = [
    "archive/355/index.html",
    "index.html",
    "archive/index.html",
    "css/site.css",
    "img/wt-355.jpg",
    "pagefind/fragment/en_1.pf_fragment",
    "pagefind/pagefind.js",
    "feed.xml",
    "rss",
    "archive/355.txt",
    "404.html",
    "topics/ai/index.html", // noindex, kept out of the sitemap
    "archive/weekly-thing-for-may-13-2017/index.html", // a redirect page
    `${KEY}.txt`,
  ];
  assert.deepEqual(changedPageUrls(changed, sitemap), [
    "https://weekly.thingelstad.com/",
    "https://weekly.thingelstad.com/archive/",
    "https://weekly.thingelstad.com/archive/355/",
  ]);
  assert.deepEqual(changedPageUrls(["css/site.css", "pagefind/pagefind.js"], sitemap), []);
  assert.deepEqual(changedPageUrls([], sitemap), []);
});

test("nothing changed sends nothing; a dry run prints the protocol's body", async () => {
  const post = () => { throw new Error("must not post"); };
  assert.match(await pingIndexNow([], { post }), /nothing sent/);
  const dry = await pingIndexNow(["https://weekly.thingelstad.com/archive/355/"], { post, dryRun: true });
  const body = JSON.parse(dry.slice(dry.indexOf("{")));
  assert.deepEqual(body, { host: "weekly.thingelstad.com", key: KEY, keyLocation: KEY_LOCATION, urlList: ["https://weekly.thingelstad.com/archive/355/"] });
});

test("200 and 202 are accepted; any other answer or a network failure warns and never throws", async () => {
  const urls = ["https://weekly.thingelstad.com/"];
  const sent = [];
  const answer = (status) => async (url, init) => { sent.push([url, init]); return { status }; };
  assert.match(await pingIndexNow(urls, { post: answer(200) }), /^IndexNow: 200/);
  assert.match(await pingIndexNow(urls, { post: answer(202) }), /^IndexNow: 202/);
  assert.equal(sent[0][0], "https://api.indexnow.org/indexnow");
  assert.equal(sent[0][1].method, "POST");
  assert.match(sent[0][1].headers["content-type"], /^application\/json/);
  for (const status of [400, 403, 422, 429, 500]) assert.match(await pingIndexNow(urls, { post: answer(status) }), /^::warning::.*deployed/);
  assert.match(await pingIndexNow(urls, { post: async () => { throw new TypeError("fetch failed"); } }), /^::warning::.*deployed/);
});

test("the key file the site serves is exactly the key", () => {
  assert.match(KEY, /^[a-zA-Z0-9-]{8,128}$/);
  assert.equal(readFileSync(`apps/site/${KEY}.txt`, "utf8"), KEY);
  assert.equal(KEY_LOCATION, `https://weekly.thingelstad.com/${KEY}.txt`);
});
