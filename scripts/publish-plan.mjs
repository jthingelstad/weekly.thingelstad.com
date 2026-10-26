// What a deploy to S3 publishes, and how each file is served: its content type and Cache-Control.
// This is the control GitHub Pages, the host until 2026-10-26, never gave the site (it typed files by
// extension, so /rss went out as application/octet-stream, and cached everything ten minutes).
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

// The redirect map goes to the key value store instead.
export const NOT_PUBLISHED = new Set(['_redirects.json']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json'
};

// XML and extensionless files are read, not guessed: /podcast.xml is RSS; /rss, /feed.xml and the
// links.xml feeds are Atom, served as application/xml because CloudFront does not compress
// application/atom+xml and /feed.xml is 290 KB raw, 44 KB gzipped (feed readers take either type).
export function contentTypeFor(key, head = '') {
  const ext = extname(key).toLowerCase();
  if (ext === '.xml' || ext === '') {
    if (/<rss[\s>]/.test(head)) return 'application/rss+xml; charset=utf-8';
    if (ext === '.xml' || head.startsWith('<?xml')) return 'application/xml; charset=utf-8';
  }
  // Pagefind's index files (.pf_fragment, .pf_index, .pf_meta, .pagefind) are gzip bytes it unpacks itself.
  return TYPES[ext] ?? 'application/octet-stream';
}

// Browsers keep a page five minutes; CloudFront keeps it a day, and every deploy clears CloudFront.
// Fonts and images change name or ?v= when they change, so browsers keep them a week.
export function cacheControlFor(key) {
  if (/\.(woff2?|png|jpe?g|webp|svg|ico)$/i.test(key)) return 'public, max-age=604800';
  return 'public, max-age=300, s-maxage=86400';
}

function walk(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(root, path);
    return entry.isFile() ? [relative(root, path).split(sep).join('/')] : [];
  });
}

// Every published file with its type and caching, in the order a deploy writes them: files first, then
// pages, the front page last, so no page goes out before what it loads.
export function publishPlan(root) {
  const rank = (key) => (key === 'index.html' ? 2 : key.endsWith('.html') ? 1 : 0);
  return walk(root)
    .filter((key) => !NOT_PUBLISHED.has(key))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => {
      const path = join(root, key);
      const head = readFileSync(path).subarray(0, 512).toString('utf8');
      return { key, path, contentType: contentTypeFor(key, head), cacheControl: cacheControlFor(key) };
    });
}
