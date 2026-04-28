import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const cache = new Map();

export const FALLBACK_PROMPTS = [
  { label: 'What changed about RSS?', question: 'What has the archive said about RSS and the open web?' },
  { label: 'Where did AI get weird?', question: 'Find issues where Jamie wrote about AI.' },
  { label: 'What should I revisit?', question: 'What themes show up around productivity and personal systems?' }
];

export function promptPath(name) {
  return path.join(PROMPTS_DIR, name);
}

export function loadPrompt(name) {
  if (!cache.has(name)) {
    cache.set(name, fs.readFileSync(promptPath(name), 'utf8').trim());
  }
  return cache.get(name);
}

export function loadToolSpecs() {
  return JSON.parse(loadPrompt('tool-specs.json'));
}

export function renderTemplate(text, values = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(values[key] ?? ''));
}

export function answerStyle() {
  return loadPrompt('answer-style.md').replace(/\s+/g, ' ');
}

export function agentSystemPrompt() {
  return renderTemplate(loadPrompt('agent-system.md'), { answer_style: answerStyle() });
}

export function baselineSystemPrompt() {
  return renderTemplate(loadPrompt('baseline-system.md'), { answer_style: answerStyle() });
}

export function baselineUserPrompt({ conversation_context, question, archive_sources } = {}) {
  return renderTemplate(loadPrompt('baseline-user.md'), {
    conversation_context,
    question,
    archive_sources
  });
}

export function suggestedQuestionsSystemPrompt() {
  return loadPrompt('suggested-questions-system.md');
}

export function suggestedQuestionsUserPrompt(promptContext) {
  return renderTemplate(loadPrompt('suggested-questions-user.md'), { prompt_context: promptContext });
}

export function premiumThankYouSystemPrompt() {
  return loadPrompt('premium-thank-you.md');
}

export function sanitizePrompts(value) {
  const items = value && !Array.isArray(value) ? value.prompts : value;
  const prompts = [];
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim();
    const question = String(item.question || '').trim();
    if (!label || !question) continue;
    prompts.push({ label: label.slice(0, 72), question: question.slice(0, 220) });
    if (prompts.length === 3) break;
  }
  return prompts.length === 3 ? prompts : [];
}

export function extractJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in model response');
    return JSON.parse(match[0]);
  }
}
