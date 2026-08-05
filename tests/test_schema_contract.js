// test_schema_contract.js — hook-input stdin schema contract (canary).
//
// The session-JSONL schema is pinned by exact-value canaries in
// test_session_log.js. This file closes the other undocumented, version-drifting
// host contract with zero prior coverage: the stdin payload the hooks read.
// scrooge-activate.js reads `data.prompt` and derives the session key from
// `data.session_id`/`data.transcript_path`; scrooge-session-start.js reads
// `data.source` and the same key fields. If a host renames one of those fields,
// activation silently no-ops (a renamed `prompt` → '' → no command; a renamed key
// field → wrong state file) — no crash, no loud failure. These are exact-value
// canaries, not structural "all four fields present" guards: the runtime treats
// session_id/transcript_path as interchangeable and prompt/source as optional, so
// a structural guard would false-fail a host that legitimately sends only one key
// field (over-modeling the real contract).
//
// CONTRACT (Claude Code, verified locally 2026-05/2026-06 — see lib/session-log.js
// header). If a host drifts these field names, refresh BOTH the fixtures
// (tests/fixtures/hook-input-*.json) AND the lib/session-log.js "Verified locally"
// date in the same change:
//   UserPromptSubmit stdin: { session_id, transcript_path, prompt }
//   SessionStart     stdin: { source, session_id, transcript_path }
// session_id ⇔ transcript_path (basename minus .jsonl) derive the SAME key; either
// alone suffices; neither → null → sessionless global fallback.
//
// The hooks run on stdin→stdout with side effects, so exercise the real binaries
// in a subprocess (import would attach stdin listeners). SCROOGE_NO_UPDATE_CHECK=1
// keeps the `source:'startup'` path from spawning the detached update-check process.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveSessionKey, readState, writeState } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const ACTIVATE_HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');
const SESSION_START_HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-session-start.js');

// The canonical stdin payloads for each hook. The derived session key is the same
// value for both (session_id and the transcript stem agree).
const ACTIVATE_PAYLOAD = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'hook-input-activate.json'), 'utf8')
);
const SESSION_START_PAYLOAD = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'hook-input-session-start.json'), 'utf8')
);
const EXPECTED_KEY = 'sess-contract-abc123';

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-contract-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const sessionStateFile = (cfg, key) => path.join(cfg, '.scrooge', 'sessions', key);
const globalStateFile = (cfg) => path.join(cfg, '.scrooge', 'global');
const defaultStateFile = (cfg) => path.join(cfg, '.scrooge', 'default');

function runHook(hook, payload, configDir) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_ROOT: REPO_ROOT,
      SCROOGE_DEFAULT_FLAGS: '',
      SCROOGE_NO_UPDATE_CHECK: '1',
    },
  });
  assert.equal(r.status, 0, `${path.basename(hook)} exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim()
    ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? null
    : null;
}

// ── session-key derivation (unit): the interchangeable-key contract ──────────

test('deriveSessionKey: session_id and transcript_path stem derive the same key', () => {
  assert.equal(deriveSessionKey(ACTIVATE_PAYLOAD), EXPECTED_KEY);
  // Either field alone yields the same key (host may send only one).
  assert.equal(deriveSessionKey({ session_id: ACTIVATE_PAYLOAD.session_id }), EXPECTED_KEY);
  assert.equal(deriveSessionKey({ transcript_path: ACTIVATE_PAYLOAD.transcript_path }), EXPECTED_KEY);
});

test('deriveSessionKey: neither field → null (sessionless global fallback)', () => {
  assert.equal(deriveSessionKey({}), null);
  assert.equal(deriveSessionKey({ prompt: '/scrooge ko full' }), null);
});

// ── activate hook (black-box): prompt + session_id field contract ────────────

test('activate: the documented payload activates and routes state to the derived session key', () => {
  const cfg = freshConfig();
  runHook(ACTIVATE_HOOK, ACTIVATE_PAYLOAD, cfg);
  // `data.prompt` (/scrooge en full) was parsed AND the key was derived from the
  // stdin fields — so the state lands at sessions/<derived key> with en/full.
  const state = readState(sessionStateFile(cfg, EXPECTED_KEY));
  assert.deepEqual(state, { lang: 'en', dial: 'full', flags: [] });
});

test('activate: a sessionless payload degrades to the global state file without throwing', () => {
  const cfg = freshConfig();
  // No session_id / transcript_path → null key → global fallback, no crash.
  runHook(ACTIVATE_HOOK, { prompt: '/scrooge ko full' }, cfg);
  assert.equal(readState(sessionStateFile(cfg, EXPECTED_KEY)), null);
  assert.deepEqual(readState(globalStateFile(cfg)), { lang: 'ko', dial: 'full', flags: [] });
});

// ── session-start hook (black-box): source + key field contract ──────────────

test('session-start: the startup payload seeds per-session state from the global default', () => {
  const cfg = freshConfig();
  // Prior global default (as if the user typed /scrooge once elsewhere).
  writeState({ lang: 'ja', dial: 'full', flags: [] }, defaultStateFile(cfg));
  const ctx = runHook(SESSION_START_HOOK, SESSION_START_PAYLOAD, cfg);
  // `data.source:'startup'` + key derivation ran → the new session seeded from the
  // default and re-injected the register (non-null context).
  assert.ok(ctx, 'expected a re-injection context on a seeded startup session');
  const seeded = readState(sessionStateFile(cfg, EXPECTED_KEY));
  assert.equal(seeded?.lang, 'ja');
  assert.equal(seeded?.dial, 'full');
});
