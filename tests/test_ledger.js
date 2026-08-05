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
  aggregateLedger,
  sinceToEpoch,
  priceForModel,
  inputPriceForModel,
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
  // 1,000,000 opus output tokens at $25/Mtok = $25
  upsertSession({ sessionId: 's1', model: 'claude-opus-4-7', proseOutputTokens: 0, savedTokens: 1_000_000, ts: 1000 }, h);
  // unknown model contributes tokens but no currency
  upsertSession({ sessionId: 's2', model: 'mystery-model', proseOutputTokens: 0, savedTokens: 1_000_000, ts: 2000 }, h);
  const agg = aggregateLedger({}, h);
  assert.equal(agg.savedTokens, 2_000_000);
  assert.equal(Math.round(agg.savedUsd), 25);
});

test('priceForModel maps families; unknown / null → null', () => {
  assert.equal(priceForModel('claude-opus-4-7'), 25);
  assert.equal(priceForModel('claude-sonnet-4-6'), 15);
  assert.equal(priceForModel('claude-haiku-4-5'), 5);
  assert.equal(priceForModel('gpt-5-codex'), null);
  assert.equal(priceForModel(null), null);
  assert.equal(inputPriceForModel(null), null);
});

test('sinceToEpoch parses d/h windows and rejects junk', () => {
  assert.equal(sinceToEpoch('7d', 1_000_000_000), 1_000_000_000 - 7 * 86400000);
  assert.equal(sinceToEpoch('24h', 1_000_000_000), 1_000_000_000 - 24 * 3600000);
  assert.equal(sinceToEpoch('xyz', 1_000_000_000), null);
  assert.equal(sinceToEpoch('', 1_000_000_000), null);
  assert.equal(sinceToEpoch(null, 1_000_000_000), null);
});

test('aggregateLedger nets output savings against self overhead; reasoning apart', () => {
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
  const agg = aggregateLedger({}, h);
  assert.equal(agg.savedTokens, 1000);
  assert.equal(agg.inputOverheadTokens, 300);
  assert.equal(agg.netSavedTokens, 700); // 1000 saved output − 300 injected input
  assert.equal(agg.reasoningTokens, 500); // separate, never netted
  // Each side is priced at its OWN rate: saved output at opus $25/Mtok, injected
  // overhead at opus $5/Mtok. Pricing the netted token count once would value an
  // input token at the output rate, which is the bug this guards.
  const expected = (1000 / 1e6) * 25 - (300 / 1e6) * 5;
  assert.equal(Number(agg.savedUsd.toFixed(6)), Number(expected.toFixed(6)));
});

test('output and input rates are distinct per model family', () => {
  assert.equal(priceForModel('claude-opus-4-8'), 25);
  assert.equal(inputPriceForModel('claude-opus-4-8'), 5);
  assert.equal(priceForModel('claude-sonnet-5'), 15);
  assert.equal(inputPriceForModel('claude-sonnet-5'), 3);
  assert.equal(priceForModel('claude-haiku-4-5'), 5);
  assert.equal(inputPriceForModel('claude-haiku-4-5'), 1);
  assert.equal(priceForModel('gpt-5'), null);
  assert.equal(inputPriceForModel('gpt-5'), null);
});

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
  // A caller may omit `ts`, so the new entry sorts oldest and would be first over
  // the byte cliff — written, reported as success, and silently absent from the
  // file.
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

  assert.equal(upsertSession({ sessionId: 'no-ts', model: 'claude-opus-4-7', savedTokens: 42 }, h), true);
  assert.equal(aggregateLedger({}, h).savedTokens >= 42, true);
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
