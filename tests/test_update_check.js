// Update-check — version compare, cache I/O, opt-out, and the SessionStart
// "update available" notice gate.
//
// Unit tests hit the scrooge-config helpers directly; black-box tests drive the
// real SessionStart hook in a subprocess against a temp $CLAUDE_CONFIG_DIR with a
// pre-seeded cache, verifying the notice is surfaced only on session startup, for
// a real user, once per version, and never under opt-out.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  semverGt,
  isUpdateCheckDisabled,
  readInstalledVersion,
  readUpdateCache,
  writeUpdateCache,
  writeState,
} from '../plugin/hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const SS_HOOK = path.join(REPO_ROOT, 'plugin', 'hooks', 'scrooge-session-start.js');

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-update-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── semverGt: the lexicographic-compare bug guard ────────────────────────────
test('semverGt compares release tuples numerically', () => {
  assert.equal(semverGt('0.18.0', '0.9.0'), true); // string compare would say false
  assert.equal(semverGt('1.0.0', '0.18.0'), true);
  assert.equal(semverGt('0.18.1', '0.18.0'), true);
  assert.equal(semverGt('0.18.0', '0.18.0'), false);
  assert.equal(semverGt('0.9.0', '0.18.0'), false);
  assert.equal(semverGt('1.0.0-rc.1', '1.0.0'), false); // prerelease == final
  assert.equal(semverGt('nope', '0.1.0'), false); // non-parseable → not newer
});

// ── cache I/O + sanitization ─────────────────────────────────────────────────
test('update cache roundtrips', () => {
  const p = path.join(freshConfig(), 'update');
  assert.equal(
    writeUpdateCache({ latest: '0.19.0', checkedAt: 123, behind: true, notifiedVersion: null }, p),
    true
  );
  const c = readUpdateCache(p);
  assert.deepEqual(c, { latest: '0.19.0', checkedAt: 123, behind: true, notifiedVersion: null });
});

test('readUpdateCache fails closed on corrupt or incomplete data', () => {
  const p = path.join(freshConfig(), 'update');
  fs.writeFileSync(p, 'not json');
  assert.equal(readUpdateCache(p), null);
  fs.writeFileSync(p, JSON.stringify({ latest: '0.19.0' })); // no checkedAt
  assert.equal(readUpdateCache(p), null);
});

test('cache sanitizes a tampered version string', () => {
  const p = path.join(freshConfig(), 'update');
  writeUpdateCache({ latest: '0.19.0; rm -rf ~', checkedAt: 1, behind: true }, p);
  const c = readUpdateCache(p);
  assert.equal(/[^0-9A-Za-z.\-+]/.test(c.latest || ''), false);
});

// ── opt-out / CI ─────────────────────────────────────────────────────────────
test('isUpdateCheckDisabled honors SCROOGE_NO_UPDATE_CHECK and CI', () => {
  const save = { CI: process.env.CI, NO: process.env.SCROOGE_NO_UPDATE_CHECK };
  delete process.env.CI;
  delete process.env.SCROOGE_NO_UPDATE_CHECK;
  assert.equal(isUpdateCheckDisabled(), false);
  process.env.SCROOGE_NO_UPDATE_CHECK = '1';
  assert.equal(isUpdateCheckDisabled(), true);
  delete process.env.SCROOGE_NO_UPDATE_CHECK;
  process.env.CI = 'true';
  assert.equal(isUpdateCheckDisabled(), true);
  if (save.CI === undefined) delete process.env.CI;
  else process.env.CI = save.CI;
  if (save.NO === undefined) delete process.env.SCROOGE_NO_UPDATE_CHECK;
  else process.env.SCROOGE_NO_UPDATE_CHECK = save.NO;
});

test('readInstalledVersion reads the manifest, null on missing', () => {
  assert.match(readInstalledVersion(path.join(REPO_ROOT, 'plugin')), /^\d+\.\d+\.\d+/);
  assert.equal(readInstalledVersion(path.join(os.tmpdir(), 'no-such-scrooge-root')), null);
});

// ── black-box: the SessionStart notice gate ──────────────────────────────────
// Seed an active session + a "behind" cache with a fresh checkedAt (so the hook's
// once-a-day background refresh is skipped and no network call fires).
function seed(dir, cacheOverrides = {}) {
  const statePath = path.join(dir, '.scrooge', 'sessions', 'upd');
  writeState({ lang: 'ko', dial: 'full', flags: ['lean'] }, statePath);
  writeUpdateCache(
    { latest: '99.0.0', checkedAt: Date.now(), behind: true, notifiedVersion: null, ...cacheOverrides },
    path.join(dir, '.scrooge', 'update')
  );
}

