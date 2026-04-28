import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionToken, emailHash, normalizeEmail, verifyToken } from '../shared/session.mjs';
import { sanitizePrompts, renderTemplate, agentUserPrompt } from '../shared/prompts.mjs';
import { subscriberStatus } from '../shared/buttondown.mjs';
import { normalizeFeedbackReaction, validFeedbackRequestId } from '../shared/feedback.mjs';
import { readConverseStream } from '../shared/bedrock-stream.mjs';

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

test('agent user prompt renders dynamic conversation context', () => {
  const prompt = agentUserPrompt({
    conversation_context: 'User: Tell me more.',
    question: 'What did the archive say about RSS?'
  });

  assert.match(prompt, /User: Tell me more\./);
  assert.match(prompt, /What did the archive say about RSS\?/);
  assert.match(prompt, /Investigate with tools as needed/);
});

test('feedback helpers accept only expected reactions and request ids', () => {
  assert.equal(normalizeFeedbackReaction('up'), 'up');
  assert.equal(normalizeFeedbackReaction(' DOWN '), 'down');
  assert.equal(normalizeFeedbackReaction('helpful'), '');

  assert.equal(validFeedbackRequestId('63026f16-ef49-456f-b26f-bc76d7d83481'), '63026f16-ef49-456f-b26f-bc76d7d83481');
  assert.equal(validFeedbackRequestId('request:local.test_1'), 'request:local.test_1');
  assert.equal(validFeedbackRequestId('conversation#bad'), '');
  assert.equal(validFeedbackRequestId(''), '');
});

test('Bedrock converse stream reader emits incremental text deltas', async () => {
  const deltas = [];
  const result = await readConverseStream({
    stream: [
      { messageStart: { role: 'assistant' } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'First ' } } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'second.' } } },
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { outputTokens: 3 } } }
    ]
  }, { onTextDelta: (delta) => deltas.push(delta) });

  assert.deepEqual(deltas, ['First ', 'second.']);
  assert.equal(result.text, 'First second.');
  assert.deepEqual(result.message.content, [{ text: 'First second.' }]);
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.usage.outputTokens, 3);
});

test('Bedrock converse stream reader reconstructs streamed tool use input', async () => {
  const result = await readConverseStream({
    stream: [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: 'tool-1', name: 'search_archive' } }
        }
      },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"query":"' } } } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: 'RSS"}' } } } },
      { messageStop: { stopReason: 'tool_use' } }
    ]
  });

  assert.deepEqual(result.message.content, [{
    toolUse: { toolUseId: 'tool-1', name: 'search_archive', input: { query: 'RSS' } }
  }]);
  assert.equal(result.stopReason, 'tool_use');
});
