// honest-bill rendering — scrooge-stats net-bill output.
//
// Asserts the stats formatter surfaces the three honest-bill additions: the
// self-injection overhead (netted against savings), input-side savings (with a
// per-source breakdown), and reasoning on its own uncompressed line — never
// folded into the savings base. Pure formatters, fed synthetic inputs.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatStats,
  formatShare,
  suffixFor,
  estimateTokens,
  deriveEstimate,
  selfOverheadTokens,
  estimateBasis,
} from '../plugin/hooks/scrooge-stats.js';
import { resolveRepoRoot, assembleRuleBody, buildFullInjection } from '../plugin/hooks/scrooge-activate.js';
import { buildReminder, LANG_META } from '../plugin/hooks/lang-meta.js';
import { writeState } from '../plugin/hooks/scrooge-config.js';
import { FULL_INJECTION_PREFIX } from '../plugin/lib/session-log.js';

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
  assert.match(out, /reasoning: 250 \(비압축\)/);
  assert.match(out, /자체 오버헤드 \(입력\): -120 \(추정, 정적 rule 컨텍스트\)/);
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
  assert.doesNotMatch(out, /자체 오버헤드/);
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
    ledger: { sessions: 0, savedTokens: 0, unreadable: true },
  });
  assert.match(out, /누적 \(원장\): 사용 불가 — history 파일 읽기 실패/);
});

test('formatStats ledger block nets saved output against our own injected overhead', () => {
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
      inputOverheadTokens: 300,
      reasoningTokens: 500,
      netSavedTokens: 700,
      proseOutputTokens: 4000,
      savedUsd: 0.0235,
    },
  });
  assert.match(out, /자체 오버헤드: -300 \(추정, 정적 rule 컨텍스트\)/);
  assert.match(out, /순 절약 토큰: 700 \(추정\)/);
  assert.match(out, /추론 토큰: 500 \(비압축, 절약 아님\)/);
  assert.match(out, /절약 금액 추정: ~\$0\.02 \(추정, 순액\)/);
  // Our own cost stays on screen — a bill that only ever shows savings is an ad.
  assert.doesNotMatch(out, /입력 토큰 절약/);
});

// ── S3-3: self overhead bills per hook firing, not per API response ──────────
// Hooks inject the full register at SessionStart and one reminder per prompt.
// Multiplying the reminder by `turns` (distinct responses) billed every tool-loop
// response as if it were a prompt.
const STATE = { lang: 'ko', dial: 'full', flags: ['lean'] };
function injectionCosts(state) {
  const body = assembleRuleBody(resolveRepoRoot(), state.lang, state.dial, state.flags);
  return {
    full: estimateTokens(buildFullInjection(state.lang, state.dial, body, state.flags)),
    reminder: estimateTokens(buildReminder(state.lang, state.dial, state.flags)),
  };
}

test('selfOverheadTokens bills the full register per SessionStart plus one reminder per prompt', () => {
  const { full, reminder } = injectionCosts(STATE);
  assert.ok(full > 0 && reminder > 0);
  // No SessionStart evidence: the activation prompt carried the full register.
  assert.equal(selfOverheadTokens(STATE, { userPrompts: 1, sessionStarts: 0 }), full);
  assert.equal(selfOverheadTokens(STATE, { userPrompts: 4, sessionStarts: 0 }), full + 3 * reminder);
  // Active from session start (+ one compaction re-injection): every prompt got a reminder.
  assert.equal(selfOverheadTokens(STATE, { userPrompts: 3, sessionStarts: 2 }), 2 * full + 3 * reminder);
  assert.equal(selfOverheadTokens(null, { userPrompts: 3 }), 0);
});

