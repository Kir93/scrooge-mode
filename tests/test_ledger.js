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

// Regression: the read cap (bytes) and the write cap (sessions) used to be in
// different units, so a history of large entries could pass the write cap while
// failing the read cap. The read then returned null, the writer read that as "no
// history yet", and the next write replaced a lifetime of entries with one line.
test('a history file over the read cap is never overwritten', () => {
  const h = tmpHistory();
  // 300 KB of well-formed entries — past the 256 KB read cap.
  const lines = [];
  for (let i = 0; i < 1200; i++) {
    lines.push(
      JSON.stringify({ sessionId: `s${i}`, model: 'claude-opus-4-7', savedTokens: 10, ts: i, pad: 'x'.repeat(200) })
    );
  }
  const body = lines.join('\n') + '\n';
  fs.writeFileSync(h, body);
  assert.ok(fs.statSync(h).size > 256 * 1024);

  assert.equal(upsertSession({ sessionId: 'new', savedTokens: 999, ts: 99999 }, h), false);
  assert.equal(recordInputDelta({ sessionKey: 'new', source: 'memory-compress', saved: 5 }, h), false);
  assert.equal(fs.readFileSync(h, 'utf8'), body); // untouched, not collapsed to one entry

  // The zeros are reported as "unreadable", not as "nothing was ever saved".
  const agg = aggregateLedger({}, h);
  assert.equal(agg.sessions, 0);
  assert.equal(agg.unreadable, true);
});

test('a write that would cross the read cap drops the oldest entries instead', () => {
  const h = tmpHistory();
  // Fill to just under the cap with well-formed entries, well below MAX_SESSIONS
  // so the session-count cap cannot be what trims — only the byte cap can.
  const line = (i) =>
    JSON.stringify({ sessionId: `s${String(i).padStart(400, '0')}`, model: 'claude-opus-4-7', savedTokens: 1, ts: i });
  const seeded = [];
  let bytes = 1;
  for (let i = 1; bytes + line(i).length + 1 < 256 * 1024; i++) {
    seeded.push(line(i));
    bytes += line(i).length + 1;
  }
  fs.writeFileSync(h, seeded.join('\n') + '\n');
  assert.ok(seeded.length < 1000, 'seed must stay under the session cap');
  const oldest = JSON.parse(seeded[0]).sessionId;

  assert.equal(upsertSession({ sessionId: 'newest', savedTokens: 7, ts: 10 ** 9 }, h), true);

  assert.ok(fs.statSync(h).size <= 256 * 1024); // still readable next session
  const after = fs.readFileSync(h, 'utf8');
  assert.ok(after.includes('"sessionId":"newest"'));
  assert.ok(!after.includes(`"sessionId":"${oldest}"`)); // oldest dropped, not the new write
  assert.equal(aggregateLedger({}, h).unreadable, false);
});

test('a near-full history keeps the entry being written, even with no timestamp', () => {
  // recordInputDelta callers may omit `ts` (hooks/scrooge-memory.js does), so the
  // new entry sorts oldest and would be first over the byte cliff — written,
  // reported as success, and silently absent from the file.
  const h = tmpHistory();
  const line = (i) =>
    JSON.stringify({ sessionId: `s${String(i).padStart(400, '0')}`, model: 'claude-opus-4-7', savedTokens: 1, ts: i });
  const seeded = [];
  let bytes = 1;
  for (let i = 1; bytes + line(i).length + 1 < 256 * 1024; i++) {
    seeded.push(line(i));
    bytes += line(i).length + 1;
  }
  fs.writeFileSync(h, seeded.join('\n') + '\n');

  assert.equal(recordInputDelta({ sessionKey: 'no-ts', source: 'memory-compress', saved: 42 }, h), true);
  assert.equal(aggregateLedger({}, h).bySource['memory-compress'], 42);
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
