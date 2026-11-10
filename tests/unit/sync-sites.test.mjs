import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vendored = JSON.parse(readFileSync(join(repoRoot, 'apps/site/_data/sites.json'), 'utf8'));

// Runs `sites:check` against a fixture source. Check mode never writes, and it
// refuses a bad source before it compares anything.
function checkAgainst(data) {
  const dir = mkdtempSync(join(tmpdir(), 'weekly-sites-'));
  try {
    const source = join(dir, 'sites.json');
    writeFileSync(source, JSON.stringify(data));
    return spawnSync(process.execPath, ['scripts/sync-sites.mjs', '--check'], {
      cwd: repoRoot,
      env: { ...process.env, SITES_SOURCE: source },
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the vendored sites.json carries All Things for the end of the sites strip', () => {
  const all = vendored.strip_all;
  assert.equal(all.label, 'All Things');
  assert.match(all.url, /^https:\/\//);
  assert.ok(all.description);
});

test('the sync refuses a sites.json without a whole, HTTPS strip_all', () => {
  for (const [strip_all, message] of [
    [undefined, /has no strip_all/],
    [{ ...vendored.strip_all, label: '' }, /strip_all has no label/],
    [{ ...vendored.strip_all, description: undefined }, /strip_all has no description/],
    [{ ...vendored.strip_all, url: 'http://thingelstad.xyz/all/' }, /strip_all's url must be HTTPS/],
  ]) {
    const run = checkAgainst({ ...vendored, strip_all });
    assert.equal(run.status, 1, JSON.stringify(strip_all));
    assert.match(run.stderr, message);
  }
});
