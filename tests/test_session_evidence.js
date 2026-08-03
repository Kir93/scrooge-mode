// session-evidence analyze.js — per-turn signal attachment and intra-session
// trajectory. Asserts signal correctness, turn-1-relative trajectories with
// prose/tool separation, subagent opt-in separation, and — the ADR-003
// guardrail — the complete absence of savings/counterfactual fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachSignals, trajectory, analyzeSession } from '../benchmarks/session-evidence/analyze.js';
import { classifySession, buildReport, DEFAULT_THRESHOLDS } from '../benchmarks/session-evidence/report.js';
import { parseClaudeSessionTurns } from '../lib/session-log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'turns-session.jsonl');
const ANALYZE_SRC = path.join(HERE, '..', 'benchmarks', 'session-evidence', 'analyze.js');

function writeSession(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  return file;
}

const assistantLine = (id, text, output) => ({
  type: 'assistant',
  message: {
    id,
    model: 'claude-opus-4-8',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 0 },
  },
});

test('attachSignals detects safety categories and span counts per turn', (t) => {
  const file = writeSession(t, [
    assistantLine('m1', '비밀번호 유출 위험 — credential을 코드에 두지 마세요.', 50),
    assistantLine('m2', '`rm -rf`는 되돌릴 수 없습니다. See https://example.com/docs', 60),
    assistantLine('m3', 'plain answer, no markers', 40),
  ]);
  const signals = attachSignals(parseClaudeSessionTurns(file));
  assert.deepEqual(signals[0].safety, ['security']);
  assert.deepEqual(signals[1].safety, ['irreversible']);
  assert.deepEqual(signals[2].safety, []);
  assert.equal(signals[1].spans.inline, 1);
  assert.equal(signals[1].spans.urls, 1);
  assert.equal(signals[2].spans.fenced + signals[2].spans.inline + signals[2].spans.urls, 0);
});

test('trajectory is relative to each bucket own turn 1, prose/tool separated', () => {
  const turns = parseClaudeSessionTurns(FIXTURE); // 90 prose, 40 tool, 150 prose
  const traj = trajectory(turns);
  assert.deepEqual(traj.prose.map((p) => p.turnIndex), [1, 3]);
  assert.deepEqual(traj.prose.map((p) => p.relativeToFirst), [1, 150 / 90]);
  assert.deepEqual(traj.toolUse.map((p) => p.turnIndex), [2]);
  assert.deepEqual(traj.toolUse.map((p) => p.relativeToFirst), [1]);
});

test('trajectory yields null ratios instead of a fabricated trend on zero-token turn 1', (t) => {
  const file = writeSession(t, [assistantLine('m1', 'x', 0), assistantLine('m2', 'y', 80)]);
  const traj = trajectory(parseClaudeSessionTurns(file));
  assert.deepEqual(traj.prose.map((p) => p.relativeToFirst), [null, null]);
});

test('analyzeSession emits observations only — no savings/counterfactual fields', () => {
  const result = analyzeSession(FIXTURE, { includeSubagents: true });
  assert.equal(result.turnCount, 3);
  const json = JSON.stringify(result).toLowerCase();
  for (const banned of ['saved', 'savings', 'usd', 'counterfactual', 'baseline', 'percent']) {
    assert.ok(!json.includes(banned), `banned field leaked: ${banned}`);
  }
  // Turn records carry exactly the observation keys, nothing derived.
  assert.deepEqual(Object.keys(result.turns[0]).sort(), [
    'id',
    'isSubagent',
    'isToolUse',
    'model',
    'outputTokens',
    'safety',
    'spans',
    'turnIndex',
  ]);
});

test('analyzeSession separates opt-in subagent turns from the main trajectory', () => {
  const withSub = analyzeSession(FIXTURE, { includeSubagents: true });
  assert.equal(withSub.subagentTurns.length, 1);
  assert.equal(withSub.subagentTurns[0].isSubagent, true);
  // Main trajectory unchanged by the opt-in; default run has no subagent key.
  assert.deepEqual(withSub.trajectory, analyzeSession(FIXTURE).trajectory);
  assert.ok(!('subagentTurns' in analyzeSession(FIXTURE)));
});

test('analyze.js consumes the parser contract — no JSONL re-parse, no paired checks', () => {
  const src = fs.readFileSync(ANALYZE_SRC, 'utf8');
  // F1 handoff: text comes from parseClaudeSessionTurns only.
  assert.ok(src.includes('parseClaudeSessionTurns'));
  assert.ok(!src.includes('JSON.parse'), 'analyze.js must not re-parse session JSONL');
  // Paired fidelity checks need a baseline arm — must stay un-imported
  // (spec §2 제약). Inspect the import statement, not comments.
  const checksImport = src.match(/import\s*{[^}]*}\s*from\s*'\.\.\/fidelity\/checks\.js'/);
  assert.ok(checksImport, 'analyze.js must import from fidelity/checks.js');
  assert.ok(!/byteExactCheck|safetyCheck/.test(checksImport[0]));
});

