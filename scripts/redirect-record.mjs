// The redirect store costs $0.001 an API call and reading it takes about a dozen, so a deploy only goes
// to it when the map has changed. This keeps a record of what the last sync that finished pushed and
// compares the build's map against it; an unreadable record, or none, means a full sync, never a skip.
//
// The record is in the site bucket, the one place the delivery role can already write. Every key there
// is readable through the distribution, so this one has no extension and is not in the viewer function's
// FILES: the function sends such a path to its slash form and then asks for its index.html, and never
// hands the origin this key. The test beside this module holds that.
//
// A hand edit to the store is not seen until the map next changes. `--sync-redirects` reads it anyway.
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

export const REDIRECT_RECORD_KEY = '_deploy/redirects-synced';

// By code unit, not locale, so the same map hashes the same on any machine in any key order.
export function redirectsDigest(redirects) {
  const sorted = Object.entries(redirects).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

// What in the bucket the build no longer writes. The record is never in the build, and removing it here
// would make every deploy a full sync.
export function staleKeys(existingKeys, publishedKeys) {
  return [...existingKeys].filter((key) => !publishedKeys.has(key) && key !== REDIRECT_RECORD_KEY);
}

async function readRecord(s3, Bucket) {
  try {
    const { Body } = await s3.send(new GetObjectCommand({ Bucket, Key: REDIRECT_RECORD_KEY }));
    return JSON.parse(await Body.transformToString());
  } catch {
    return null;
  }
}

// `sync` does the whole store sync and returns how many keys it changed.
export async function syncRedirectsIfChanged({ s3, bucket, store, redirects, force = false, sync, commit = 'local' }) {
  const count = Object.keys(redirects).length;
  const sha256 = redirectsDigest(redirects);
  const record = force ? null : await readRecord(s3, bucket);
  // The store's ARN counts too: a replaced store starts empty whatever the map says.
  if (record?.store === store && record?.sha256 === sha256) {
    console.log(`Redirects: ${count}, unchanged, store not read.`);
    return;
  }
  // Gone before the first write: a sync that dies halfway leaves the store matching no map, and a later
  // deploy of the map on record must not skip it.
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: REDIRECT_RECORD_KEY }));
  const changed = await sync();
  console.log(`Redirects: ${count}, ${changed} changed.`);
  // The store is right by now. Without the record the next deploy only costs a full sync, so this never
  // fails a deploy.
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: REDIRECT_RECORD_KEY,
        Body: JSON.stringify({ store, sha256, count, commit, syncedAt: new Date().toISOString() }) + '\n',
        ContentType: 'application/json',
        CacheControl: 'no-store'
      })
    );
  } catch (error) {
    console.warn(`::warning::The redirect record was not written (${error.message}); the next deploy does a full sync.`);
  }
}
