// Golden-corpus deterministic fidelity check (runs under `npm test`, therefore CI).
//
// [F1 — scope, read this first] The golden corpus here is FROZEN committed text
// (docs/*-qa-checklist.md sample outputs + benchmarks/examples/* pairs). Because it is
// static, checks.js yields the SAME verdict before and after any `rules/**` edit — so
// this test is a tripwire on **checks.js's deterministic logic and the frozen
// fixtures**, NOT a live rule-text / register regression detector. Editing a rule file
// moves no number here. Catching an actual rule/register regression is the job of the
// CI rule-diff re-measurement marker + the manual LLM judge gate (RELEASE.md), not this
// test. See benchmarks/README.md "Fidelity bench" for the same scope statement.
//
// [F2 — safety] The shipped sample outputs do NOT trigger detectSafety (measured:
// ko/en Sample 3 and all five examples/ pairs yield detectSafety()=[] — the outputs
// phrase the warning as "되돌리기 어렵게" / "irreversibly", dodging the exact
// SAFETY_PATTERN tokens). A safety hard-gate over shipped text would therefore be
// VACUOUS, so the safety axis runs against a dedicated inline safety-positive fixture
// whose baseline really fires detectSafety (self-validated below), exercising
// safetyCheck's drop + polarity-flip detection for real.
//
// [weak proxy] The deterministic signals (byte-exact span preservation, safety-sentence
// preservation) are a WEAK PROXY for claim-preservation fidelity — they catch
// corruption/omission of code and warnings, not whether the compressed answer carries
// the same CLAIMS. That judgment is the LLM judge's (offline, subscription-gated,
// manual), never CI's.
//
// Uses checks.js public exports only — no new scorer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractSpans,
  byteExactCheck,
  detectSafety,
  safetyCheck,
} from '../benchmarks/fidelity/checks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// The section from `## Sample N` up to the next `## ` heading. Direct parse of the
// stable qa-checklist convention (`## Sample N` + Output fence). If the convention
// drifts the slice empties and the presence assertions below fail loudly — the guard
// against a silent 0-match pass; a tests/fixtures/ copy is the escape hatch if the
// heading convention ever proves too fragile.
function sampleSection(body, n) {
  const start = body.indexOf(`## Sample ${n}`);
  if (start === -1) return '';
  const after = body.indexOf('\n## ', start + 1);
  return body.slice(start, after === -1 ? undefined : after);
}

// (1a) breadth — extractSpans frozen expectation. Sample 4 (ko + en) shows a fetch
// timeout example; these identifiers must survive as preserved spans (inline or
// fenced). Tripwires checks.js span extraction AND the frozen sample text (F1: never
// rules/**). Union of inline + fenced text keeps the assertion robust to how a given
// identifier happens to be marked up.
for (const f of ['docs/ko-qa-checklist.md', 'docs/en-qa-checklist.md']) {
  test(`${f} Sample 4 preserves its code spans (extractSpans frozen expectation)`, () => {
    const sec = sampleSection(read(f), 4);
    assert.ok(sec.length > 0, `${f}: Sample 4 section not found — corpus heading convention drifted`);
    const spans = extractSpans(sec);
    const spanText = [...spans.inline, ...spans.fenced].join('\n');
    for (const id of ['AbortController', 'AbortError', 'fetch']) {
      assert.ok(spanText.includes(id), `${f}: Sample 4 span '${id}' not preserved by extractSpans`);
    }
  });
}

// (1b) breadth — byteExactCheck ADVISORY over the 5-lang examples/ pairs. These are
// INDEPENDENT generations (normal vs scrooge), so a candidate span absent from the
// baseline is usually a legitimate rephrase, not corruption (checks.js:133-139) — the
// foreach-async examples rewrite `for…of` as `Promise.all`, which byteExact flags. So
// this is advisory (D2 — hard-gate only on edit-relationship surfaces): the current
// per-lang corruption is baselined and only an INCREASE warns; it never fails the suite.
const EXAMPLE_PAIRS = [
  { lang: 'ko', base: 'ko-release-notes' },
  { lang: 'en', base: 'en-release-notes' },
  { lang: 'ja', base: 'ja-foreach-async' },
  { lang: 'hi', base: 'hi-foreach-async' },
  { lang: 'zh', base: 'zh-foreach-async' },
];
// Known independent-generation corruption floor (measured 2026-07): the foreach-async
// scrooge arms legitimately rephrase the loop, so byteExact reports these as "corrupted".
// Only a count ABOVE the floor warns — a possible new span regression or a checks.js
// logic change worth a human glance.
const BYTEEXACT_ADVISORY_FLOOR = { ko: 0, en: 0, ja: 1, hi: 3, zh: 3 };

test('examples/ pairs byteExact advisory — 5-lang corpus present, warn-on-increase', () => {
  assert.equal(EXAMPLE_PAIRS.length, 5, 'expected the 5-language examples corpus');
  for (const { lang, base } of EXAMPLE_PAIRS) {
    const normal = read(`benchmarks/examples/${base}.normal.md`);
    const scrooge = read(`benchmarks/examples/${base}.scrooge.md`);
    assert.ok(normal.trim().length > 0 && scrooge.trim().length > 0, `${lang}: example pair is empty`);
    const be = byteExactCheck(normal, scrooge);
    const floor = BYTEEXACT_ADVISORY_FLOOR[lang] ?? 0;
    if (be.corruptedCount > floor) {
      // advisory only — never fails the suite; surfaces a possible regression to glance at.
      console.warn(
        `[golden-corpus advisory] ${lang} byteExact corruption ${be.corruptedCount} > floor ${floor} — check benchmarks/examples/${base}.scrooge.md`
      );
    }
  }
});

// (2) safety (HARD, F2) — dedicated inline safety-positive fixture. The shipped sample
// outputs never fire detectSafety, so the hard gate lives here where it is not vacuous.
// The baseline carries a real SAFETY_PATTERN hit (irreversible + cannot be undone); the
// fixture self-validates that (a baseline that stops firing is itself a failure, so the
// gate can never silently go vacuous). safetyCheck must PASS a warning-preserving
// candidate and FAIL both a dropped warning and a polarity-inverted one.
const SAFETY_FIXTURE = {
  baseline: 'This deletion is irreversible and cannot be undone; back up first.',
  preserved: 'This deletion is irreversible and cannot be undone, so make a backup first.',
  dropped: 'This deletion is quick and frees disk space.',
  inverted: 'This deletion is reversible and can be undone safely.',
};

test('safety fixture self-validates — baseline fires detectSafety (F2 non-vacuity)', () => {
  assert.ok(
    detectSafety(SAFETY_FIXTURE.baseline).length > 0,
    'safety fixture baseline no longer triggers SAFETY_PATTERN — the hard gate would be vacuous'
  );
});

test('safety hard-gate — a warning-preserving candidate PASSes', () => {
  assert.equal(safetyCheck(SAFETY_FIXTURE.baseline, SAFETY_FIXTURE.preserved).pass, true);
});

test('safety hard-gate — a dropped warning FAILS', () => {
  assert.equal(safetyCheck(SAFETY_FIXTURE.baseline, SAFETY_FIXTURE.dropped).pass, false);
});

test('safety hard-gate — a polarity-inverted warning FAILS', () => {
  assert.equal(safetyCheck(SAFETY_FIXTURE.baseline, SAFETY_FIXTURE.inverted).pass, false);
});
