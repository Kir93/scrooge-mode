// session-log.js — Claude transcript JSONL parsing adapter.
//
// Asserts the parser sums real usage, counts only assistant turns, tolerates
// malformed lines / missing usage, and degrades to EMPTY_SUMMARY on unreadable
// input — never throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseClaudeSession,
  parseCodexSession,
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

test('parseCodexSession is a non-throwing empty stub', () => {
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

test('readSession routes the codex agent to the stub', () => {
  const r = readSession({ agent: 'codex', sessionFile: '/some/codex.jsonl' });
  assert.equal(r.agent, 'codex');
  assert.equal(r.outputTokens, 0);
});
