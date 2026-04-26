import crypto from 'node:crypto';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const TINYLYTICS_BASE = 'https://tinylytics.app/api/v1';
const DEFAULT_TINYLYTICS_SITE_ID = '3063';
const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_EMBEDDING_DIMENSIONS = 256;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX = 20;
const TOKEN_RE = /[a-z0-9][a-z0-9'-]{1,}/gi;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 4000;

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
let corpusCache;
let indexedCache;
let tinylyticsResolvedSiteId;

function logEvent(level, message, fields = {}) {
  console.log(JSON.stringify({
    level,
    message,
    service: 'weekly-thing-librarian-stream',
    timestamp: Math.floor(Date.now() / 1000),
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null))
  }));
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function clientSourceIp(event) {
  return event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || '';
}

function userAgent(event) {
  return normalizeHeaders(event.headers || {})['user-agent'] || '';
}

function tinylyticsEnabled() {
  const enabled = String(process.env.TINYLYTICS_ENABLED || '1').toLowerCase();
  return !['0', 'false', 'no'].includes(enabled) && Boolean(process.env.TINYLYTICS_API_KEY);
}

function tinylyticsValue(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replaceAll(';', ',').replaceAll('\n', ' ').slice(0, 120)}`)
    .join(';');
}

async function tinylyticsSiteId() {
  const configured = process.env.TINYLYTICS_SITE_ID || DEFAULT_TINYLYTICS_SITE_ID;
  if (/^\d+$/.test(configured) || !tinylyticsEnabled()) return configured;
  if (tinylyticsResolvedSiteId) return tinylyticsResolvedSiteId;

  try {
    const response = await fetch(`${TINYLYTICS_BASE}/sites`, {
      headers: {
        authorization: `Bearer ${process.env.TINYLYTICS_API_KEY}`,
        accept: 'application/json',
        'user-agent': 'WeeklyThingLibrarian/1.0 (+https://weekly.thingelstad.com)'
      }
    });
    if (!response.ok) throw new Error(`Tinylytics site lookup failed with ${response.status}`);
    const data = await response.json();
    const site = (data.sites || []).find((item) => String(item.uid || '') === configured)
      || (data.sites || []).find((item) => String(item.url || '').replace(/\/$/, '') === 'https://weekly.thingelstad.com');
    if (site?.id) {
      tinylyticsResolvedSiteId = String(site.id);
      return tinylyticsResolvedSiteId;
    }
  } catch (error) {
    logEvent('warning', 'tinylytics_site_resolve_failed', { error_type: error.constructor?.name || 'Error' });
  }
  return configured;
}

async function postTinylyticsEvent(event, name, { visitorId = '', value = '', path = '/librarian/api' } = {}) {
  if (!tinylyticsEnabled()) return;
  const siteId = await tinylyticsSiteId();
  const body = { event: name, path, source: 'librarian-api' };
  if (value) body.value = value;
  if (visitorId) body.visitor_id = visitorId;
  if (clientSourceIp(event)) body.ip_address = clientSourceIp(event);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${TINYLYTICS_BASE}/sites/${siteId}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.TINYLYTICS_API_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'WeeklyThingLibrarian/1.0 (+https://weekly.thingelstad.com)'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Tinylytics request failed with ${response.status}`);
  } catch (error) {
    logEvent('warning', 'tinylytics_event_failed', { tinylytics_event: name, error_type: error.constructor?.name || 'Error' });
  } finally {
    clearTimeout(timeout);
  }
}

function methodAndPath(event) {
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  const path = (event.rawPath || event.path || '/').replace(/\/$/, '') || '/';
  return { method, path };
}

function parseBody(event) {
  const body = event.body || '{}';
  const text = event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function b64urlDecode(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value + padding, 'base64url');
}

function sessionSecret() {
  const value = process.env.SESSION_SECRET || process.env.LIBRARIAN_SIGNING_SECRET;
  if (!value) throw new Error('SESSION_SECRET is required');
  return value;
}

