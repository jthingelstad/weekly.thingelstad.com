// A deploy skips the redirect store only when the map matches the record of the last finished sync; any
// doubt is a full sync. The record lives in the site bucket, so it must survive the deploy's removal of
// stale files and must never reach the origin through the distribution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REDIRECT_RECORD_KEY, redirectsDigest, staleKeys, syncRedirectsIfChanged } from "../../scripts/redirect-record.mjs";
import { viewerRequestCode } from "../../infra/viewer-request.mjs";

const STORE = "arn:aws:cloudfront::1:key-value-store/one";
const redirects = { "/a/": "/b/", "/c/": "https://example.com/" };

// A stand-in for the S3 client, holding the one object, and a log of the order things happened in.
function harness({ body, readError, writeError, syncError } = {}) {
  const log = [];
  const s3 = {
    body,
    async send(command) {
      const name = command.constructor.name;
      assert.equal(command.input.Key, REDIRECT_RECORD_KEY);
      log.push(name);
      if (name === "GetObjectCommand") {
        if (readError) throw readError;
        if (s3.body === undefined) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        return { Body: { transformToString: async () => s3.body } };
      }
      if (name === "DeleteObjectCommand") s3.body = undefined;
      if (name === "PutObjectCommand") {
        if (writeError) throw writeError;
        s3.body = command.input.Body;
      }
      return {};
    },
  };
  const sync = async () => {
    log.push("sync");
    if (syncError) throw syncError;
    return 2;
  };
  const run = (options = {}) => syncRedirectsIfChanged({ s3, bucket: "site", store: STORE, redirects, sync, ...options });
  return { s3, log, run };
}
const recordFor = (map, store = STORE) => JSON.stringify({ store, sha256: redirectsDigest(map) });

async function quietly(fn) {
  const { log, warn } = console;
  const lines = [];
  console.log = console.warn = (line) => lines.push(line);
  try {
    await fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines;
}

test("the digest ignores key order and follows every key and target", () => {
  assert.equal(redirectsDigest({ "/a/": "/b/", "/c/": "/d/" }), redirectsDigest({ "/c/": "/d/", "/a/": "/b/" }));
  assert.notEqual(redirectsDigest({ "/a/": "/b/" }), redirectsDigest({ "/a/": "/c/" }));
  assert.notEqual(redirectsDigest({ "/a/": "/b/" }), redirectsDigest({ "/x/": "/b/" }));
  assert.notEqual(redirectsDigest({ "/a/": "/b/" }), redirectsDigest({ "/a/": "/b/", "/c/": "/d/" }));
});

test("an unchanged map skips the store and writes nothing", async () => {
  const { log, run } = harness({ body: recordFor({ "/c/": "https://example.com/", "/a/": "/b/" }) });
  const lines = await quietly(() => run());
  assert.deepEqual(log, ["GetObjectCommand"]);
  assert.deepEqual(lines, ["Redirects: 2, unchanged, store not read."]);
});

test("no record does a full sync and writes one, and the next deploy skips", async () => {
  const { log, run } = harness();
  const first = await quietly(() => run({ commit: "abc" }));
  assert.deepEqual(log, ["GetObjectCommand", "DeleteObjectCommand", "sync", "PutObjectCommand"]);
  assert.deepEqual(first, ["Redirects: 2, 2 changed."]);
  log.length = 0;
  const second = await quietly(() => run());
  assert.deepEqual(log, ["GetObjectCommand"]);
  assert.deepEqual(second, ["Redirects: 2, unchanged, store not read."]);
});

test("a changed map, or a replaced store, does a full sync", async () => {
  for (const body of [recordFor({ "/a/": "/other/" }), recordFor(redirects, "arn:aws:cloudfront::1:key-value-store/old")]) {
    const { log, run } = harness({ body });
    await quietly(() => run());
    assert.deepEqual(log, ["GetObjectCommand", "DeleteObjectCommand", "sync", "PutObjectCommand"]);
  }
});

test("a malformed or unreadable record does a full sync, never a skip", async () => {
  const sha256 = redirectsDigest(redirects);
  const shapes = ["", "not json", "null", "42", "[]", "{}", JSON.stringify({ sha256 }), JSON.stringify({ store: STORE })];
  for (const body of shapes) {
    const { log, run } = harness({ body });
    await quietly(() => run());
    assert.ok(log.includes("sync"), `skipped on ${JSON.stringify(body)}`);
  }
  const { log, run } = harness({ body: recordFor(redirects), readError: new Error("AccessDenied") });
  await quietly(() => run());
  assert.ok(log.includes("sync"));
});

test("force does a full sync without reading the record", async () => {
  const { log, run } = harness({ body: recordFor(redirects) });
  await quietly(() => run({ force: true }));
  assert.deepEqual(log, ["DeleteObjectCommand", "sync", "PutObjectCommand"]);
});

test("a failed sync leaves no record, so going back to the old map retries too", async () => {
  const { s3, log, run } = harness({ body: recordFor({ "/old/": "/map/" }), syncError: new Error("partial") });
  await assert.rejects(() => run(), /partial/);
  assert.deepEqual(log, ["GetObjectCommand", "DeleteObjectCommand", "sync"]);
  assert.equal(s3.body, undefined);
});

test("a record that cannot be written warns and does not fail the deploy", async () => {
  const { log, run } = harness({ writeError: new Error("SlowDown") });
  const lines = await quietly(() => run());
  assert.deepEqual(log, ["GetObjectCommand", "DeleteObjectCommand", "sync", "PutObjectCommand"]);
  assert.match(lines.at(-1), /redirect record was not written/);
});

test("the deploy's removal of stale files keeps the record", () => {
  const existing = ["index.html", "old.html", REDIRECT_RECORD_KEY];
  assert.deepEqual(staleKeys(existing, new Set(["index.html"])), ["old.html"]);
});

test("no request through the viewer function reaches the record", async () => {
  const handler = new Function(
    "cf",
    viewerRequestCode.replace("import cf from 'cloudfront';", "") + "\nreturn handler;"
  )({ kvs: () => ({ get: async () => { throw new Error("Key not found"); } }) });
  const origin = "/" + REDIRECT_RECORD_KEY;
  assert.ok(!origin.includes("."), "a dot would make the viewer function treat the record as a file");
  for (const uri of [origin, origin + "/", origin.replace("_deploy/", "_deploy%2F"), origin.replace("synced", "synce%64")]) {
    const r = await handler({ request: { uri, querystring: {}, headers: {} } });
    assert.notEqual(r.uri, origin, uri);
    assert.ok(r.statusCode === 301 || r.uri.endsWith("/index.html"), uri);
  }
});
