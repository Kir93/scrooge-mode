// unified-activation (#7): one canonical sessionKey, and one off deactivates the
// stateful surfaces — including the statusline — without leaving a stale number or
// yanking a concurrent session (invariant ④).
//
// Before this fix, /scrooge off cleared the register state and global default but
// NOT the statusline suffix, so the statusline kept rendering the last number after
// off (caveman's deactivation disease). off now clears the suffix too, but only
// when THIS session owns it (the suffix is global, tagged "<sessionKey>:<text>").

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveSessionKey } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-uni-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function runHook(configDir, prompt, sessionId = 'uni') {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt, session_id: sessionId }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_PLUGIN_ROOT: REPO_ROOT, SCROOGE_DEFAULT_FLAGS: '' },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  return r;
}

// ── single canonical sessionKey ─────────────────────────────────────────────

test('deriveSessionKey is canonical: session_id and the transcript stem agree', () => {
  // Every surface derives the key through this one function — the same value the
  // activation hook writes state under and the statusline tags its suffix with.
  assert.equal(deriveSessionKey({ session_id: 'abc' }), 'abc');
  assert.equal(deriveSessionKey({ transcript_path: '/x/y/abc.jsonl' }), 'abc');
});

// ── one off deactivates the statusline surface too ──────────────────────────

test('off clears this session’s statusline suffix (no stale number after off)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko full'); // activate (sessionKey 'uni')
  const suffixPath = path.join(cfg, '.scrooge-statusline-suffix');
  fs.writeFileSync(suffixPath, 'uni:KO·full ~21%'); // statusline wrote a number for this session
  runHook(cfg, '/scrooge off');
  assert.equal(fs.readFileSync(suffixPath, 'utf8'), '', 'suffix not cleared on off');
});

test('off does NOT clear a peer session’s statusline suffix (non-interference)', () => {
  const cfg = freshConfig();
  const suffixPath = path.join(cfg, '.scrooge-statusline-suffix');
  fs.writeFileSync(suffixPath, 'peer:KO·full ~21%'); // a different session owns the suffix
  runHook(cfg, '/scrooge off', 'uni'); // off in session 'uni'
  assert.equal(fs.readFileSync(suffixPath, 'utf8'), 'peer:KO·full ~21%', 'peer suffix was yanked');
});
