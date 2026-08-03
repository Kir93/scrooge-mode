// honest-bill rendering — scrooge-stats net-bill output.
//
// Asserts the stats formatter surfaces the three honest-bill additions: the
// self-injection overhead (netted against savings), input-side savings (with a
// per-source breakdown), and reasoning on its own uncompressed line — never
// folded into the savings base. Pure formatters, fed synthetic inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatStats, estimateTokens } from '../hooks/scrooge-stats.js';

const ACTIVE = { lang: 'ko', dial: 'full', flags: ['lean'] };

test('estimateTokens approximates ~4 chars/token, 0 for empty', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens('a'.repeat(40)), 10);
});

test('formatStats shows reasoning and self-overhead lines when present', () => {
  const out = formatStats({
    outputTokens: 1000,
    proseOutputTokens: 1000,
    toolUseOutputTokens: 0,
    reasoningOutputTokens: 250,
    inputOverheadTokens: 120,
    inputTokens: 5000,
    cacheReadTokens: 0,
    turns: 3,
    model: 'claude-opus-4-8',
    state: ACTIVE,
  });
  assert.match(out, /reasoning:\s+250 \(uncompressed\)/);
  assert.match(out, /Self overhead \(input\): -120 \(est, static rule ctx\)/);
});

test('formatStats omits reasoning/overhead lines when zero', () => {
  const out = formatStats({
    outputTokens: 1000,
    proseOutputTokens: 1000,
    reasoningOutputTokens: 0,
    inputOverheadTokens: 0,
    cacheReadTokens: 0,
    turns: 2,
    state: ACTIVE,
  });
  assert.doesNotMatch(out, /reasoning:/);
  assert.doesNotMatch(out, /Self overhead/);
});

test('formatStats says the lifetime total is unavailable when the history is over the read cap', () => {
  // sessions === 0 normally means "nothing accumulated yet" and the block is
  // omitted. Over the cap it means "unreadable" — silently showing the same
  // empty screen is how a lifetime total goes missing without a word.
  const out = formatStats({
    outputTokens: 1000,
    proseOutputTokens: 1000,
    reasoningOutputTokens: 0,
    inputOverheadTokens: 0,
    cacheReadTokens: 0,
    turns: 2,
    state: ACTIVE,
    ledger: { sessions: 0, savedTokens: 0, inputSavedTokens: 0, bySource: {}, unreadable: true },
  });
  assert.match(out, /Lifetime \(ledger\):\s+unavailable — history file could not be read/);
});

test('formatStats ledger block renders the net bill with input savings and per-source breakdown', () => {
  const out = formatStats({
    outputTokens: 2000,
    proseOutputTokens: 2000,
    reasoningOutputTokens: 0,
    inputOverheadTokens: 0,
    cacheReadTokens: 0,
    turns: 5,
    state: ACTIVE,
    ledger: {
      sessions: 2,
      savedTokens: 1000,
      inputSavedTokens: 400,
      inputOverheadTokens: 300,
      reasoningTokens: 500,
      netSavedTokens: 1100,
      bySource: { 'memory-compress': 400 },
      proseOutputTokens: 4000,
      savedUsd: 0.0165,
    },
  });
  assert.match(out, /Input tokens saved:\s+400 \(est\)/);
  assert.match(out, /memory-compress: 400/);
  assert.match(out, /Self overhead:\s+-300 \(est, static rule ctx\)/);
  assert.match(out, /Net tokens saved:\s+1,100 \(est\)/);
  assert.match(out, /Reasoning tokens:\s+500 \(uncompressed, not a saving\)/);
  assert.match(out, /Est\. value saved:\s+~\$0\.02 \(est, net\)/);
});
