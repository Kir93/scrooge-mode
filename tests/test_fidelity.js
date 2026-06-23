// fidelity deterministic core — canary.
//
// Covers the CI-tested half of the fidelity bench (benchmarks/fidelity/checks.js):
// verbatim span extraction, byte-exact preservation (dropped fails, additions are
// advisory), safety-register preservation, judge-verdict parsing, and the combined
// pair gate. No model calls — the LLM equivalence judgment lives in judge.py and is
// exercised only in the quota-gated offline run, never here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSpans,
  byteExactCheck,
  detectSafety,
  safetyCheck,
  parseVerdict,
  scorePair,
} from '../benchmarks/fidelity/checks.js';

test('extractSpans pulls fenced/inline/urls and dedups', () => {
  const text =
    'See `rules/ko/full.md` and `rules/ko/full.md` again.\n' +
    '```js\nconst a = 1;\n```\n' +
    'Docs at https://example.com/a, and https://example.com/a too.';
  const spans = extractSpans(text);
  assert.deepEqual(spans.inline, ['rules/ko/full.md']);
  assert.deepEqual(spans.fenced, ['const a = 1;']);
  assert.deepEqual(spans.urls, ['https://example.com/a']);
});

test('extractSpans ignores backticks that live inside a fenced block', () => {
  const text = '```\nrun `npm test` now\n```';
  const spans = extractSpans(text);
  assert.equal(spans.fenced.length, 1);
  assert.deepEqual(spans.inline, []); // the inner `npm test` is part of the fence
});

test('byteExactCheck passes when the candidate emits no untraceable span', () => {
  const baseline = 'Use `git reset --hard` then visit https://x.io/guide';
  const candidate = '`git reset --hard`. https://x.io/guide';
  const r = byteExactCheck(baseline, candidate);
  assert.equal(r.pass, true);
  assert.equal(r.corruptedCount, 0);
});

test('byteExactCheck passes when the candidate merely drops a baseline example (compression, not corruption)', () => {
  const baseline = 'Use `foo()` and `bar()`.';
  const candidate = 'Use `foo()`.'; // bar() dropped — informational, not a failure
  const r = byteExactCheck(baseline, candidate);
  assert.equal(r.pass, true);
  assert.deepEqual(r.dropped.inline, ['bar()']);
});

test('byteExactCheck fails when the candidate mangles a command (corruption)', () => {
  const baseline = 'Run `rm -rf ./build` exactly.';
  const mangled = 'Run `rm -rf ./dist` exactly.'; // a token absent from the baseline
  const r = byteExactCheck(baseline, mangled);
  assert.equal(r.pass, false);
  assert.deepEqual(r.corrupted.inline, ['rm -rf ./dist']);
});

test('byteExactCheck flags a candidate-only (untraceable) span as corruption', () => {
  const baseline = 'Just prose, no code.';
  const candidate = 'Here is `extra()` code.';
  const r = byteExactCheck(baseline, candidate);
  assert.equal(r.pass, false);
  assert.deepEqual(r.corrupted.inline, ['extra()']);
});

test('byteExactCheck does not false-fail when a fenced block is re-split (line multiset)', () => {
  // Regression (critic WARNING): block-body equality would flag this as dropped.
  const baseline = '```js\na();\nb();\n```';
  const candidate = '```js\na();\n```\nthen\n```js\nb();\n```';
  const r = byteExactCheck(baseline, candidate);
  assert.equal(r.pass, true);
});

test('detectSafety finds genuine security / irreversible markers, not ordinary prose', () => {
  assert.deepEqual(detectSafety('이 작업은 되돌릴 수 없음').sort(), ['irreversible']);
  assert.ok(detectSafety('This may expose a credential (security risk)').includes('security'));
  // The narrowed set no longer treats bare 주의/확인 technical prose as a safety warning.
  assert.deepEqual(detectSafety('주의: value를 주면 controlled가 됨. 포트를 확인.'), []);
});

