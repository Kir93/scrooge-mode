// ledger.js — lifetime savings ledger contract.
//
// The load-bearing property is idempotency: /scrooge-stats can run many times in
// one session, so the ledger upserts by session id rather than appending — a
// lifetime total must not double-count (the Task 1 dedup bug, re-asserted at the
// ledger layer). Also covers aggregation, the --since window, currency mapping,
// and symlink-safe writes. All times are injected so the tests stay deterministic.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  upsertSession,
  recordInputDelta,
  aggregateLedger,
  sinceToEpoch,
  priceForModel,
} from '../lib/ledger.js';

const tmpDirs = [];
function tmpHistory() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-ledger-'));
  tmpDirs.push(d);
  return path.join(d, '.scrooge-history.jsonl');
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

test('upsertSession is idempotent — re-running one session does not double-count', () => {
  const h = tmpHistory();
  const entry = { sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 1000, savedTokens: 600, ts: 1000 };
  upsertSession(entry, h);
  upsertSession(entry, h);
  upsertSession(entry, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.savedTokens, 600); // not 1800
  assert.equal(agg.proseOutputTokens, 1000);
});

test('upsertSession overwrites a session with its latest totals', () => {
  const h = tmpHistory();
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 500, savedTokens: 300, ts: 1000 }, h);
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 1200, savedTokens: 700, ts: 2000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.savedTokens, 700); // latest, not summed
});

test('aggregateLedger sums distinct sessions', () => {
  const h = tmpHistory();
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 1000, savedTokens: 600, ts: 1000 }, h);
  upsertSession({ sessionId: 's2', model: 'claude-opus-4-7', proseOutputTokens: 2000, savedTokens: 400, ts: 2000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 2);
  assert.equal(agg.savedTokens, 1000);
  assert.equal(agg.proseOutputTokens, 3000);
});

test('aggregateLedger --since filters by window lower bound', () => {
  const h = tmpHistory();
  upsertSession({ sessionId: 'old', model: 'x', proseOutputTokens: 100, savedTokens: 100, ts: 1000 }, h);
  upsertSession({ sessionId: 'new', model: 'x', proseOutputTokens: 100, savedTokens: 200, ts: 5000 }, h);
  const agg = aggregateLedger({ since: 3000 }, h);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.savedTokens, 200); // only 'new'
});

test('currency: savedUsd sums each session at its model rate; unknown model → no USD', () => {
  const h = tmpHistory();
  // 1,000,000 opus output tokens at $15/Mtok = $15
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 0, savedTokens: 1_000_000, ts: 1000 }, h);
  // unknown model contributes tokens but no currency
  upsertSession({ sessionId: 's2', model: 'mystery-model', proseOutputTokens: 0, savedTokens: 1_000_000, ts: 2000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.savedTokens, 2_000_000);
  assert.equal(Math.round(agg.savedUsd), 15);
});

test('priceForModel maps families; unknown / null → null', () => {
  assert.equal(priceForModel('claude-opus-4-7'), 15);
  assert.equal(priceForModel('claude-sonnet-4-6'), 3);
  assert.equal(priceForModel('claude-haiku-4-5'), 0.8);
  assert.equal(priceForModel('gpt-5-codex'), null);
  assert.equal(priceForModel(null), null);
});

test('sinceToEpoch parses d/h windows and rejects junk', () => {
  assert.equal(sinceToEpoch('7d', 1_000_000_000), 1_000_000_000 - 7 * 86400000);
  assert.equal(sinceToEpoch('24h', 1_000_000_000), 1_000_000_000 - 24 * 3600000);
  assert.equal(sinceToEpoch('xyz', 1_000_000_000), null);
  assert.equal(sinceToEpoch('', 1_000_000_000), null);
  assert.equal(sinceToEpoch(null, 1_000_000_000), null);
});

test('recordInputDelta is idempotent on (sessionKey, source) — re-recording overwrites', () => {
  const h = tmpHistory();
  const d = { sessionKey: 's1', source: 'memory-compress', saved: 460, ts: 1000 };
  recordInputDelta(d, h);
  recordInputDelta(d, h);
  recordInputDelta(d, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.inputSavedTokens, 460); // not 1380
  assert.equal(agg.bySource['memory-compress'], 460);
});

test('recordInputDelta sums distinct sources per session into one input total', () => {
  const h = tmpHistory();
  recordInputDelta({ sessionKey: 's1', source: 'memory-compress', saved: 400, ts: 1000 }, h);
  recordInputDelta({ sessionKey: 's1', source: 'other-surface', saved: 200, ts: 1000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.inputSavedTokens, 600);
  assert.equal(agg.bySource['memory-compress'], 400);
  assert.equal(agg.bySource['other-surface'], 200);
});

test('upsertSession and recordInputDelta coexist — neither clobbers the other', () => {
  const h = tmpHistory();
  // Output side records first, then an input surface, then stats re-upserts.
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 1000, savedTokens: 600, ts: 1000 }, h);
  recordInputDelta({ sessionKey: 's1', source: 'memory-compress', saved: 300, ts: 1000 }, h);
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 1200, savedTokens: 700, ts: 2000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.savedTokens, 700); // latest output-side, preserved
  assert.equal(agg.inputSavedTokens, 300); // input delta NOT wiped by the re-upsert
});

test('aggregateLedger nets output + input − self overhead; reasoning is reported apart', () => {
  const h = tmpHistory();
  upsertSession({
    sessionId: 's1',
    model: 'claude-opus-4-7',
    proseOutputTokens: 2000,
    savedTokens: 1000,
    reasoningTokens: 500,
    inputOverheadTokens: 300,
    ts: 1000,
  }, h);
  recordInputDelta({ sessionKey: 's1', source: 'memory-compress', saved: 400, ts: 1000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.savedTokens, 1000);
  assert.equal(agg.inputSavedTokens, 400);
  assert.equal(agg.inputOverheadTokens, 300);
  assert.equal(agg.netSavedTokens, 1100); // 1000 + 400 − 300
  assert.equal(agg.reasoningTokens, 500); // separate, not in net
  // USD monetizes the net (1100) at opus $15/Mtok.
  assert.equal(Number(agg.savedUsd.toFixed(4)), Number(((1100 / 1e6) * 15).toFixed(4)));
});

test('recordInputDelta refuses invalid input', () => {
  const h = tmpHistory();
  assert.equal(recordInputDelta(null, h), false);
  assert.equal(recordInputDelta({ sessionKey: '', source: 'x', saved: 1 }, h), false);
  assert.equal(recordInputDelta({ sessionKey: 's1', source: '', saved: 1 }, h), false);
  assert.equal(recordInputDelta({ sessionKey: 's1', source: 'x', saved: -1 }, h), false);
  assert.equal(aggregateLedger({}, h).sessions, 0); // nothing written
});

test('upsertSession refuses invalid input and a symlinked history path', {
  skip: process.platform === 'win32' ? 'symlinkSync needs admin/Developer Mode on Windows' : false,
}, () => {
  const h = tmpHistory();
  assert.equal(upsertSession({ sessionId: '' }, h), false); // empty id
  assert.equal(upsertSession(null, h), false);
  // Clobber vector: writing through a symlink must be refused, target untouched.
  const dir = path.dirname(h);
  const secret = path.join(dir, 'secret');
  fs.writeFileSync(secret, 'original');
  fs.symlinkSync(secret, h);
  assert.equal(upsertSession({ sessionId: 's1', savedTokens: 1, ts: 1 }, h), false);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'original');
});
