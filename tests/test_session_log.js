// session-log.js — Claude transcript JSONL parsing adapter.
//
// Asserts the parser sums real usage, counts only assistant turns, tolerates
// malformed lines / missing usage, and degrades to EMPTY_SUMMARY on unreadable
// input — never throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseClaudeSession,
  parseCodexSession,
  findRecentCodexSession,
  readSession,
  EMPTY_SUMMARY,
} from '../lib/session-log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// sample-session.jsonl encodes the Claude Code transcript schema verified
// locally 2026-05 (see lib/session-log.js header). It is an undocumented,
// version-drifting host schema: if Claude changes it, refresh the fixture AND
// the session-log.js date together. Assertions below check exact values
// (output 300, cache 50) so a stale fixture fails loudly rather than silently.
const FIXTURE = path.join(HERE, 'fixtures', 'sample-session.jsonl');

function makeCodexSession(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-codex-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample-codex-session.jsonl');
  const lines = [
    {
      timestamp: '2026-06-01T00:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'codex-fixture', model: 'gpt-5-codex' },
    },
    {
      timestamp: '2026-06-01T00:00:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 100,
            output_tokens: 300,
            reasoning_output_tokens: 40,
            total_tokens: 1300,
          },
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 100,
            output_tokens: 300,
            reasoning_output_tokens: 40,
            total_tokens: 1300,
          },
        },
      },
    },
    {
      timestamp: '2026-06-01T00:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 800,
            cached_input_tokens: 0,
            output_tokens: 120,
            reasoning_output_tokens: 0,
            total_tokens: 920,
          },
          total_token_usage: {
            input_tokens: 1800,
            cached_input_tokens: 100,
            output_tokens: 420,
            reasoning_output_tokens: 40,
            total_tokens: 2220,
          },
        },
      },
    },
    {
      timestamp: '2026-06-01T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'not counted' }],
      },
    },
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\nnot json\n');
  return file;
}

test('parseClaudeSession sums output/cache tokens across assistant turns', () => {
  const s = parseClaudeSession(FIXTURE);
  // Two well-formed assistant lines: 100+200 output, 50+0 cache, 2 turns.
  // The user line, malformed line, usage-less assistant, and summary are skipped.
  assert.equal(s.outputTokens, 300);
  assert.equal(s.cacheReadTokens, 50);
  assert.equal(s.turns, 2);
  assert.equal(s.model, 'claude-opus-4-7');
});

test('parseClaudeSession degrades to EMPTY_SUMMARY for a missing file', () => {
  const s = parseClaudeSession(path.join(HERE, 'fixtures', 'does-not-exist.jsonl'));
  assert.deepEqual(s, { ...EMPTY_SUMMARY });
});

test('parseCodexSession reads visible output/cache tokens from cumulative totals', (t) => {
  const s = parseCodexSession(makeCodexSession(t));
  // Two token_count events: final cumulative visible output is 420-40.
  // response_item lines and malformed lines are skipped.
  assert.equal(s.outputTokens, 380);
  assert.equal(s.cacheReadTokens, 100);
  assert.equal(s.turns, 2);
  assert.equal(s.model, 'gpt-5-codex');
});

test('parseCodexSession ignores duplicate cumulative token_count re-emits', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-codex-duplicate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'duplicate-codex-session.jsonl');
  const tokenCount = {
    timestamp: '2026-06-01T00:00:01.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 100,
          output_tokens: 300,
          reasoning_output_tokens: 40,
          total_tokens: 1300,
        },
        total_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 100,
          output_tokens: 300,
          reasoning_output_tokens: 40,
          total_tokens: 1300,
        },
      },
    },
  };
  fs.writeFileSync(file, [tokenCount, tokenCount].map((line) => JSON.stringify(line)).join('\n'));

  const s = parseCodexSession(file);
  assert.equal(s.outputTokens, 260);
  assert.equal(s.cacheReadTokens, 100);
  assert.equal(s.turns, 1);
});

test('parseCodexSession falls back to last_token_usage when totals are absent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-codex-last-only-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'last-only-codex-session.jsonl');
  const lines = [
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            cached_input_tokens: 25,
            output_tokens: 90,
            reasoning_output_tokens: 10,
          },
        },
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            cached_input_tokens: 5,
            output_tokens: 40,
            reasoning_output_tokens: 0,
          },
        },
      },
    },
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'));

  const s = parseCodexSession(file);
  assert.equal(s.outputTokens, 120);
  assert.equal(s.cacheReadTokens, 30);
  assert.equal(s.turns, 2);
});

test('parseCodexSession degrades to EMPTY_SUMMARY for a missing file', () => {
  assert.deepEqual(parseCodexSession('/whatever'), { ...EMPTY_SUMMARY });
});

test('readSession honors an explicit sessionFile over discovery', () => {
  const r = readSession({ sessionFile: FIXTURE });
  assert.equal(r.agent, 'claude');
  assert.equal(r.file, FIXTURE);
  assert.equal(r.outputTokens, 300);
  assert.equal(r.turns, 2);
});

test('readSession returns an empty claude summary when no file resolves', () => {
  // A claudeDir with no projects/ dir → no session found.
  const r = readSession({ claudeDir: path.join(HERE, 'fixtures', 'empty-config') });
  assert.equal(r.agent, 'claude');
  assert.equal(r.file, null);
  assert.equal(r.outputTokens, 0);
  assert.equal(r.turns, 0);
});

test('readSession routes the codex agent to Codex parsing', (t) => {
  const file = makeCodexSession(t);
  const r = readSession({ agent: 'codex', sessionFile: file });
  assert.equal(r.agent, 'codex');
  assert.equal(r.file, file);
  assert.equal(r.outputTokens, 380);
});

test('findRecentCodexSession returns null when no sessions dir resolves', () => {
  const r = findRecentCodexSession(path.join(HERE, 'fixtures', 'empty-codex-config'));
  assert.equal(r, null);
});
