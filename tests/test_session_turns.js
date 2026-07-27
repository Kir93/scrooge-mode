// session-log.js per-turn view — parseClaudeSessionTurns + listSubagentTranscripts.
//
// Asserts turn-index ordering, message.id dedup (turn count parity with the
// aggregate), scattered-text concatenation, prose/tool_use tagging, subagent
// opt-in enumeration, and never-throw degradation — plus a byte-invariance
// regression pin on the existing aggregate API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseClaudeSession,
  parseClaudeSessionTurns,
  listSubagentTranscripts,
  findRecentClaudeSession,
} from '../lib/session-log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// turns-session.jsonl: 3 counted responses — msg_T1 prose with a duplicated
// line and a second text block, msg_T2 tool_use-only, msg_T3 prose — plus a
// malformed line and a usage-less assistant line (not counted).
const FIXTURE = path.join(HERE, 'fixtures', 'turns-session.jsonl');
const AGENTIC_FIXTURE = path.join(HERE, 'fixtures', 'agentic-session.jsonl');

test('parseClaudeSessionTurns returns turn-index-ordered deduped turns', () => {
  const turns = parseClaudeSessionTurns(FIXTURE);
  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map((t) => t.turnIndex), [1, 2, 3]);
  assert.deepEqual(turns.map((t) => t.id), ['msg_T1', 'msg_T2', 'msg_T3']);
  assert.deepEqual(turns.map((t) => t.outputTokens), [90, 40, 150]);
  assert.equal(turns[0].model, 'claude-opus-4-8');
});

test('parseClaudeSessionTurns turn count matches the aggregate turns', () => {
  assert.equal(parseClaudeSessionTurns(FIXTURE).length, parseClaudeSession(FIXTURE).turns);
  assert.equal(
    parseClaudeSessionTurns(AGENTIC_FIXTURE).length,
    parseClaudeSession(AGENTIC_FIXTURE).turns
  );
});

test('parseClaudeSessionTurns concatenates scattered text blocks once per id', () => {
  const turns = parseClaudeSessionTurns(FIXTURE);
  // msg_T1: a duplicated line re-emits "part 1" (collected once) before a
  // second, distinct block — concatenated in stream order.
  assert.equal(turns[0].text, 'first answer part 1.\npart 2 with `npm test`.');
  assert.equal(turns[2].text, 'final prose turn.');
});

test('parseClaudeSessionTurns tags tool_use responses and leaves their text empty', () => {
  const turns = parseClaudeSessionTurns(FIXTURE);
  assert.equal(turns[1].isToolUse, true);
  assert.equal(turns[1].text, '');
  assert.equal(turns[0].isToolUse, false);
  // Mixed text+tool_use under one id is tool_use, never first-seen prose.
  const agentic = parseClaudeSessionTurns(AGENTIC_FIXTURE);
  assert.equal(agentic[1].id, 'msg_B');
  assert.equal(agentic[1].isToolUse, true);
  assert.equal(agentic[1].text, 'let me check');
});

test('parseClaudeSessionTurns tags isSubagent from the opt-in flag', () => {
  assert.equal(parseClaudeSessionTurns(FIXTURE)[0].isSubagent, false);
  const sub = parseClaudeSessionTurns(FIXTURE, { isSubagent: true });
  assert.ok(sub.every((t) => t.isSubagent === true));
});

test('parseClaudeSessionTurns carries no savings/counterfactual fields', () => {
  for (const turn of parseClaudeSessionTurns(FIXTURE)) {
    assert.deepEqual(Object.keys(turn).sort(), [
      'id',
      'isSubagent',
      'isToolUse',
      'model',
      'outputTokens',
      'text',
      'turnIndex',
    ]);
  }
});

test('parseClaudeSessionTurns degrades to an empty array on unreadable input', () => {
  assert.deepEqual(parseClaudeSessionTurns('/no/such/file.jsonl'), []);
});

test('listSubagentTranscripts enumerates <session>/subagents/*.jsonl', () => {
  const files = listSubagentTranscripts(FIXTURE);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith(path.join('turns-session', 'subagents', 'agent-a.jsonl')));
  const subTurns = parseClaudeSessionTurns(files[0], { isSubagent: true });
  assert.equal(subTurns.length, 1);
  assert.equal(subTurns[0].isSubagent, true);
  assert.equal(subTurns[0].text, 'subagent reply.');
});

test('listSubagentTranscripts returns [] when no subagent dir exists', () => {
  assert.deepEqual(listSubagentTranscripts(AGENTIC_FIXTURE), []);
});

test('default recency scan still excludes subagent transcripts (opt-in only)', (t) => {
  // The opt-in enumeration must not weaken SKIP_DIRS: a projects tree whose
  // only newer file is a subagents/*.jsonl still resolves to the main session.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-turns-skip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const proj = path.join(dir, 'projects', 'slug');
  fs.mkdirSync(path.join(proj, 'sess', 'subagents'), { recursive: true });
  const main = path.join(proj, 'sess.jsonl');
  const sub = path.join(proj, 'sess', 'subagents', 'agent-a.jsonl');
  fs.copyFileSync(FIXTURE, main);
  fs.copyFileSync(listSubagentTranscripts(FIXTURE)[0], sub);
  const older = new Date('2026-06-01T00:00:00Z');
  const newer = new Date('2026-06-02T00:00:00Z');
  fs.utimesSync(main, older, older);
  fs.utimesSync(sub, newer, newer);

  assert.equal(findRecentClaudeSession(dir), main);
  // …while the opt-in helper reaches exactly that excluded transcript.
  assert.deepEqual(listSubagentTranscripts(main), [sub]);
});

test('aggregate parseClaudeSession return is unchanged (byte-invariance pin)', () => {
  assert.deepEqual(parseClaudeSession(AGENTIC_FIXTURE), {
    inputTokens: 1100,
    outputTokens: 200,
    proseOutputTokens: 120,
    toolUseOutputTokens: 80,
    reasoningOutputTokens: 0,
    cacheReadTokens: 50,
    turns: 2,
    model: 'claude-opus-4-7',
  });
});