function verifyToken(token) {
  try {
    const [encoded, signature] = String(token || '').split('.', 2);
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest();
    const supplied = b64urlDecode(signature);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(b64urlDecode(encoded).toString('utf8'));
    if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearer(event, body) {
  const auth = String(normalizeHeaders(event.headers || {}).authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(body.token || '');
}

async function checkRateLimit(identity, maxRequests = Number(process.env.RATE_LIMIT_MAX || RATE_LIMIT_MAX)) {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return true;
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / RATE_LIMIT_WINDOW_SECONDS);
  const key = `rate#${identity}#${window}`;
  const response = await dynamodb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: { pk: { S: key }, sk: { S: 'rate' } },
    UpdateExpression: 'ADD #count :one SET #ttl = :ttl',
    ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':one': { N: '1' },
      ':ttl': { N: String(now + RATE_LIMIT_WINDOW_SECONDS * 2) }
    },
    ReturnValues: 'UPDATED_NEW'
  }));
  const count = Number(response.Attributes?.count?.N || '0');
  logEvent('info', 'rate_limit_checked', { identity_hash: identity, count, limit: maxRequests, allowed: count <= maxRequests });
  return count <= maxRequests;
}

async function loadCorpus() {
  if (corpusCache) return corpusCache;
  const bucket = process.env.CORPUS_BUCKET;
  const key = process.env.CORPUS_KEY || 'librarian/corpus.json';
  if (!bucket) throw new Error('CORPUS_BUCKET is required');
  const start = performance.now();
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  corpusCache = JSON.parse(await response.Body.transformToString());
  logEvent('info', 'corpus_loaded', {
    source: 's3',
    bucket,
    key,
    chunk_count: corpusCache.chunk_count || corpusCache.chunks?.length || 0,
    embedding_dimensions: corpusCache.embedding_dimensions,
    duration_ms: Math.round(performance.now() - start)
  });
  return corpusCache;
}

function tokenize(text) {
  return Array.from(String(text || '').matchAll(TOKEN_RE), (match) => match[0].toLowerCase());
}

