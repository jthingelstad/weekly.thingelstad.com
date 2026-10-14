const fs = require('node:fs');
const path = require('node:path');

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const envPath = path.join(__dirname, '..', '..', '.env');
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || match[1] !== name) continue;
      return match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return '';
  }
  return '';
}

module.exports = {
  title: 'Weekly Thing',
  description: 'A weekly collection of interesting links, ideas, and observations from across the internet, curated by Jamie Thingelstad.',
  url: 'https://weekly.thingelstad.com',
  thingyUrl: 'https://thingy.thingelstad.com',
  author: 'Jamie Thingelstad',
  authorUrl: 'https://www.thingelstad.com',
  tinylyticsId: envValue('TINYLYTICS_SITE_UID') || (/^\d+$/.test(envValue('TINYLYTICS_SITE_ID')) ? '' : envValue('TINYLYTICS_SITE_ID')) || 'a2YQr3ZMqkySNYSwz4uF',
  buttondownUsername: 'weekly-thing',
  librarianApiUrl: envValue('LIBRARIAN_API_URL') || 'https://librarian.thingelstad.com',
  librarianStreamUrl: envValue('LIBRARIAN_STREAM_URL') || 'https://librarian.thingelstad.com',
  // Cloudflare Turnstile widget "thingelstad.com sign-in and subscribe"; the
  // site key is public. The Librarian checks the token (librarian-thing
  // apps/librarian/lambda/shared/turnstile.mts).
  turnstileSiteKey: envValue('TURNSTILE_SITE_KEY') || '0x4AAAAAAFWqGqZVkNAWfIQn',
  social: {
    mastodon: 'https://mastodon.social/@weeklything',
    bluesky: 'https://bsky.app/profile/weekly.thingelstad.com'
  }
};
