// context-audit deterministic detectors — canary.
//
// Covers Task 2 (detectors): determinism (bit-identical re-run), protected-span
// masking (removable 0), F2 guard modeling (a duplicate block whose removal drops a
// protected span's count counts 0), and recall against the labeled synthetic
// corpus. No model calls — the whole detection core is deterministic and zero-dep.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCorpus, loadLabels, maskedSaving, byteLen } from '../benchmarks/context-audit/lib.js';
import {
  detectAll,
  detectDuplicates,
  detectDeadLetter,
  detectLowDensity,
} from '../benchmarks/context-audit/detectors.js';
import {
  analyzeFile,
  decideVerdict,
  buildReport,
  thresholds,
} from '../benchmarks/context-audit/run.js';

const { files } = loadCorpus();
const byId = (id) => files.find((f) => f.id === id);

test('detectAll is deterministic (bit-identical re-run)', () => {
  for (const id of ['syn-loose', 'syn-medium']) {
    const f = byId(id);
    assert.equal(JSON.stringify(detectAll(f)), JSON.stringify(detectAll(f)));
  }
});

test('maskedSaving excludes protected spans (protected bytes count 0)', () => {
  const text = 'run `scripts/deploy.sh --force` now';
  const full = maskedSaving(text, 0, text.length);
  // the inline-code span is protected -> its bytes are not removable
  assert.ok(full.bytes < byteLen(text));
  assert.ok(!full.text.includes('scripts/deploy.sh'));

  // a region that is ENTIRELY a protected inline-code span -> removable 0
  const only = '`lib/x.js`';
  const m = maskedSaving(only, 0, only.length);
  assert.equal(m.bytes, 0);
  assert.equal(m.tokens, 0);
});

test('F2: duplicate block with a protected span is guard-REJECTed (removable 0)', () => {
  // The block appears twice and holds a protected inline-code span whose count
  // drops N->N-1 on removal -> verifyPreservation REJECT -> whole block counts 0.
  const text = [
    'Intro line one here.',
    '',
    'Run `scripts/deploy.sh --force` to ship it and then verify the health.',
    '',
    'Run `scripts/deploy.sh --force` to ship it and then verify the health.',
  ].join('\n');
  const dups = detectDuplicates({ path: 'x', text }, { dupMode: 'exact' });
  assert.equal(dups.length, 1);
  assert.equal(dups[0].guardRejected, true);
  assert.equal(dups[0].removableBytes, 0);
});

test('F2: pure-prose duplicate block passes the guard (removable > 0)', () => {
  const text = [
    'Keep each change small so reviews stay quick and focused.',
    '',
    'Keep each change small so reviews stay quick and focused.',
  ].join('\n');
  const dups = detectDuplicates({ path: 'x', text }, { dupMode: 'exact' });
  assert.equal(dups.length, 1);
  assert.equal(dups[0].guardRejected, false);
  assert.ok(dups[0].removableBytes > 0);
});

test('broken-path dead-letter fires only for a non-existent path', () => {
  const text = 'See `lib/memory-compress.js` (real) and `docs/gone/NOPE.md` (missing).';
  const deads = detectDeadLetter({ path: 'x', abs: null, text });
  const refs = deads.filter((d) => d.kind === 'broken-path').map((d) => d.ref);
  assert.deepEqual(refs, ['docs/gone/NOPE.md']);
});

test('stale-marker fires on TBD placeholder + until X lands, but not meta "markers" or bare "pending"', () => {
  const text = 'This is a TBD item.\nStill pending review.\nHold until the infra lands.';
  const marks = detectDeadLetter({ path: 'x', abs: null, text }).filter((d) => d.kind === 'stale-marker');
  // TBD + "until ... lands" = 2. Bare "pending review" is intentionally NOT a marker
  // (too loose on real prose; the genuine stale case is caught by the until-lands arm).
  assert.equal(marks.length, 2);

  // meta-discussion of markers is excluded (precision guard against real-doc FPs)
  const meta = detectDeadLetter({ path: 'x', abs: null, text: 'skeletons and "TBD — Task N" markers are scaffolding, not gaps.' });
  assert.equal(meta.filter((d) => d.kind === 'stale-marker').length, 0);
});

