// G-flags — lean flag axis: parsing, additive merge, env defaults,
// state validation, and registry fragment assembly.
//
// Covers spec Success Criteria 1-6 and 8. Unit tests hit the scrooge-config
// helpers and the exported assembleRuleBody directly; black-box tests drive the
// real activation hook in a subprocess against a temp $CLAUDE_CONFIG_DIR (same
// pattern as test_activate.js), so the flag axis is verified end-to-end through
// state persistence and fragment injection.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseFlagList,
  defaultFlags,
  isValidState,
  readState,
  writeState,
} from '../hooks/scrooge-config.js';
import { assembleRuleBody } from '../hooks/scrooge-activate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-flags-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Run the activation hook once with a fixed session id; returns { state, ctx }.
function runHook(configDir, prompt, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt, session_id: 'flags' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_PLUGIN_ROOT: REPO_ROOT, SCROOGE_DEFAULT_FLAGS: '', ...env },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  const ctx = r.stdout.trim()
    ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? null
    : null;
  return { state: readState(path.join(configDir, '.scrooge-active-flags')), ctx };
}

// ── Unit: parseFlagList / defaultFlags ──────────────────────────────────────

test('parseFlagList keeps whitelisted tokens, drops unknowns, dedups in order', () => {
  assert.deepEqual(parseFlagList('lean,bogus'), ['lean']); // unknown dropped
  assert.deepEqual(parseFlagList('ctx, lean'), ['lean']); // ctx removed → dropped as unknown
  assert.deepEqual(parseFlagList('lean,lean'), ['lean']); // dedup
  assert.deepEqual(parseFlagList(''), []);
  assert.deepEqual(parseFlagList(null), []);
});

test('defaultFlags: lean ON by default when unset, env overrides (incl. empty = off)', () => {
  const prev = process.env.SCROOGE_DEFAULT_FLAGS;
  try {
    delete process.env.SCROOGE_DEFAULT_FLAGS;
    assert.deepEqual(defaultFlags(), ['lean']); // unset → lean on
    process.env.SCROOGE_DEFAULT_FLAGS = '';
    assert.deepEqual(defaultFlags(), []); // explicit empty → opt out of all
    process.env.SCROOGE_DEFAULT_FLAGS = 'lean';
    assert.deepEqual(defaultFlags(), ['lean']); // explicit opt-in
    process.env.SCROOGE_DEFAULT_FLAGS = 'ctx,nope';
    assert.deepEqual(defaultFlags(), []); // all unknown (ctx removed) → empty
  } finally {
    if (prev === undefined) delete process.env.SCROOGE_DEFAULT_FLAGS;
    else process.env.SCROOGE_DEFAULT_FLAGS = prev;
  }
});

test('a fresh activation with no SCROOGE_DEFAULT_FLAGS turns lean ON', () => {
  const cfg = freshConfig();
  // Spawn directly (not the env-pinned helper) so the child sees no env override
  // and exercises the real on-by-default policy (lean on).
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
  delete env.SCROOGE_DEFAULT_FLAGS;
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt: '/scrooge ko', session_id: 'flags' }),
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  assert.deepEqual(readState(path.join(cfg, '.scrooge-active-flags')), {
    lang: 'ko',
    dial: 'full',
    flags: ['lean'],
  });
});

// ── Unit: state validation + round-trip ─────────────────────────────────────

test('isValidState accepts whitelisted flags, rejects unknown / non-array', () => {
  assert.equal(isValidState({ lang: 'ko', dial: 'full', flags: ['lean'] }), true);
  assert.equal(isValidState({ lang: 'ko', dial: 'full', flags: [] }), true);
  assert.equal(isValidState({ lang: 'ko', dial: 'full' }), true); // legacy: flags optional
  assert.equal(isValidState({ lang: 'ko', dial: 'full', flags: ['xss'] }), false);
  assert.equal(isValidState({ lang: 'ko', dial: 'full', flags: 'lean' }), false);
});

test('writeState/readState round-trip flags; legacy file normalizes to []', () => {
  const p = path.join(freshConfig(), 'state');
  assert.equal(writeState({ lang: 'ko', dial: 'full', flags: ['lean'] }, p), true);
  assert.deepEqual(readState(p), { lang: 'ko', dial: 'full', flags: ['lean'] });
  fs.writeFileSync(p, JSON.stringify({ lang: 'en', dial: 'lite' })); // legacy {lang,dial}
  assert.deepEqual(readState(p), { lang: 'en', dial: 'lite', flags: [] });
  fs.writeFileSync(p, JSON.stringify({ lang: 'en', dial: 'full', flags: ['xss'] }));
  assert.equal(readState(p), null); // a non-whitelist flag fails the whole state closed
});

// ── Unit: assembleRuleBody (registry fragment assembly + graceful skip) ──────

test('assembleRuleBody appends active fragments after the base register', () => {
  const body = assembleRuleBody(REPO_ROOT, 'ko', 'full', ['lean']);
  assert.match(body, /Auto-Clarity/); // base rule
  assert.match(body, /Flag: lean/);
  assert.equal(/Flag: ctx/.test(body), false); // ctx fragment removed
});

test('assembleRuleBody skips a fragment whose file is missing (graceful, no throw)', () => {
  const repo = freshConfig();
  fs.mkdirSync(path.join(repo, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rules', 'base.md'), '# Base\n\nBody text.');
  fs.writeFileSync(
    path.join(repo, 'registry.json'),
    JSON.stringify({ en: { full: 'rules/base.md' }, fragments: { en: { lean: 'rules/nope.md' } } })
  );
  const body = assembleRuleBody(repo, 'en', 'full', ['lean']);
  assert.match(body, /Body text\./); // base present
  assert.equal(/nope/.test(body), false); // missing fragment skipped
});

// ── Black-box: parsing + merge through the hook (SC1-4, 6) ───────────────────

test('SC1: /scrooge ko full lean records the flag and injects the lean fragment', () => {
  const { state, ctx } = runHook(freshConfig(), '/scrooge ko full lean');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: ['lean'] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/);
  assert.match(ctx, /Flag: lean/);
});

test('SC3: /scrooge nolean drops lean, keeps lang/dial', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko full lean');
  const { state } = runHook(cfg, '/scrooge nolean');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] });
});

test('flag-only /scrooge lean adds the flag without touching lang/dial', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko');
  const { state } = runHook(cfg, '/scrooge lean');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: ['lean'] });
});

test('SC4: an unknown token leaves flags (and lang/dial) unchanged', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko lean');
  const { state } = runHook(cfg, '/scrooge bogus');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: ['lean'] });
});

test('bare /scrooge resets flags to the env default (reset gesture)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko full lean');
  const { state } = runHook(cfg, '/scrooge');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] });
});

test('SC6: SCROOGE_DEFAULT_FLAGS seeds flags on a fresh activation', () => {
  const { state } = runHook(freshConfig(), '/scrooge ko', { SCROOGE_DEFAULT_FLAGS: 'lean' });
  assert.deepEqual(state.flags, ['lean']);
});

// The per-turn reminder carries each active flag's behavior hint, not just its
// bare name, so the flag's intent survives context drift after the activation
// turn's full fragment is compacted away.
test('the per-turn reminder carries each active flag behavior hint (ko)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko lean');
  const { ctx } = runHook(cfg, '이 함수 설명해줘');
  assert.match(ctx, /flag: lean\(최소 코드\) 활성/); // name + behavior anchor
});

test('the per-turn reminder carries the flag behavior hint (en)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge en lean');
  const { ctx } = runHook(cfg, 'explain this function');
  assert.match(ctx, /Flags: lean \(minimal code\) active/);
});
