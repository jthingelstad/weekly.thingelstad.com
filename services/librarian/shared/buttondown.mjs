import { clientSourceIp } from './http.mjs';
import { emailHash, normalizeEmail } from './session.mjs';
import { logEvent } from './logging.mjs';

const BUTTONDOWN_BASE = 'https://api.buttondown.com/v1';
const LIBRARIAN_SOURCE_TAG_ID = 'sub_tag_3ts444xst99y08j8bqfnwt1g4h';

function buttondownHeaders(extra = {}) {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) throw new Error('BUTTONDOWN_API_KEY is required');
  return { authorization: `Token ${apiKey}`, accept: 'application/json', ...extra };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function fetchSubscriber(email) {
  const normalized = normalizeEmail(email);
  const start = performance.now();
  const response = await fetch(`${BUTTONDOWN_BASE}/subscribers/${encodeURIComponent(normalized)}`, {
    headers: buttondownHeaders()
  });
  logEvent('info', 'buttondown_subscriber_lookup', {
    email_hash: emailHash(email),
    status_code: response.status,
    duration_ms: Math.round(performance.now() - start)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Buttondown lookup failed with ${response.status}`);
  return readJsonResponse(response);
}

export async function createSubscriber(email, event) {
  const body = {
    email_address: normalizeEmail(email),
    tags: [LIBRARIAN_SOURCE_TAG_ID]
  };
  const ip = clientSourceIp(event);
  if (ip) body.ip_address = ip;
  const start = performance.now();
  const response = await fetch(`${BUTTONDOWN_BASE}/subscribers`, {
    method: 'POST',
    headers: buttondownHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
  logEvent('info', 'buttondown_subscriber_create', {
    email_hash: emailHash(email),
    status_code: response.status,
    duration_ms: Math.round(performance.now() - start)
  });
  if (!response.ok) throw new Error(`Buttondown create failed with ${response.status}`);
  return readJsonResponse(response);
}

export async function sendSubscriberReminder(email) {
  const start = performance.now();
  const response = await fetch(`${BUTTONDOWN_BASE}/subscribers/${encodeURIComponent(normalizeEmail(email))}/send-reminder`, {
    method: 'POST',
    headers: buttondownHeaders()
  });
  logEvent('info', 'buttondown_subscriber_reminder', {
    email_hash: emailHash(email),
    status_code: response.status,
    duration_ms: Math.round(performance.now() - start)
  });
  if (!response.ok) throw new Error(`Buttondown reminder failed with ${response.status}`);
}

export function subscriberStatus(subscriber) {
  if (!subscriber) return 'not_found';
  const type = String(subscriber.type || '').toLowerCase();
  if (type === 'unactivated') return 'unconfirmed';
  if (subscriber.unsubscription_date || subscriber.churn_date) return 'inactive';
  if (['unsubscribed', 'churned', 'disabled'].includes(type)) return 'inactive';
  if (type === 'premium') return 'premium';
  return 'active';
}