test('safetyCheck fails when the candidate drops a baseline safety sentence', () => {
  const baseline = '경고: 이 명령은 되돌릴 수 없음.';
  const candidate = '명령 실행함.'; // the warning sentence is gone
  const r = safetyCheck(baseline, candidate);
  assert.equal(r.pass, false);
  assert.ok(r.dropped[0].cats.includes('irreversible'));
});

test('safetyCheck passes when the warning survives a rephrase', () => {
  const baseline = '주의: 되돌릴 수 없는 삭제임.';
  const candidate = '주의 — 되돌릴 수 없는 삭제임. 먼저 백업.';
  assert.equal(safetyCheck(baseline, candidate).pass, true);
});

test('safetyCheck fails on a dropped warning even if an unrelated same-category word remains', () => {
  // Regression (critic CRITICAL): category-presence alone would falsely pass here.
  const baseline = 'rm -rf 는 되돌릴 수 없습니다.';
  const candidate = '설정을 초기화하면 됩니다.'; // 초기화 hits the irreversible category but is a different claim
  const r = safetyCheck(baseline, candidate);
  assert.equal(r.pass, false);
});

test('safetyCheck fails on a polarity flip (warning inverted, not preserved)', () => {
  // Regression (critic WARNING): bag-of-tokens would pass "없" → "있".
  assert.equal(safetyCheck('이 작업은 되돌릴 수 없습니다.', '되돌릴 수 있습니다.').pass, false);
  assert.equal(safetyCheck('This operation cannot be undone.', 'This can be undone.').pass, false);
});

test('safetyCheck passes a re-split + inflected KO warning (no false-fail)', () => {
  // Regression (reviewers WARNING): real KO compression re-splits and inflects.
  const baseline = '보안 위험: 자격 증명이 유출될 수 있으니 백업 후 진행하세요.';
  const candidate = '보안 위험 있음. 자격 증명 유출 가능. 백업 후 진행.';
  assert.equal(safetyCheck(baseline, candidate).pass, true);
});

test('safetyCheck catches an inverted warning even when an unrelated clause is negated', () => {
  // Regression (round-3): polarity is per-warning, not candidate-global, so an
  // unrelated negation elsewhere cannot mask the flip.
  assert.equal(
    safetyCheck('이 삭제는 되돌릴 수 없습니다.', '이 삭제는 되돌릴 수 있습니다. 부작용 없음.').pass,
    false
  );
  assert.equal(
    safetyCheck('This action cannot be undone.', 'This action can be undone. Do not worry.').pass,
    false
  );
});

test('safetyCheck does not count a prefix-colliding compound as coverage (보안→보안관)', () => {
  // Regression (round-3): inflection match must reject meaning-changing compounds.
  const baseline = '보안 주의: 키 유출 위험.';
  const candidate = '보안관 주의보 발령. 키보드 유출구 위험물.';
  assert.equal(safetyCheck(baseline, candidate).pass, false);
});

test('parseVerdict reads a JSON object (even fenced in prose)', () => {
  const reply =
    'My assessment:\n```json\n{"equivalent": false, "missing_claims": ["the retry caveat"], "score": 0.7}\n```';
  const v = parseVerdict(reply);
  assert.equal(v.equivalent, false);
  assert.equal(v.verdict, 'DIVERGENT');
  assert.deepEqual(v.missingClaims, ['the retry caveat']);
  assert.equal(v.score, 0.7);
});

test('parseVerdict falls back to a labeled line', () => {
  const v = parseVerdict('동등: 예\nscore: 0.95');
  assert.equal(v.equivalent, true);
  assert.equal(v.score, 0.95);
});

test('parseVerdict returns HOLD (never silently equivalent) on garbage', () => {
  const v = parseVerdict('I am not sure how to answer that.');
  assert.equal(v.equivalent, null);
  assert.equal(v.verdict, 'HOLD');
});

