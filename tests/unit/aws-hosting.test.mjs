// The S3 and CloudFront hosting: the viewer-request function (run here with a stand-in key value
// store), how each file is typed and cached, and the committed templates matching their source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewerRequestCode } from "../../infra/viewer-request.mjs";
import { certificate, site, delivery } from "../../infra/templates.mjs";
import { cacheControlFor, contentTypeFor } from "../../scripts/publish-plan.mjs";

const store = {
  "/archive/weekly-thing-for-may-13-2017/": "/archive/1/",
  "/thingy/": "https://thingy.thingelstad.com/chat/",
};
const cf = {
  kvs: () => ({
    get: async (key) => {
      if (key in store) return store[key];
      throw new Error("Key not found");
    },
  }),
};
const handler = new Function("cf", viewerRequestCode.replace("import cf from 'cloudfront';", "") + "\nreturn handler;")(cf);
const request = (uri, querystring = {}) => handler({ request: { uri, querystring } });

test("a redirect path is a 301 to its target, keeping the query", async () => {
  const r = await request("/archive/weekly-thing-for-may-13-2017/", { ref: { value: "powrss.com" } });
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location.value, "/archive/1/?ref=powrss.com");
  const t = await request("/thingy/", { prompt: { value: "What%20is%20GTD" } });
  assert.equal(t.headers.location.value, "https://thingy.thingelstad.com/chat/?prompt=What%20is%20GTD");
});

test("a redirect path without its slash goes straight to the target", async () => {
  const r = await request("/thingy");
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location.value, "https://thingy.thingelstad.com/chat/");
});

test("directory URLs serve index.html; a bare path gets its slash; files pass", async () => {
  assert.equal((await request("/archive/351/")).uri, "/archive/351/index.html");
  assert.equal((await request("/")).uri, "/index.html");
  const bare = await request("/archive/351", { ref: { value: "x" } });
  assert.equal(bare.statusCode, 301);
  assert.equal(bare.headers.location.value, "/archive/351/?ref=x");
  assert.equal((await request("/feed.xml")).uri, "/feed.xml");
  assert.equal((await request("/rss")).uri, "/rss");
});

test("feeds are typed by what they are, and Atom stays compressible", () => {
  const atom = '<?xml version="1.0"?>\n<feed xmlns="http://www.w3.org/2005/Atom">';
  const rss = '<?xml version="1.0"?>\n<rss version="2.0"';
  assert.equal(contentTypeFor("rss", atom), "application/xml; charset=utf-8");
  assert.equal(contentTypeFor("feed.xml", atom), "application/xml; charset=utf-8");
  assert.equal(contentTypeFor("CNAME", "weekly.thingelstad.com"), "application/octet-stream");
  assert.match(contentTypeFor("podcast.xml", rss), /^application\/rss\+xml/);
  assert.match(contentTypeFor("sitemap.xml", '<?xml version="1.0"?>\n<urlset'), /^application\/xml/);
  assert.match(contentTypeFor("archive/351/index.html"), /^text\/html; charset=utf-8/);
  assert.match(contentTypeFor("llms.txt"), /^text\/plain; charset=utf-8/);
  assert.equal(contentTypeFor("pagefind/fragment/en_1.pf_fragment"), "application/octet-stream");
});

test("pages are short in browsers and cleared from CloudFront by each deploy", () => {
  assert.equal(cacheControlFor("index.html"), "public, max-age=300, s-maxage=86400");
  assert.equal(cacheControlFor("css/shared/fonts/inter.woff2"), "public, max-age=604800");
});

test("the committed templates are what infra/templates.mjs writes", () => {
  for (const [name, body] of Object.entries({ certificate, site, delivery }))
    assert.deepEqual(JSON.parse(readFileSync(`infra/generated/${name}.json`, "utf8")), body, `run npm run infra:generate (${name})`);
});