test('analyzeSession degrades to an empty observation on unreadable input', () => {
  const result = analyzeSession('/no/such/file.jsonl');
  assert.equal(result.turnCount, 0);
  assert.deepEqual(result.turns, []);
  assert.deepEqual(result.trajectory, { prose: [], toolUse: [] });
});

// --- report.js: drift classification -------------------------------------

const proseAnalysis = (file, tokens) => ({
  file,
  turnCount: tokens.length,
  turns: [],
  trajectory: {
    prose: tokens.map((outputTokens, i) => ({ turnIndex: i + 1, outputTokens, relativeToFirst: null })),
    toolUse: [],
  },
});

test('classifySession judges flat as retained, rising as drifting, short as inconclusive', () => {
  const flat = classifySession(proseAnalysis('flat', [100, 110, 90, 105, 95, 100]));
  assert.equal(flat.verdict, 'retained');
  const rising = classifySession(proseAnalysis('rising', [100, 100, 110, 300, 320, 340]));
  assert.equal(rising.verdict, 'drifting');
  assert.ok(rising.ratio > DEFAULT_THRESHOLDS.driftRatio);
  const short = classifySession(proseAnalysis('short', [100, 200]));
  assert.equal(short.verdict, 'inconclusive');
  assert.equal(short.ratio, null);
});

test('classifySession honors threshold overrides', () => {
  const a = proseAnalysis('s', [100, 200]);
  assert.equal(classifySession(a, { ...DEFAULT_THRESHOLDS, minProseTurns: 2 }).verdict, 'drifting');
});

test('buildReport maps session verdicts to caveat-relax / reinject-tune / inconclusive', () => {
  const flat = proseAnalysis('f', [100, 100, 100, 100, 100, 100]);
  const rising = proseAnalysis('r', [100, 100, 100, 400, 400, 400]);
  const short = proseAnalysis('s', [100]);

  const relax = buildReport([flat, flat, rising, short]);
  assert.equal(relax.main.verdict, 'caveat-relax'); // 1/3 drifting ≤ 0.5 share
  assert.equal(relax.main.inconclusive, 1);

  const tune = buildReport([flat, rising, rising, rising]);
  assert.equal(tune.main.verdict, 'reinject-tune'); // 3/4 drifting > 0.5 share

  const none = buildReport([short, short]);
  assert.equal(none.main.verdict, 'inconclusive'); // no conclusive session — 판정 금지
});

test('buildReport reports the median late/early ratio over conclusive sessions only', () => {
  // The README quotes this number next to the counts and claims all four can be
  // checked against results.json, so it has to be a field — and it has to skip
  // inconclusive sessions, whose ratio is null and would sort as 0, dragging the
  // median down without anything looking wrong.
  const halved = proseAnalysis('a', [100, 100, 100, 50, 50, 50]); // ratio 0.5
  const level = proseAnalysis('b', [100, 100, 100, 100, 100, 100]); // ratio 1
  const doubled = proseAnalysis('c', [100, 100, 100, 200, 200, 200]); // ratio 2
  const short = proseAnalysis('d', [100]); // inconclusive, ratio null

  assert.equal(buildReport([halved, level, doubled]).main.medianRatio, 1);
  assert.equal(buildReport([halved, level, doubled, short]).main.medianRatio, 1);
  assert.equal(buildReport([short, short]).main.medianRatio, null);
});

test('buildReport aggregates subagent turns separately from the main verdict', () => {
  const withSub = analyzeSession(FIXTURE, { includeSubagents: true });
  const report = buildReport([withSub]);
  assert.equal(report.subagent.turns, 1);
  assert.equal(report.subagent.proseTurns, 1);
  assert.equal(report.subagent.spanTurns, 0);
  // Subagent turns never enter the main session counts.
  assert.equal(report.main.total, 1);
  const noSub = buildReport([analyzeSession(FIXTURE)]);
  assert.deepEqual(noSub.subagent, { turns: 0, proseTurns: 0, safetyTurns: 0, spanTurns: 0 });
});

test('buildReport emits no savings/counterfactual fields', () => {
  const json = JSON.stringify(
    buildReport([proseAnalysis('x', [100, 100, 100, 100, 100, 100])])
  ).toLowerCase();
  for (const banned of ['saved', 'savings', 'usd', 'counterfactual', 'percent']) {
    assert.ok(!json.includes(banned), `banned field leaked: ${banned}`);
  }
});
