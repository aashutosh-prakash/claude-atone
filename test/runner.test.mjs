import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRIGGERS, PROMPTS, matchesTrigger, extractText, lastAssistantText } from '../bin/on-stop.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('TRIGGERS is a non-empty list of lowercase phrases', () => {
  assert.ok(Array.isArray(TRIGGERS) && TRIGGERS.length > 0);
  for (const t of TRIGGERS) assert.equal(t, t.toLowerCase());
});

test('PROMPTS is a non-empty pool of safe single-line strings', () => {
  assert.ok(Array.isArray(PROMPTS) && PROMPTS.length >= 2);
  for (const p of PROMPTS) {
    assert.equal(typeof p, 'string');
    assert.ok(p.length > 0);
    assert.ok(!p.includes('\n'), 'prompt must be single-line (AppleScript dialog)');
    // No raw double-quote/backslash that would break the AppleScript literal
    // (none expected; this guards future additions).
    assert.ok(!/["\\]/.test(p), `prompt must not contain " or \\: ${p}`);
  }
});

test('matchesTrigger: case-insensitive, substring, mid-sentence', () => {
  assert.equal(matchesTrigger('You are RIGHT about that'), true);
  assert.equal(matchesTrigger("oops, I'll fix it"), true);
  assert.equal(matchesTrigger('Good catch!'), true);
  assert.equal(matchesTrigger('Here is the answer you requested.'), false);
  assert.equal(matchesTrigger(''), false);
  assert.equal(matchesTrigger(undefined), false);
});

test('extractText: normalizes string, content array, and {content}', () => {
  assert.equal(extractText('hello'), 'hello');
  assert.equal(extractText({ content: 'hi' }), 'hi');
  assert.equal(
    extractText({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] }),
    'a b'
  );
  assert.equal(extractText(null), '');
  assert.equal(extractText(undefined), '');
});

test('lastAssistantText: pulls the last assistant message from a JSONL transcript', () => {
  const text = lastAssistantText(path.join(__dirname, 'fixtures', 'transcript.jsonl'));
  assert.ok(matchesTrigger(text));
  assert.ok(text.includes('my mistake'));
});

test('lastAssistantText: missing file degrades to empty string (no throw)', () => {
  assert.equal(lastAssistantText('/no/such/transcript.jsonl'), '');
});