function runSessionStart(dir, source, extra = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'plugin') };
  delete env.CI;
  delete env.SCROOGE_NO_UPDATE_CHECK;
  Object.assign(env, extra);
  const r = spawnSync(process.execPath, [SS_HOOK], {
    input: JSON.stringify({ session_id: 'upd', source }),
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
}

test('notice appears on startup for an active user behind a release', () => {
  const dir = freshConfig();
  seed(dir);
  const ctx = runSessionStart(dir, 'startup');
  assert.match(ctx, /newer Scrooge is available \(v99\.0\.0\)/);
  assert.match(ctx, /npx -y github:Kir93\/scrooge-mode/);
  // once-per-version: the notice marked notifiedVersion, so a second startup is silent
  const ctx2 = runSessionStart(dir, 'startup');
  assert.doesNotMatch(ctx2, /newer Scrooge is available/);
});

test('notice is suppressed off session startup', () => {
  const dir = freshConfig();
  seed(dir);
  assert.doesNotMatch(runSessionStart(dir, 'resume'), /newer Scrooge is available/);
});

test('notice is suppressed under opt-out', () => {
  const dir = freshConfig();
  seed(dir);
  assert.doesNotMatch(
    runSessionStart(dir, 'startup', { SCROOGE_NO_UPDATE_CHECK: '1' }),
    /newer Scrooge is available/
  );
});

test('notice is suppressed when not behind', () => {
  const dir = freshConfig();
  seed(dir, { behind: false });
  assert.doesNotMatch(runSessionStart(dir, 'startup'), /newer Scrooge is available/);
});

// The statusline's ↑vX reads only `behind`. Once the user updates to (or past) the
// cached latest, the next session start must clear it, not wait for the daily probe.
test('session start clears a behind flag the installed version already satisfies', () => {
  const dir = freshConfig();
  const installed = readInstalledVersion(path.join(REPO_ROOT, 'plugin'));
  seed(dir, { latest: installed });
  runSessionStart(dir, 'resume');
  assert.equal(readUpdateCache(path.join(dir, '.scrooge', 'update')).behind, false);
});

test('session start keeps behind while a newer release is still pending', () => {
  const dir = freshConfig();
  seed(dir);
  runSessionStart(dir, 'resume');
  assert.equal(readUpdateCache(path.join(dir, '.scrooge', 'update')).behind, true);
});

// ── black-box: the detached probe itself ─────────────────────────────────────
// fetch is stubbed through a data: preload so the probe never touches the network.
const PROBE = path.join(REPO_ROOT, 'plugin', 'hooks', 'scrooge-update-check.js');
function runProbe(dir, fetchStub) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'plugin') };
  delete env.CI;
  delete env.SCROOGE_NO_UPDATE_CHECK;
  const preload = 'data:text/javascript,' + encodeURIComponent(`globalThis.fetch = ${fetchStub};`);
  const r = spawnSync(process.execPath, ['--import', preload, PROBE], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `probe exited ${r.status}: ${r.stderr}`);
  return readUpdateCache(path.join(dir, '.scrooge', 'update'));
}
const OFFLINE = "async () => { throw new Error('offline'); }";
const FORBIDDEN = 'async () => ({ ok: false, status: 403, json: async () => ({}) })';

// A failed probe that skips checkedAt leaves the once-a-day throttle disengaged,
// so every session start respawns it for as long as the failure lasts.
test('a failed probe stamps checkedAt and keeps the last known result', () => {
  const dir = freshConfig();
  const cachePath = path.join(dir, '.scrooge', 'update');
  writeUpdateCache({ latest: '99.0.0', checkedAt: 1, behind: true, notifiedVersion: '99.0.0' }, cachePath);
  const before = Date.now();
  const c = runProbe(dir, FORBIDDEN);
  assert.ok(c.checkedAt >= before, `checkedAt not refreshed: ${c.checkedAt}`);
  assert.deepEqual({ ...c, checkedAt: 0 }, { latest: '99.0.0', checkedAt: 0, behind: true, notifiedVersion: '99.0.0' });
});

test('a failed first probe (no prior cache) still writes checkedAt', () => {
  const dir = freshConfig();
  const before = Date.now();
  const c = runProbe(dir, OFFLINE);
  assert.ok(c && c.checkedAt >= before, 'no cache written on a failed first probe');
  assert.deepEqual({ ...c, checkedAt: 0 }, { latest: null, checkedAt: 0, behind: false, notifiedVersion: null });
});

test('a successful probe records latest/behind and keeps notifiedVersion', () => {
  const dir = freshConfig();
  writeUpdateCache({ latest: '1.0.0', checkedAt: 1, behind: false, notifiedVersion: '1.0.0' }, path.join(dir, '.scrooge', 'update'));
  const c = runProbe(dir, "async () => ({ ok: true, json: async () => ({ tag_name: 'v99.0.0' }) })");
  assert.equal(c.latest, '99.0.0');
  assert.equal(c.behind, true);
  assert.equal(c.notifiedVersion, '1.0.0');
});