test('low-density fires per paragraph on filler density', () => {
  const text = 'Basically you just simply run it, honestly.\n\nRun the build.';
  const low = detectLowDensity({ path: 'x', text });
  assert.equal(low.length, 1);
  assert.ok(low[0].fillerCount >= 2);
});

test('recall: every labeled instance is flagged at its anchor', () => {
  const labels = loadLabels();
  for (const id of ['syn-loose', 'syn-medium']) {
    const f = byId(id);
    const findings = detectAll(f);
    for (const l of labels.filter((x) => x.file === f.path)) {
      const hit = findings.some((fd) => fd.category === l.category && fd.spanText.includes(l.anchor));
      assert.ok(hit, `label not caught: ${l.file} ${l.category} :: ${l.anchor}`);
    }
  }
});

test('every label anchor exists in its referenced corpus file', () => {
  const labels = loadLabels();
  for (const l of labels) {
    const f = files.find((x) => x.path === l.file);
    assert.ok(f, `label file not in corpus: ${l.file}`);
    assert.ok(f.text.includes(l.anchor), `anchor missing in ${l.file}: ${l.anchor}`);
  }
});

// ---- Task 3: runner / verdict logic (deterministic, no live self-repo dependency)

const T = thresholds({});

test('analyzeFile: structural saving excludes low-density (dup+dead only)', () => {
  const text = [
    'Keep changes small so reviews stay quick and focused here.',
    '',
    'Keep changes small so reviews stay quick and focused here.',
    '',
    'Basically you just simply run it, honestly, at some point.',
  ].join('\n');
  const a = analyzeFile({ id: 'x', path: 'x', source: 'synthetic', labeled: true, text });
  assert.ok(a.structuralTokens > 0, 'dup contributes to structural');
  assert.ok(a.grossTokens > a.structuralTokens, 'low-density is in gross but not structural');
});

test('decideVerdict: GO / NO-GO / regime-divergence WEAK / WITHHELD', () => {
  const go = decideVerdict({ medianPct: 12, syntheticMedianPct: 12, selfRepoMedianPct: 10 }, 1, true, T);
  assert.equal(go.verdict, 'GO');

  const kill = decideVerdict({ medianPct: 1, syntheticMedianPct: 1, selfRepoMedianPct: 1 }, 1, true, T);
  assert.equal(kill.verdict, 'NO-GO');

  // synthetic clears GO but dogfood-tight self is in the kill zone -> inconclusive
  const diverge = decideVerdict({ medianPct: 0, syntheticMedianPct: 28, selfRepoMedianPct: 0 }, 1, true, T);
  assert.equal(diverge.verdict, 'WEAK');
  assert.match(diverge.reason, /Open Q1|regime/i);

  const withheld = decideVerdict({ medianPct: 12, syntheticMedianPct: 12, selfRepoMedianPct: 10 }, 1, true, thresholds({ CA_VERDICT: 'off' }));
  assert.equal(withheld.verdict, 'WITHHELD');
});

test('buildReport: stable invariants hold regardless of live self-repo drift', () => {
  const r = buildReport({});
  assert.ok(['GO', 'NO-GO', 'WEAK', 'WITHHELD'].includes(r.verdict));
  // synthetic labels are clean by construction -> recall/precision stable
  assert.equal(r.scoring.per.dup.recall, 1);
  assert.equal(r.scoring.per.dead.recall, 1);
  assert.equal(r.scoring.structuralPrecision, 1);
  // floor pair is committed + deterministic
  assert.equal(typeof r.floor.savingPct, 'number');
  assert.ok(r.marginal.syntheticMedianPct > 0);
});
