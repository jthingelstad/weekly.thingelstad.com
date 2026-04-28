import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionToken, emailHash, normalizeEmail, verifyToken } from '../shared/session.mjs';
import { sanitizePrompts, renderTemplate } from '../shared/prompts.mjs';
import { subscriberStatus } from '../shared/buttondown.mjs';

test('session token round trips and rejects tampering', () => {
  process.env.SESSION_SECRET = 'test-secret';
  const { token } = createSessionToken('Reader@Example.com', 'session-1');
  const payload = verifyToken(token);

  assert.equal(payload.sid, 'session-1');
  assert.equal(payload.sub, emailHash('reader@example.com'));
  assert.equal(verifyToken(`${token}x`), null);
});

test('email normalization is stable', () => {
  assert.equal(normalizeEmail(' Reader@Example.com '), 'reader@example.com');
  assert.equal(emailHash('Reader@Example.com'), emailHash('reader@example.com'));
});

test('buttondown subscriber status maps active and inactive states', () => {
  assert.equal(subscriberStatus(null), 'not_found');
  assert.equal(subscriberStatus({ type: 'regular' }), 'active');
  assert.equal(subscriberStatus({ type: 'premium' }), 'premium');
  assert.equal(subscriberStatus({ type: 'unactivated' }), 'unconfirmed');
  assert.equal(subscriberStatus({ type: 'regular', unsubscription_date: '2026-01-01' }), 'inactive');
  assert.equal(subscriberStatus({ type: 'disabled' }), 'inactive');
});

test('prompt sanitizer requires three clipped prompts', () => {
  const longLabel = 'How do Banff and Sunrise portray landscape, vision, and sense of place?';
  const longQuestion = "What can Thingy show me about privacy, security, tokens, and how the archive's framing changes across multiple issues without truncating the actual question text?";
  const prompts = sanitizePrompts({
    prompts: [
      { label: longLabel, question: longQuestion },
      { label: 'Two', question: 'Question two?' },
      { label: 'Three', question: 'Question three?' }
    ]
  });

  assert.equal(prompts.length, 3);
  assert.equal(prompts[0].label, longLabel.slice(0, 72));
  assert.equal(prompts[0].question, longQuestion.slice(0, 220));
  assert.deepEqual(sanitizePrompts({ prompts: [{ label: 'One', question: 'One?' }] }), []);
});

test('prompt template renderer substitutes named placeholders', () => {
  assert.equal(renderTemplate('Hello {{ name }} from {{ place }}.', { name: 'Thingy', place: 'the archive' }), 'Hello Thingy from the archive.');
});
