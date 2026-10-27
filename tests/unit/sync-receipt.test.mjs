import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueArrival, newestIssue, reportIssueArrival } from '../../scripts/sync-receipt.mjs';

const at = '2026-10-28T02:03:00Z';
const feed = (id) => ({ items: [{ url: `https://weekly.thingelstad.com/archive/${id}/`, date_published: '2026-10-31T12:00:00Z', title: 'Fixture title', content_html: '<p>fixture-body-canary</p>', author: { email: 'fixture@example.invalid' } }] });

test('an issue receipt needs a changed known identity and matching public build, not an editorial publication date', () => {
  const input = feed('355'), untouched = structuredClone(input);
  assert.deepEqual(issueArrival(feed('354'), input, input, at), { source: 'weekly', 'detail-type': 'received', detail: { system: 'weekly', kind: 'issue', id: '355', at, url: 'https://weekly.thingelstad.com/archive/355/', via: 'site-deploy' } });
  assert.deepEqual(input, untouched);
  assert.doesNotMatch(JSON.stringify(issueArrival(feed('354'), input, input, at)), /body-canary|author|email|content|Fixture/);
  for (const [before, built, live, time] of [[null, input, input, at], [input, input, input, at], [feed('356'), input, input, at], [feed('354'), input, feed('354'), at], [feed('354'), input, null, at], [feed('354'), input, input, '2026-02-30T00:00:00Z']]) assert.equal(issueArrival(before, built, live, time), null);
  assert.equal(newestIssue({ items: 'malformed' }), null);
  assert.equal(newestIssue({ items: [{ ...input.items[0], url: 'https://fixture-secret@weekly.thingelstad.com/archive/355/' }] }), null);
});

test('disabled and unknown reads never emit, while a real entry acknowledgement is required', async () => {
  const sends = [], warnings = [];
  const get = async () => ({ ok: true, json: async () => feed('355') });
  const options = { bus: 'fixture-bus', region: 'us-east-1', before: feed('354'), built: feed('355'), preview: 'https://fixture.invalid', at, get, warn: (w) => warnings.push(w), send: async (e) => { sends.push(e); return { FailedEntryCount: 0, Entries: [{ EventId: 'fixture-event' }] }; } };
  assert.equal(await reportIssueArrival({ ...options, bus: '', get: () => { throw new Error('Disabled must not read'); } }), 'disabled');
  assert.equal(await reportIssueArrival({ ...options, get: async () => { throw new Error('private-error'); } }), 'no-new-verified-item');
  assert.equal(sends.length, 0);
  assert.equal(await reportIssueArrival(options), 'reported');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].Source, 'weekly');
  assert.equal(sends[0].DetailType, 'received');
  assert.doesNotMatch(sends[0].Detail, /body-canary|example.invalid|author/);
  assert.equal(await reportIssueArrival({ ...options, send: async () => ({ FailedEntryCount: 1, Entries: [{ ErrorCode: 'private-error' }] }) }), 'report-failed');
  assert.doesNotMatch(warnings.join(''), /private-error|body-canary/);
});
