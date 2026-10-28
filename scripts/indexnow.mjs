// IndexNow: after a deploy, tell Bing, Yandex, Seznam, Naver and Yep which pages changed
// (https://www.indexnow.org/documentation). The key is public by design and shared across Jamie's sites;
// the site serves it at /<key>.txt (apps/site/<key>.txt, its body exactly the key).
//
// scripts/deploy-aws.mjs calls pingIndexNow with the files whose bytes changed in that deploy. Only pages
// are sent, and only pages in the built sitemap, so redirects, the 404 page, the noindex topic pages,
// feeds, assets and Pagefind's chunks never are. A failed ping is logged and never fails the deploy.
//
//   node scripts/indexnow.mjs archive/355/index.html index.html ...   print what a deploy would send
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HOST = 'weekly.thingelstad.com';
export const KEY = '79f379d18599eeec9bebf34c9a2a5deb';
export const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
const LIMIT = 10_000;

// The public URL of a built file: "index.html" is "/", "archive/355/index.html" is "/archive/355/".
export function publicUrl(key) {
  const path = key === 'index.html' || key.endsWith('/index.html') ? key.slice(0, -'index.html'.length) : key;
  return `https://${HOST}/${path}`;
}

export function sitemapUrls(xml) {
  return new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]));
}

// The changed files' pages that the sitemap lists, sorted and at most 10,000 (one request's limit).
export function changedPageUrls(changedKeys, sitemapXml) {
  const listed = sitemapUrls(sitemapXml);
  const urls = new Set(changedKeys.filter((key) => key.endsWith('.html')).map(publicUrl).filter((url) => listed.has(url)));
  return [...urls].sort().slice(0, LIMIT);
}

export function payload(urlList) {
  return { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList };
}

// Returns a line for the deploy log. Never throws.
export async function pingIndexNow(urlList, { post = fetch, dryRun = false } = {}) {
  if (!urlList.length) return 'IndexNow: no changed pages, nothing sent.';
  const body = JSON.stringify(payload(urlList));
  if (dryRun) return `IndexNow (dry run) would send ${urlList.length} URLs:\n${body}`;
  try {
    const response = await post(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(20_000)
    });
    if (response.status === 200 || response.status === 202) return `IndexNow: ${response.status} for ${urlList.length} URLs.`;
    return `::warning::IndexNow answered ${response.status} for ${urlList.length} URLs; the site is deployed.`;
  } catch (error) {
    return `::warning::IndexNow could not be reached (${error.name}); the site is deployed.`;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urls = changedPageUrls(process.argv.slice(2), readFileSync('_site/sitemap.xml', 'utf8'));
  console.log(await pingIndexNow(urls, { dryRun: true }));
}