// R7: a mid-session activation bills only the injections that fired after it.
// Prompts are stamped at submit, before the hook stamps activatedAt, so the
// activating prompt (200 below) sits before the stamp and carries the full register.
test('selfOverheadTokens windows the bill to activatedAt when prompts are timestamped', () => {
  const { full, reminder } = injectionCosts(STATE);
  const at = { ...STATE, activatedAt: 250 };
  const sess = { userPrompts: 4, sessionStarts: 0, promptTimeline: [100, 200, 300, 400], sessionStartTimeline: [] };
  assert.equal(selfOverheadTokens(at, sess), full + 2 * reminder);
  // A SessionStart after activation (compaction) re-injects the full register; one before does not count.
  const withStarts = { ...sess, sessionStarts: 2, sessionStartTimeline: [50, 500] };
  assert.equal(selfOverheadTokens(at, withStarts), 2 * full + 2 * reminder);
  // Absent activatedAt (seeded / legacy): the whole-session bill, unchanged.
  assert.equal(selfOverheadTokens(STATE, sess), full + 3 * reminder);
  assert.equal(selfOverheadTokens(STATE, withStarts), 2 * full + 4 * reminder);
  // An untimestamped prompt cannot be placed — keep the whole-session bill.
  assert.equal(selfOverheadTokens(at, { ...sess, promptTimeline: [100, null, 300, 400] }), full + 3 * reminder);
});

// A /scrooge set on an already-active session (and a UserPromptSubmit seed) injects
// the full register on that prompt; where the transcript records it
// (fullPromptTimeline), that prompt bills full instead of a reminder.
test('selfOverheadTokens bills a prompt whose UserPromptSubmit carried the full register as full', () => {
  const { full, reminder } = injectionCosts(STATE);
  // Whole session: one SessionStart, three prompts, the second a mid-session set.
  assert.equal(
    selfOverheadTokens(STATE, { userPrompts: 3, sessionStarts: 1, promptTimeline: [100, 200, 300], sessionStartTimeline: [50], fullPromptTimeline: [200] }),
    2 * full + 2 * reminder
  );
  // No SessionStart: the recorded full contexts replace the assumed activation prompt.
  assert.equal(
    selfOverheadTokens(STATE, { userPrompts: 3, sessionStarts: 0, fullPromptTimeline: [100, 200] }),
    2 * full + reminder
  );
  // Windowed: the activating prompt (200, before the stamp) is the 1 full; a later
  // set (300) is a full, not a reminder.
  const at = { ...STATE, activatedAt: 250 };
  const sess = { userPrompts: 4, sessionStarts: 0, promptTimeline: [100, 200, 300, 400], sessionStartTimeline: [] };
  assert.equal(selfOverheadTokens(at, { ...sess, fullPromptTimeline: [200, 300] }), 2 * full + reminder);
  // Absent evidence keeps the existing fallback.
  assert.equal(selfOverheadTokens(at, { ...sess, fullPromptTimeline: [] }), full + 2 * reminder);
  // An unplaceable full prompt cannot be windowed — whole-session bill with the evidence.
  assert.equal(selfOverheadTokens(at, { ...sess, fullPromptTimeline: [null] }), full + 3 * reminder);
});

test('the SessionStart evidence prefix matches the full register Scrooge injects', () => {
  assert.ok(buildFullInjection('en', 'full', 'body', []).startsWith(FULL_INJECTION_PREFIX));
  assert.ok(buildFullInjection('ko', 'full', 'body', ['lean']).startsWith(FULL_INJECTION_PREFIX));
});

// ── S3-4: the savings ratio applies only to prose emitted after activation ───
test('estimateBasis sums prose at/after activatedAt, whole session without the stamp', () => {
  const sess = {
    proseOutputTokens: 350,
    proseTimeline: [
      { ts: 1000, outputTokens: 100 },
      { ts: 2000, outputTokens: 200 },
      { ts: 3000, outputTokens: 50 },
    ],
  };
  assert.equal(estimateBasis(sess, 2000), 250);
  assert.equal(estimateBasis(sess, 5000), 0);
  assert.equal(estimateBasis(sess, undefined), 350); // legacy state
  // An untimestamped response cannot be placed — keep the whole-session basis.
  assert.equal(estimateBasis({ ...sess, proseTimeline: [{ ts: null, outputTokens: 350 }] }, 2000), 350);
});

