// G7 — safety escape (Auto-Clarity) coverage.
//
// A deterministic unit test cannot run a live model, so it cannot assert the
// model's prose directly. What it CAN assert is that the escape contract
// reaches the model context, in two layers:
//   1. every dial's rule file carries the Auto-Clarity escape section, and
//   2. activating full injects that section verbatim into additionalContext.
// Representative trigger prompts live in fixtures/security-prompts.txt.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readState, VALID_LANGS } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry.json'), 'utf8'));

// Escape tokens each rule's Auto-Clarity section must name, per language.
const ESCAPE_TOKENS = {
  en: [/security/i, /irreversible/i],
  ko: [/보안/, /되돌릴 수 없/],
  ja: [/セキュリティ/, /取り消せない/],
  hi: [/सुरक्षा/, /अपरिवर्तनीय/],
  zh: [/安全/, /不可逆/],
};

// Layer 1 — rule files carry the escape contract for every lang × dial. The loop is
// registry-derived (VALID_LANGS) so a newly registered language is covered with no
// edit here; the per-lang ESCAPE_TOKENS map is inherently hand-maintained data, so a
// registry lang missing from it fails clearly (assert) instead of crashing on an
// undefined-not-iterable — surfacing "this new lang needs escape tokens", not a stack.
for (const lang of VALID_LANGS) {
  for (const dial of ['lite', 'full']) {
    test(`rule ${lang}/${dial} carries the Auto-Clarity escape section`, () => {
      const tokens = ESCAPE_TOKENS[lang];
      assert.ok(tokens, `no ESCAPE_TOKENS entry for '${lang}' — add its escape tokens to the per-lang map`);
      const body = fs.readFileSync(path.join(REPO_ROOT, REGISTRY[lang][dial]), 'utf8');
      assert.match(body, /Auto-Clarity/, 'missing Auto-Clarity heading');
      for (const token of tokens) {
        assert.match(body, token, `missing escape token ${token}`);
      }
    });
  }
}

// Layer 1b — flag fragments carry the safety register too: every injected
// surface must keep security / irreversible actions in normal prose (invariant
// that holds across output, fragments, and any future surface).
const FRAGMENT_SAFETY = { en: /security/i, ko: /보안/, ja: /セキュリティ/, hi: /सुरक्षा/, zh: /安全/ };
for (const lang of VALID_LANGS) {
  for (const flag of ['lean']) {
    test(`fragment ${lang}/${flag} carries the safety register`, () => {
      // Guard the hand-maintained lookups so a registry lang without a fragment entry
      // or a FRAGMENT_SAFETY pattern fails clearly rather than crashing. Whether a lang
      // MUST ship a lean fragment is an out-of-scope contract question (Task 2 §5) — this
      // only converts the crash into a legible failure; it does not mandate the fragment.
      const frag = REGISTRY.fragments[lang] && REGISTRY.fragments[lang][flag];
      assert.ok(frag, `no '${flag}' fragment registered for '${lang}' in registry.json fragments`);
      const safety = FRAGMENT_SAFETY[lang];
      assert.ok(safety, `no FRAGMENT_SAFETY entry for '${lang}' — add its safety-register pattern`);
      const body = fs.readFileSync(path.join(REPO_ROOT, frag), 'utf8');
      assert.match(body, safety, `${lang}/${flag} missing safety register`);
    });
  }
}

// Layer 2 — activating full injects the escape contract into the model context.
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Activate `prompt`, assert it persisted exactly `expected`, return the injected
// additionalContext. expected is passed explicitly (not parsed from the prompt)
// so the assertion does not depend on substring heuristics.
function injectionFor(prompt, expected) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-g7-'));
  tmpDirs.push(cfg);
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: REPO_ROOT, SCROOGE_DEFAULT_FLAGS: '' },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  // The full rule body should reach the model, and state should be active.
  assert.deepEqual(readState(path.join(cfg, '.scrooge', 'global')), expected);
  const j = JSON.parse(r.stdout);
  return j.hookSpecificOutput ? j.hookSpecificOutput.additionalContext : null;
}

test('en/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge en full', { lang: 'en', dial: 'full', flags: [] });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.en) assert.match(ctx, token);
});

test('ko/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge ko full', { lang: 'ko', dial: 'full', flags: [] });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.ko) assert.match(ctx, token);
});

test('ja/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge ja full', { lang: 'ja', dial: 'full', flags: [] });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.ja) assert.match(ctx, token);
});

test('hi/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge hi full', { lang: 'hi', dial: 'full', flags: [] });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.hi) assert.match(ctx, token);
});

test('zh/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge zh full', { lang: 'zh', dial: 'full', flags: [] });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.zh) assert.match(ctx, token);
});