async function indexedChunks() {
  if (indexedCache) return indexedCache;
  const corpus = await loadCorpus();
  const documentFrequency = new Map();
  const indexed = (corpus.chunks || []).map((chunk) => {
    const terms = tokenize([chunk.subject, chunk.section, chunk.text].join(' '));
    const termCounts = new Map();
    for (const term of terms) termCounts.set(term, (termCounts.get(term) || 0) + 1);
    for (const term of termCounts.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    return { ...chunk, _terms: termCounts };
  });
  const total = Math.max(indexed.length, 1);
  for (const chunk of indexed) {
    const vector = new Map();
    let norm = 0;
    for (const [term, count] of chunk._terms.entries()) {
      const weight = (1 + Math.log(count)) * Math.log(1 + total / (1 + (documentFrequency.get(term) || 0)));
      vector.set(term, weight);
      norm += weight * weight;
    }
    chunk._vector = vector;
    chunk._norm = Math.sqrt(norm) || 1;
  }
  indexedCache = indexed;
  return indexedCache;
}

function cosine(left, right) {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

function openAiApiKey() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  return process.env.OPENAI_API_KEY;
}

async function openAiJson(url, payload, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${openAiApiKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function embedQuery(query, model, dimensions) {
  const start = performance.now();
  const data = await openAiJson(OPENAI_EMBEDDINGS_URL, {
    model,
    input: query,
    encoding_format: 'float',
    dimensions
  }, 20000);
  logEvent('info', 'query_embedded', { model, dimensions, duration_ms: Math.round(performance.now() - start) });
  return data.data[0].embedding;
}

function publicChunk(chunk) {
  return Object.fromEntries(Object.entries(chunk).filter(([key]) => key !== 'embedding' && !key.startsWith('_')));
}

async function retrieveSemantic(query, limit = 8) {
  const start = performance.now();
  const corpus = await loadCorpus();
  const chunks = (corpus.chunks || []).filter((chunk) => chunk.embedding);
  if (!chunks.length) return [];
  const model = corpus.embedding_model || process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const dimensions = Number(corpus.embedding_dimensions || process.env.OPENAI_EMBEDDING_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS);
  const queryEmbedding = await embedQuery(query, model, dimensions);
  const result = chunks
    .map((chunk) => [cosine(queryEmbedding, chunk.embedding), chunk])
    .filter(([score]) => score > 0)
    .sort(([left], [right]) => right - left)
    .slice(0, limit)
    .map(([, chunk]) => publicChunk(chunk));
  logEvent('info', 'retrieval_completed', { mode: 'semantic', result_count: result.length, duration_ms: Math.round(performance.now() - start) });
  return result;
}

async function retrieveLexical(query, limit = 8) {
  const start = performance.now();
  const queryTerms = new Map();
  for (const term of tokenize(query)) queryTerms.set(term, (queryTerms.get(term) || 0) + 1);
  if (!queryTerms.size) return [];
  const scored = [];
  for (const chunk of await indexedChunks()) {
    let score = 0;
    for (const [term, count] of queryTerms.entries()) score += (chunk._vector.get(term) || 0) * count;
    if (score > 0) scored.push([score / chunk._norm, chunk]);
  }
  const result = scored.sort(([left], [right]) => right - left).slice(0, limit).map(([, chunk]) => publicChunk(chunk));
  logEvent('info', 'retrieval_completed', { mode: 'lexical', result_count: result.length, duration_ms: Math.round(performance.now() - start) });
  return result;
}

async function retrieve(query, limit = 8) {
  try {
    const semantic = await retrieveSemantic(query, limit);
    if (semantic.length) return semantic;
  } catch (error) {
    logEvent('error', 'semantic_retrieval_failed', { error_type: error.constructor?.name || 'Error' });
  }
  return retrieveLexical(query, limit);
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const cleaned = [];
  let chars = 0;
  for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
    const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : '';
    const content = String(item?.content || '').trim().replace(/\s+/g, ' ');
    if (!role || !content) continue;
    const clipped = content.slice(0, 700);
    chars += clipped.length;
    if (chars > MAX_HISTORY_CHARS) break;
    cleaned.push({ role, content: clipped });
  }
  return cleaned;
}

function retrievalQuery(question, history) {
  const context = history
    .slice(-4)
    .map((item) => `${item.role}: ${item.content}`)
    .join('\n');
  return [context, `user: ${question}`].filter(Boolean).join('\n\n').slice(-MAX_HISTORY_CHARS);
}

function conversationContext(history) {
  if (!history.length) return 'No earlier conversation in this session.';
  return history.map((item) => `${item.role === 'user' ? 'User' : 'Thingy'}: ${item.content}`).join('\n');
}

function buildPrompt(question, chunks, history = []) {
  const sources = chunks.map((chunk, index) => [
    `Source ${index + 1}: Weekly Thing #${chunk.issue_number} - ${chunk.subject}`,
    `Date: ${chunk.publish_date || ''}`,
    `Section: ${chunk.section || ''}`,
    `URL: ${chunk.url || ''}`,
    chunk.text || ''
  ].join('\n'));
  return [
    'You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. Use only the archive sources below unless you explicitly say something is outside the archive. Use the conversation context to resolve follow-up questions, pronouns, and requests like "tell me more". Be direct, specific, and helpful. Do not use a greeting or signoff. Keep answers under 500 words unless the user asks for more detail. Cite issue numbers inline for substantive claims, using references like #295 or (#295, #297). Do not include URLs in prose. If the archive sources are not enough, say so. End with one concise, specific next-step offer describing what Thingy can do from here.',
    '',
    'Conversation so far:',
    '',
    conversationContext(history),
    '',
    `Question: ${question}`,
    '',
    'Archive sources:',
    '',
    sources.join('\n\n---\n\n')
  ].join('\n');
}

function citationsFor(chunks) {
  const seen = new Set();
  const citations = [];
  for (const chunk of chunks) {
    const key = `${chunk.issue_number}\0${chunk.section || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      issue_number: chunk.issue_number,
      subject: chunk.subject,
      publish_date: chunk.publish_date,
      section: chunk.section,
      url: chunk.url
    });
  }
  return citations;
}

function extractOutputText(response) {
  if (response?.output_text) return String(response.output_text);
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' || content.type === 'text') parts.push(content.text || '');
    }
  }
  return parts.join('\n').trim();
}

function writeSse(stream, event, data) {
  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamOpenAiAnswer(question, chunks, history, responseStream) {
  const start = performance.now();
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${openAiApiKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: 'You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. Be direct, specific, and helpful. Do not use a greeting or signoff. Keep answers under 500 words unless the user asks for more detail. Use conversation context for follow-ups. Cite issue numbers inline for substantive claims using #295 or (#295, #297), do not include URLs in prose, say when the archive does not contain enough evidence, and end with one concise, specific next-step offer.',
      input: buildPrompt(question, chunks, history),
      max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || '2500'),
      stream: true
    })
  });
  if (!openAiResponse.ok || !openAiResponse.body) throw new Error(`OpenAI stream failed with ${openAiResponse.status}`);

  const reader = openAiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  async function handleEvent(rawEvent) {
    const dataLines = rawEvent.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart());
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    if (data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'response.output_text.delta') {
      const delta = event.delta || '';
      if (delta) {
        answer += delta;
        writeSse(responseStream, 'answer_delta', { delta });
      }
    } else if (event.type === 'response.completed') {
      const completedText = extractOutputText(event.response);
      if (!answer && completedText) {
        answer = completedText;
        writeSse(responseStream, 'answer_delta', { delta: completedText });
      }
    } else if (event.type === 'response.failed' || event.type === 'error') {
      throw new Error(event.error?.message || 'OpenAI stream failed');
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || '';
    for (const event of events) await handleEvent(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) await handleEvent(buffer);

  logEvent('info', 'answer_streamed', { model, duration_ms: Math.round(performance.now() - start), answer_chars: answer.length });
  return answer;
}

function streamFromResponse(responseStream, event, statusCode) {
  return awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    }
  });
}

export const handler = awslambda.streamifyResponse(async (event, responseStream, context) => {
  const start = performance.now();
  const requestId = context?.awsRequestId || event.requestContext?.requestId || '';
  const { method, path } = methodAndPath(event);
  const summary = { request_id: requestId, method, path, origin: normalizeHeaders(event.headers || {}).origin };
  let subscriberHash = '';
  logEvent('info', 'request_started', summary);

  if (method === 'OPTIONS') {
    const stream = streamFromResponse(responseStream, event, 204);
    stream.end();
    return;
  }

  const stream = streamFromResponse(responseStream, event, method === 'POST' ? 200 : 404);
  try {
    if (method !== 'POST') {
      writeSse(stream, 'error', { error: 'Not found.', request_id: requestId });
      return;
    }

    const body = parseBody(event);
    const payload = verifyToken(extractBearer(event, body));
    if (!payload) {
      writeSse(stream, 'error', { error: 'Please validate your subscriber email to use the librarian.', request_id: requestId });
      return;
    }
    subscriberHash = String(payload.sub || '');

    const question = String(body.message || '').trim();
    const history = sanitizeHistory(body.history);
    if (!question) {
      writeSse(stream, 'error', { error: 'Ask a question about the archive.', request_id: requestId });
      return;
    }
    if (question.length > Number(process.env.MAX_QUESTION_CHARS || '1200')) {
      writeSse(stream, 'error', { error: 'Please ask a shorter question.', request_id: requestId });
      return;
    }
    if (!(await checkRateLimit(String(payload.sub)))) {
      writeSse(stream, 'error', { error: 'The librarian is at the hourly limit for this session.', request_id: requestId });
      return;
    }

    writeSse(stream, 'meta', { request_id: requestId });
    writeSse(stream, 'status', { message: 'Searching the archive...' });
    const chunks = await retrieve(retrievalQuery(question, history));
    if (!chunks.length) {
      writeSse(stream, 'answer_delta', { delta: 'I could not find enough in the archive to answer that from Weekly Thing sources. I can try a broader search term, look for a specific issue, or compare this topic with another archive theme.' });
      writeSse(stream, 'citations', { citations: [] });
      writeSse(stream, 'done', { request_id: requestId });
      await postTinylyticsEvent(event, 'librarian.chat_no_sources', {
        visitorId: subscriberHash,
        value: tinylyticsValue({ member: subscriberHash, history: history.length, chars: question.length })
      });
      logEvent('info', 'chat_completed_no_sources', {
        subscriber_hash: subscriberHash,
        question_chars: question.length,
        history_count: history.length,
        duration_ms: Math.round(performance.now() - start)
      });
      return;
    }

    writeSse(stream, 'status', { message: 'Writing answer...' });
    const citations = citationsFor(chunks);
    writeSse(stream, 'citations', { citations });
    await streamOpenAiAnswer(question, chunks, history, stream);
    writeSse(stream, 'done', { request_id: requestId });
    await postTinylyticsEvent(event, 'librarian.chat_success', {
      visitorId: subscriberHash,
      value: tinylyticsValue({ member: subscriberHash, citations: citations.length, history: history.length, chars: question.length })
    });
    logEvent('info', 'chat_completed', {
      subscriber_hash: subscriberHash,
      question_chars: question.length,
      history_count: history.length,
      citation_count: citations.length,
      duration_ms: Math.round(performance.now() - start)
    });
  } catch (error) {
    await postTinylyticsEvent(event, 'librarian.api_error', {
      visitorId: subscriberHash,
      value: tinylyticsValue({ member: subscriberHash || 'anonymous', route: path, type: error.constructor?.name || 'Error' })
    });
    logEvent('error', 'request_failed', { ...summary, error_type: error.constructor?.name || 'Error' });
    writeSse(stream, 'error', { error: 'The librarian could not generate an answer right now.', request_id: requestId });
  } finally {
    logEvent('info', 'request_completed', { ...summary, duration_ms: Math.round(performance.now() - start) });
    stream.end();
  }
});
