// scrooge-activate.js — UserPromptSubmit hook contract (black-box).
//
// The hook runs on stdin→stdout with side effects (state file + injection), so
// we exercise the real binary in a subprocess against a temp $CLAUDE_CONFIG_DIR,
// rather than importing it (import would attach stdin listeners). CLAUDE_PLUGIN_ROOT
// points at the repo so the registry + rule files resolve for full injection.

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

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-cfg-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Run the hook once. Returns { state, ctx } — the persisted {lang,dial} (or
// null) and the injected additionalContext (or null when nothing was emitted).
function runHook(configDir, prompt) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  let ctx = null;
  if (r.stdout.trim()) {
    const j = JSON.parse(r.stdout);
    ctx = j.hookSpecificOutput ? j.hookSpecificOutput.additionalContext : null;
  }
  return { state: readState(path.join(configDir, '.scrooge-active')), ctx };
}

test('bare /scrooge on a fresh session activates en/full (G5 default)', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge');
  assert.deepEqual(state, { lang: 'en', dial: 'full' });
  assert.match(ctx, /SCROOGE MODE ACTIVE — en\/full/);
});

test('plugin-namespaced /scrooge:scrooge activates like the bare form', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge:scrooge ko');
  assert.deepEqual(state, { lang: 'ko', dial: 'full' });
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/);
});

test('plugin-namespaced /scrooge:scrooge off clears state', () => {
  const cfg = freshConfig();
  const activated = runHook(cfg, '/scrooge:scrooge ko');
  // Guard the regression directly: without the namespaced match the activation
  // is a no-op, so this assertion — not the null checks below — is what fails.
  assert.deepEqual(activated.state, { lang: 'ko', dial: 'full' });
  const { state, ctx } = runHook(cfg, '/scrooge:scrooge off');
  assert.equal(state, null);
  assert.equal(ctx, null);
});

test('bare /scrooge forces dial=full but keeps the current lang (G5)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge lite'); // → en/lite
  const { state } = runHook(cfg, '/scrooge'); // bare: dial→full, lang kept
  assert.deepEqual(state, { lang: 'en', dial: 'full' });
});

test('lang and dial are independent axes; unspecified axis is preserved', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko'); // lang→ko, dial kept (full default)
  let { state } = runHook(cfg, '/scrooge lite'); // dial→lite, lang kept
  assert.deepEqual(state, { lang: 'ko', dial: 'lite' });
});

test('token order does not matter', () => {
  const a = freshConfig();
  const b = freshConfig();
  const sa = runHook(a, '/scrooge ko lite').state;
  const sb = runHook(b, '/scrooge lite ko').state;
  assert.deepEqual(sa, { lang: 'ko', dial: 'lite' });
  assert.deepEqual(sb, { lang: 'ko', dial: 'lite' });
});

test('an unknown arg leaves state unchanged and reinjects a reminder', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko'); // → ko/full
  const { state, ctx } = runHook(cfg, '/scrooge bogus');
  assert.deepEqual(state, { lang: 'ko', dial: 'full' }); // no silent overwrite
  assert.match(ctx, /SCROOGE 활성 \(ko\/full\)/); // active mode reminded
});

test('a non-command turn reinjects the reminder while active (G2)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge'); // en/full active
  const { ctx } = runHook(cfg, 'explain this function for me');
  assert.match(ctx, /SCROOGE active \(en\/full\)/);
});

test('the reminder is localized for ko (G2)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko');
  const { ctx } = runHook(cfg, '이 코드 설명해줘');
  assert.match(ctx, /SCROOGE 활성 \(ko\/full\)/);
});

test('/scrooge off clears state and injects nothing', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge');
  const { state, ctx } = runHook(cfg, '/scrooge off');
  assert.equal(state, null);
  assert.equal(ctx, null);
});

test('an inactive session injects nothing on a plain prompt', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, 'just a normal question');
  assert.equal(state, null);
  assert.equal(ctx, null);
});