test('parseVerdict clamps an out-of-range score', () => {
  assert.equal(parseVerdict('{"equivalent": true, "score": 1.8}').score, 1);
  // -0.5 clamps to 0, which trips the equivalent-true-with-low-score contradiction
  // guard → HOLD, not EQUIVALENT.
  assert.equal(parseVerdict('{"equivalent": false, "score": -0.5}').score, 0);
});

test('parseVerdict takes the LAST verdict JSON when the judge restates the schema', () => {
  // Regression (critic CRITICAL a): first-JSON-wins would return EQUIVALENT here.
  const reply =
    'Schema example: {"equivalent": true, "score": 1.0}.\n' +
    'My verdict: the candidate dropped a claim.\n' +
    '{"equivalent": false, "score": 0.5}';
  const v = parseVerdict(reply);
  assert.equal(v.equivalent, false);
});

test('parseVerdict abstains (HOLD) on a negated labeled line', () => {
  // Regression (critic CRITICAL b): "not equivalent: yes" must not read as true.
  const v = parseVerdict('The answers are not equivalent: yes, a step was dropped.');
  assert.equal(v.equivalent, null);
  assert.equal(v.verdict, 'HOLD');
});

test('parseVerdict abstains on equivalent=true with a contradictory low score', () => {
  const v = parseVerdict('{"equivalent": true, "score": 0.3}');
  assert.equal(v.verdict, 'HOLD');
});

test('parseVerdict repairs a trailing comma / Python literal in the LAST verdict JSON', () => {
  // Regression (critic CRITICAL): a malformed last verdict must not fall back to the
  // earlier schema example (which would read EQUIVALENT). Repair → DIVERGENT.
  const trailingComma =
    'Schema: {"equivalent": true, "score": 1.0}.\nVerdict:\n{"equivalent": false, "score": 0.5,}';
  assert.equal(parseVerdict(trailingComma).equivalent, false);
  const pyLiteral = 'Example {"equivalent": true}. Final: {"equivalent": False}';
  assert.equal(parseVerdict(pyLiteral).equivalent, false);
});

test('parseVerdict abstains (HOLD) when the LAST verdict JSON is unrepairable — never reuses an earlier example', () => {
  // Single-quoted JSON is not coerced → HOLD, not the earlier {"equivalent": true}.
  const reply = "Schema: {\"equivalent\": true}. Verdict: {'equivalent': false}";
  assert.equal(parseVerdict(reply).verdict, 'HOLD');
});

test('parseVerdict reads a positive labeled line that merely contains 없음 ("누락 없음")', () => {
  // Regression (critic WARNING): the negation guard must not trip on 없 away from
  // the marker. "누락 없음" (no omissions) → equivalent.
  const v = parseVerdict('누락 없음. 동등: 예');
  assert.equal(v.equivalent, true);
});

test('scorePair strictPass gates on no-corruption AND safety AND equivalence (edit-surface gate)', () => {
  const baseline = 'Run `git push --force`. 경고: 되돌릴 수 없음. https://x.io/d';
  // candidate preserves code+url+safety (irreversible) and the judge ruled equivalent
  const good = scorePair(
    baseline,
    '`git push --force` — 경고: 되돌릴 수 없음. https://x.io/d',
    '{"equivalent": true, "score": 1.0}'
  );
  assert.equal(good.strictPass, true);

  // judge says equivalent but the irreversible warning was dropped → strict fails
  const unsafe = scorePair(
    baseline,
    '`git push --force`. https://x.io/d',
    '{"equivalent": true, "score": 1.0}'
  );
  assert.equal(unsafe.safety.pass, false);
  assert.equal(unsafe.strictPass, false);

  // no verdict supplied → equivalence unknown (null) → strictPass null
  const noJudge = scorePair(baseline, baseline);
  assert.equal(noJudge.byteExact.pass, true);
  assert.equal(noJudge.safety.pass, true);
  assert.equal(noJudge.strictPass, null);
});