test('formatStats prices the estimate on the activation basis and shows it', () => {
  const out = formatStats({
    outputTokens: 1000,
    proseOutputTokens: 1000,
    estimateProseTokens: 400,
    cacheReadTokens: 0,
    turns: 3,
    state: ACTIVE,
  });
  assert.match(out, /활성화 이후: 400 \(추정 기준\)/);
  const est = deriveEstimate(400, ACTIVE.lang, ACTIVE.dial);
  assert.match(out, new RegExp(`절약 토큰 추정: ${est.saved.toLocaleString()} `));
});

// ── black-box: the stats entrypoint end to end ───────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const STATS = path.join(REPO_ROOT, 'plugin', 'hooks', 'scrooge-stats.js');
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Copy a transcript fixture into a fresh config dir as <key>.jsonl (the stem is
// the session key) and seed that session's state.
function stage(fixture, key, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-bill-'));
  tmpDirs.push(dir);
  const file = path.join(dir, `${key}.jsonl`);
  fs.copyFileSync(path.join(HERE, 'fixtures', fixture), file);
  if (state) assert.equal(writeState(state, path.join(dir, '.scrooge', 'sessions', key)), true);
  return { dir, file };
}

function runStats({ dir, file }, extra = []) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'plugin') };
  delete env.SCROOGE_AGENT;
  const r = spawnSync(process.execPath, [STATS, '--session-file', file, ...extra], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `stats exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function overheadOf(out) {
  const m = /자체 오버헤드 \(입력\): -([\d,]+)/.exec(out);
  assert.ok(m, `no overhead line in:\n${out}`);
  return Number(m[1].replace(/,/g, ''));
}

test('stats bills one prompt driving three responses as the full register only', () => {
  // turns-session.jsonl: 1 user prompt, 3 assistant responses, no SessionStart evidence.
  const out = runStats(stage('turns-session.jsonl', 'bill-one-prompt', STATE));
  assert.equal(overheadOf(out), injectionCosts(STATE).full);
});

test('stats bills each SessionStart re-injection and every prompt reminder', () => {
  const out = runStats(stage('prompts-session.jsonl', 'bill-restarts', STATE));
  const { full, reminder } = injectionCosts(STATE);
  assert.equal(overheadOf(out), 2 * full + 3 * reminder);
});

test('stats bills a mid-session /scrooge set (full register via UserPromptSubmit) as full', () => {
  // ups-full-session.jsonl: 1 SessionStart, 3 prompts, the second a "/scrooge en" set.
  const out = runStats(stage('ups-full-session.jsonl', 'bill-ups-full', STATE));
  const { full, reminder } = injectionCosts(STATE);
  assert.equal(overheadOf(out), 2 * full + 2 * reminder);
});

test('stats estimates savings only on prose emitted after activatedAt, and the ledger follows', () => {
  // prompts-session.jsonl prose: 100 @00:00:01, 200 @00:10:00, 50 @00:20:00.
  const activatedAt = Date.parse('2026-10-01T00:05:00.000Z');
  const staged = stage('prompts-session.jsonl', 'bill-activated', { ...STATE, activatedAt });
  const out = runStats(staged);
  const est = deriveEstimate(250, STATE.lang, STATE.dial);
  assert.match(out, /prose:\s+350\n/);
  assert.match(out, /활성화 이후: 250 \(추정 기준\)/);
  assert.match(out, new RegExp(`절약 토큰 추정: ${est.saved.toLocaleString()} `));
  const history = fs
    .readFileSync(path.join(staged.dir, '.scrooge', 'history.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(history.find((e) => e.sessionId === 'bill-activated').savedTokens, est.saved);
  // Overhead follows the same window: the queued prompt at 00:05 activated (full),
  // "second prompt" got a reminder, the 00:06 compaction re-injected the full register.
  const { full, reminder } = injectionCosts(STATE);
  assert.equal(overheadOf(out), 2 * full + reminder);
});

test('stats keeps the whole-session basis for a legacy state without activatedAt', () => {
  const out = runStats(stage('prompts-session.jsonl', 'bill-legacy', STATE));
  assert.doesNotMatch(out, /활성화 이후/);
  const est = deriveEstimate(350, STATE.lang, STATE.dial);
  assert.match(out, new RegExp(`절약 토큰 추정: ${est.saved.toLocaleString()} `));
});

// ── S3-13a: a malformed --since must not label all-time totals as a window ───
test('stats labels the ledger window only when --since parses', () => {
  const staged = stage('turns-session.jsonl', 'bill-since', STATE);
  const bad = runStats(staged, ['--since', 'lastweek']);
  assert.doesNotMatch(bad, /lastweek 이후/);
  assert.match(bad, /누적 \(원장\):/);
  assert.match(runStats(staged, ['--since', '7d']), /7d 이후 \(원장\):/);
});

test('formatStats renders in the active register language; en keeps the English receipt', () => {
  const out = formatStats({
    outputTokens: 1000,
    proseOutputTokens: 1000,
    estimateProseTokens: 400,
    inputOverheadTokens: 120,
    inputTokens: 5000,
    cacheReadTokens: 0,
    turns: 3,
    state: { lang: 'en', dial: 'full', flags: [] },
  });
  assert.match(out, /Scrooge Stats/);
  assert.match(out, /Input tokens: 5,000 \(measured\)/);
  assert.match(out, /since activation: 400 \(estimate basis\)/);
  assert.match(out, /Est\. tokens saved: [\d,]+ \(~\d+%, est\)/);
  assert.match(out, /Self overhead \(input\): -120 \(est, static rule ctx\)/);
});

test('inactive session falls back to the English receipt', () => {
  const out = formatStats({ outputTokens: 10, cacheReadTokens: 0, turns: 1, state: null });
  assert.match(out, /Scrooge Stats/);
  assert.match(out, /Scrooge inactive this session/);
});

test('--share line and statusline suffix follow the active language', () => {
  const view = { outputTokens: 1000, proseOutputTokens: 1000, turns: 3, state: ACTIVE };
  assert.match(formatShare(view), /이번 세션 3턴 동안 prose 출력 토큰 ~[\d,]+ 절약 \(추정\)/);
  assert.match(suffixFor(view), /^⛏ ~[\d.]+k? 절약 \(추정\)$/);
});

test('every LANG_META row carries the full stats string set, est marker on every estimate', () => {
  // Same key set as en, so no surface silently drops back to English mid-report;
  // and the honesty label survives translation on each estimate-derived string.
  const keys = (o) => Object.keys(o).sort();
  const en = LANG_META.en.stats;
  for (const lang of Object.keys(LANG_META)) {
    const t = LANG_META[lang].stats;
    assert.ok(t, `${lang}: missing stats`);
    assert.deepEqual(keys(t), keys(en), `${lang}: stats key set differs from en`);
    assert.deepEqual(keys(t.note), keys(en.note), `${lang}: stats.note key set differs from en`);
    for (const v of [...Object.values(t).filter((x) => typeof x !== 'object'), ...Object.values(t.note)]) {
      assert.equal(typeof v, 'string', `${lang}: non-string stats value`);
    }
    const est = t.note.est;
    for (const v of [t.note.pctEst, t.note.staticCtx, t.note.estProse, t.note.estNet, t.shareSaved, t.suffixSaved]) {
      assert.ok(v.includes(est), `${lang}: estimate string lacks est marker '${est}': ${v}`);
    }
  }
});
