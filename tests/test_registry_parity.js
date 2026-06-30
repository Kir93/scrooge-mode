// Registry completeness + reachability guard (ja-register Task 3; parity retargeted
// in activation-dispatch-refactor Task 5 / Codex #1).
//
// VALID_LANGS now DERIVES from registry.json keys, so a "registry languages ==
// VALID_LANGS" assertion would be a tautology (both come from the same source) and
// no longer guards drift. The real, independent cross-check is registry ↔ LANG_META:
// LANG_META (hooks/lang-meta.js) is the hand-authored activation/UI/NL metadata table,
// not derived from the registry, so a registry language with no LANG_META row (or a
// LANG_META row with no registry entry) is a genuine bug — a language that would load
// its rule but have no reminder, countermand, or NL cues. Four invariants:
//   1. registry languages (excluding `fragments`) == LANG_META languages exactly, and
//      each registry language carries exactly VALID_DIALS — no missing/extra lang/dial.
//      (VALID_LANGS derives from the same registry keys, so this also guards
//      VALID_LANGS ↔ LANG_META.)
//   2. each LANG_META row carries the complete activation-metadata shape, so a typo'd
//      or half-filled row can't pass as a "valid" language.
//   3. every registry path (base rules + fragments) is under rules/ and real.
//   4. every rules/**/*.md file is reachable from the registry (no orphan rule).
// As languages grow, this auto-guards each new language's registry + metadata wiring —
// the gap the CONTRIBUTING "hardcoded ko/en loop" invariant used to cover by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_LANGS, VALID_DIALS } from '../hooks/scrooge-config.js';
import { LANG_META } from '../hooks/lang-meta.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry.json'), 'utf8'));

// Language keys = every top-level registry key except the `fragments` sub-tree.
const registryLangs = Object.keys(REGISTRY).filter((k) => k !== 'fragments');

test('registry languages match LANG_META languages exactly (no rule-only or meta-only lang)', () => {
  assert.deepEqual([...registryLangs].sort(), [...Object.keys(LANG_META)].sort());
});

test('each LANG_META row carries the complete activation-metadata shape', () => {
  for (const lang of Object.keys(LANG_META)) {
    const m = LANG_META[lang];
    const r = m.reminder;
    assert.ok(r && typeof r === 'object', `${lang}: missing reminder`);
    for (const key of ['head', 'modeClose', 'lite', 'full', 'suffix']) {
      assert.equal(typeof r[key], 'string', `${lang}: reminder.${key} not a string`);
    }
    assert.ok(r.flag && typeof r.flag === 'object', `${lang}: missing reminder.flag`);
    for (const key of ['prefix', 'sep', 'suffix']) {
      assert.equal(typeof r.flag[key], 'string', `${lang}: reminder.flag.${key} not a string`);
    }
    assert.equal(typeof m.countermand, 'string', `${lang}: countermand not a string`);
    assert.ok(m.flagHint && typeof m.flagHint === 'object', `${lang}: missing flagHint`);
    assert.ok(m.nlCue && typeof m.nlCue === 'object', `${lang}: missing nlCue`);
    for (const key of ['name', 'activate', 'off', 'negate', 'meta', 'strong']) {
      assert.ok(m.nlCue[key] instanceof RegExp, `${lang}: nlCue.${key} not a RegExp`);
    }
  }
});

test('every language carries exactly VALID_DIALS', () => {
  for (const lang of VALID_LANGS) {
    const dials = REGISTRY[lang];
    assert.ok(dials && typeof dials === 'object', `registry missing language: ${lang}`);
    for (const dial of VALID_DIALS) {
      assert.equal(typeof dials[dial], 'string', `registry ${lang} missing dial: ${dial}`);
    }
    assert.deepEqual(
      Object.keys(dials).sort(),
      [...VALID_DIALS].sort(),
      `registry ${lang} dial set mismatch`
    );
  }
});

test('every language has a fragments entry with the lean fragment', () => {
  assert.ok(REGISTRY.fragments && typeof REGISTRY.fragments === 'object', 'registry missing fragments');
  for (const lang of VALID_LANGS) {
    const frags = REGISTRY.fragments[lang];
    assert.ok(frags && typeof frags === 'object', `fragments missing language: ${lang}`);
    assert.equal(typeof frags.lean, 'string', `fragments ${lang} missing lean`);
  }
});

// Every registry-referenced path: base rules + fragment rules.
function registryPaths() {
  const paths = [];
  for (const lang of registryLangs) {
    for (const dial of Object.keys(REGISTRY[lang])) paths.push(REGISTRY[lang][dial]);
  }
  for (const lang of Object.keys(REGISTRY.fragments || {})) {
    for (const flag of Object.keys(REGISTRY.fragments[lang])) paths.push(REGISTRY.fragments[lang][flag]);
  }
  return paths;
}

test('every registry path is under rules/ and points at a real file', () => {
  for (const rel of registryPaths()) {
    assert.ok(String(rel).startsWith('rules/'), `path outside rules/: ${rel}`);
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(abs) && fs.statSync(abs).isFile(), `registry path missing: ${rel}`);
  }
});

test('every rules/**/*.md file is reachable from the registry', () => {
  const reachable = new Set(registryPaths().map((p) => path.normalize(p)));
  const listMd = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) return listMd(fp);
      return e.isFile() && e.name.endsWith('.md') ? [fp] : [];
    });
  for (const abs of listMd(path.join(REPO_ROOT, 'rules'))) {
    const rel = path.normalize(path.relative(REPO_ROOT, abs));
    assert.ok(reachable.has(rel), `unreachable rule file: ${rel}`);
  }
});
