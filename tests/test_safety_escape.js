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

import { readState } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry.json'), 'utf8'));

// Escape tokens each rule's Auto-Clarity section must name, per language.
const ESCAPE_TOKENS = {
  en: [/security/i, /irreversible/i],
  ko: [/보안/, /되돌릴 수 없/],
};

// Layer 1 — rule files carry the escape contract for every lang × dial.
for (const lang of ['ko', 'en']) {
  for (const dial of ['lite', 'full']) {
    test(`rule ${lang}/${dial} carries the Auto-Clarity escape section`, () => {
      const body = fs.readFileSync(path.join(REPO_ROOT, REGISTRY[lang][dial]), 'utf8');
      assert.match(body, /Auto-Clarity/, 'missing Auto-Clarity heading');
      for (const token of ESCAPE_TOKENS[lang]) {
        assert.match(body, token, `missing escape token ${token}`);
      }
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
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  // The full rule body should reach the model, and state should be active.
  assert.deepEqual(readState(path.join(cfg, '.scrooge-active')), expected);
  const j = JSON.parse(r.stdout);
  return j.hookSpecificOutput ? j.hookSpecificOutput.additionalContext : null;
}

test('en/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge en full', { lang: 'en', dial: 'full' });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.en) assert.match(ctx, token);
});

test('ko/full activation injects the Auto-Clarity escape clause (G7)', () => {
  const ctx = injectionFor('/scrooge ko full', { lang: 'ko', dial: 'full' });
  assert.match(ctx, /Auto-Clarity/);
  for (const token of ESCAPE_TOKENS.ko) assert.match(ctx, token);
});
