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
  findRecentClaudeSession,
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
// agentic-session.jsonl is the canary against schema-drift blind spots the
// prose-only fixture above can't catch: two responses whose usage is repeated
// across content-block lines under one message.id (dedup), and one whose text
// block precedes a same-id tool_use block (prose/tool_use classification).
const AGENTIC_FIXTURE = path.join(HERE, 'fixtures', 'agentic-session.jsonl');

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
  // No tool_use blocks in this fixture → all output is prose.
  assert.equal(s.proseOutputTokens, 300);
  assert.equal(s.toolUseOutputTokens, 0);
});

test('parseClaudeSession dedups repeated message.id usage (no content-block double count)', () => {
  const s = parseClaudeSession(AGENTIC_FIXTURE);
  // Four assistant usage lines across two message.ids; a naive per-line sum is
  // 400 output / 100 cache, the dedup-by-id count is 200 / 50 across 2 turns.
  assert.equal(s.outputTokens, 200);
  assert.equal(s.cacheReadTokens, 50);
  assert.equal(s.turns, 2);
  assert.equal(s.model, 'claude-opus-4-7');
});

test('parseClaudeSession buckets a mixed text+tool_use response as tool_use, not first-seen prose', () => {
  const s = parseClaudeSession(AGENTIC_FIXTURE);
  // msg_A is prose (120). msg_B streams a text block before a same-id tool_use
  // block → the whole response is tool_use (80). First-seen classification would
  // mis-bucket msg_B as prose; the buckets must still sum to total output.
  assert.equal(s.proseOutputTokens, 120);
  assert.equal(s.toolUseOutputTokens, 80);
  assert.equal(s.proseOutputTokens + s.toolUseOutputTokens, s.outputTokens);
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
  // Reasoning is subtracted from visible output but surfaced separately
  // (cumulative total = 40) for the honest bill's uncompressed line.
  assert.equal(s.reasoningOutputTokens, 40);
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
  // Fallback path sums per-event reasoning (10 + 0).
  assert.equal(s.reasoningOutputTokens, 10);
});

test('parseClaudeSession surfaces reasoning when a host provides it, else 0', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-claude-reasoning-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Claude folds thinking into output_tokens, so reasoning is usually absent → 0.
  assert.equal(parseClaudeSession(FIXTURE).reasoningOutputTokens, 0);
  // But when a host does carry the field, it is captured (deduped by id like usage).
  const file = path.join(dir, 'reasoning-session.jsonl');
  const line = (id, output, reasoning) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-opus-4-8',
        usage: { input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, cache_read_input_tokens: 0 },
      },
    });
  fs.writeFileSync(file, [line('a', 100, 25), line('a', 100, 25), line('b', 50, 10)].join('\n'));
  const s = parseClaudeSession(file);
  assert.equal(s.reasoningOutputTokens, 35); // 25 (deduped) + 10
  assert.equal(s.outputTokens, 150);
});

test('parseCodexSession degrades to EMPTY_SUMMARY for a missing file', () => {
  assert.deepEqual(parseCodexSession('/whatever'), { ...EMPTY_SUMMARY });
});

test('parseClaudeSession aggregates input_tokens with the same id dedup as output', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-input-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'input-session.jsonl');
  const line = (id, input, output) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-opus-4-8',
        usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0 },
      },
    });
  // id "a" repeats across content-block lines (deduped → counted once); "b" once.
  fs.writeFileSync(file, [line('a', 100, 30), line('a', 100, 30), line('b', 200, 40)].join('\n'));
  const s = parseClaudeSession(file);
  assert.equal(s.inputTokens, 300); // 100 (deduped) + 200, not 400
  assert.equal(s.outputTokens, 70);
  assert.equal(s.turns, 2);
});

test('EMPTY_SUMMARY carries inputTokens and unreadable input degrades to it', () => {
  assert.equal(EMPTY_SUMMARY.inputTokens, 0);
  assert.equal(parseClaudeSession('/no/such/file').inputTokens, 0);
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

test('findRecentClaudeSession skips subagent transcripts and picks the main session', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-claude-skip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const proj = path.join(dir, 'projects', 'slug');
  fs.mkdirSync(path.join(proj, 'sess-uuid', 'subagents'), { recursive: true });
  const main = path.join(proj, 'main.jsonl');
  const sub = path.join(proj, 'sess-uuid', 'subagents', 'agent-x.jsonl');
  fs.writeFileSync(main, '{}\n');
  fs.writeFileSync(sub, '{}\n');
  // Make the subagent log strictly newer so a naive recency scan would pick it.
  const older = new Date('2026-06-01T00:00:00Z');
  const newer = new Date('2026-06-02T00:00:00Z');
  fs.utimesSync(main, older, older);
  fs.utimesSync(sub, newer, newer);

  assert.equal(findRecentClaudeSession(dir), main);
});
