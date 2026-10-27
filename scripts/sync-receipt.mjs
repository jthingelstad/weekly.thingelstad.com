// A new issue is received only after the public feed agrees with this build.
// Select metadata in pure functions; the optional transport uses ambient AWS.
export function newestIssue(feed) {
  const items = (Array.isArray(feed?.items) ? feed.items : []).flatMap((item) => {
    try {
      const url = new URL(item.url), id = url.pathname.match(/^\/archive\/(\d+)\/$/)?.[1];
      if (url.origin !== 'https://weekly.thingelstad.com' || url.username || url.password || url.search || url.hash || !id || !Number.isFinite(Date.parse(item.date_published))) return [];
      return [{ id, url: url.href, at: new Date(item.date_published).toISOString() }];
    } catch { return []; }
  });
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

export function issueArrival(before, built, served, at) {
  const previous = newestIssue(before), expected = newestIssue(built), live = newestIssue(served);
  if (!previous || !expected || !live || previous.id === expected.id || live.id !== expected.id || live.at !== expected.at) return null;
  if (BigInt(expected.id) <= BigInt(previous.id)) return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString().replace('.000Z', 'Z') !== at) return null;
  return { source: 'weekly', 'detail-type': 'received', detail: { system: 'weekly', kind: 'issue', id: live.id, at, url: live.url, via: 'site-deploy' } };
}

export async function readPublicFeed(url, get = fetch) {
  try {
    const response = await get(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

export async function reportIssueArrival({ bus, region, before, built, preview, at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), get = fetch, send, warn = console.warn }) {
  if (!bus) return 'disabled';
  const served = await readPublicFeed(`${preview}/feed.json`, get);
  const event = issueArrival(before, built, served, at);
  if (!event) return 'no-new-verified-item';
  try {
    if (!send) {
      const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
      const client = new EventBridgeClient({ region, maxAttempts: 2 });
      send = (entry) => client.send(new PutEventsCommand({ Entries: [entry] }), { abortSignal: AbortSignal.timeout(5000) });
    }
    const result = await send({ EventBusName: bus, Source: event.source, DetailType: event['detail-type'], Detail: JSON.stringify(event.detail), Time: new Date(at) });
    if (result?.FailedEntryCount !== 0 || result.Entries?.length !== 1 || !result.Entries[0].EventId || result.Entries[0].ErrorCode) throw new Error('Not acknowledged');
    return 'reported';
  } catch {
    // A reporting outage cannot undo a healthy site deployment. Polling is
    // still the backstop; no raw SDK error or payload is put in a log.
    warn('::warning::The sync arrival was not acknowledged; the site is deployed.');
    return 'report-failed';
  }
}
