// Registry completeness + reachability guard (ja-register Task 3).
//
// Before this, no test verified that registry.json stays in lockstep with
// VALID_LANGS/VALID_DIALS or that every rule file is wired in. Three invariants:
//   1. registry languages (excluding the `fragments` sub-tree) == VALID_LANGS,
//      and each language carries exactly VALID_DIALS — no missing/extra lang/dial.
//   2. every registry path (base rules + fragments) is under rules/ and real.
//   3. every rules/**/*.md file is reachable from the registry (no orphan rule).
// As VALID_LANGS grows, this auto-guards each new language's registry wiring —
// the gap the CONTRIBUTING "hardcoded ko/en loop" invariant used to cover by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_LANGS, VALID_DIALS } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry.json'), 'utf8'));

// Language keys = every top-level registry key except the `fragments` sub-tree.
const registryLangs = Object.keys(REGISTRY).filter((k) => k !== 'fragments');

test('registry languages match VALID_LANGS exactly', () => {
  assert.deepEqual([...registryLangs].sort(), [...VALID_LANGS].sort());
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
