// test_global_default.js — global activation default (.scrooge-default):
// "type /scrooge once anywhere → every new session auto-activates; /scrooge off
// clears it globally, without yanking a concurrent peer session". Covers the
// resolveActiveState seed/precedence helper (unit) plus activation / off / new-
// session seeding end-to-end through the real activate + SessionStart hooks.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readState,
  writeState,
  resolveActiveState,
  readVersionMarker,
  writeVersionMarker,
  VALID_LANGS,
  VALID_DIALS,
} from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const ACTIVATE_HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');
const SESSION_START_HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-session-start.js');

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-gdef-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// The hooks read CLAUDE_CONFIG_DIR from their own subprocess env, so the test
// reads the resulting files by explicit path under configDir (not via the
// config helpers, which would resolve against the test process's env).
const defaultFile = (cfg) => path.join(cfg, '.scrooge', 'default');
const stateFile = (cfg, sid) => path.join(cfg, '.scrooge', 'sessions', sid);
const versionFile = (cfg) => path.join(cfg, '.scrooge', 'version');

// The installed version the SessionStart hook reads from package.json — kept
// dynamic so a version bump never breaks these assertions.
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version;

function runHook(hook, payload, configDir, env = {}) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_PLUGIN_ROOT: REPO_ROOT, SCROOGE_DEFAULT_FLAGS: '', ...env },
  });
  assert.equal(r.status, 0, `${path.basename(hook)} exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim()
    ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? null
    : null;
}

const runActivate = (cfg, prompt, sid = 'sessA', env = {}) =>
  runHook(ACTIVATE_HOOK, { prompt, session_id: sid }, cfg, env);
const runSessionStart = (cfg, sid) =>
  runHook(SESSION_START_HOOK, { session_id: sid }, cfg);

// ── Unit: resolveActiveState (precedence + seeding) ──────────────────────────

test('resolveActiveState: per-session state wins over the global default', () => {
  const cfg = freshConfig();
  const sp = stateFile(cfg, 'x');
  const dp = defaultFile(cfg);
  writeState({ lang: 'en', dial: 'full', flags: [] }, sp);
  writeState({ lang: 'ko', dial: 'full', flags: ['lean'] }, dp);
  assert.deepEqual(resolveActiveState(sp, dp), { lang: 'en', dial: 'full', flags: [] });
});

test('resolveActiveState: seeds the session file from the global default when absent', () => {
  const cfg = freshConfig();
  const sp = stateFile(cfg, 'y');
  const dp = defaultFile(cfg);
  writeState({ lang: 'ko', dial: 'full', flags: ['lean'] }, dp);
  assert.equal(readState(sp), null); // not seeded yet
  assert.deepEqual(resolveActiveState(sp, dp), { lang: 'ko', dial: 'full', flags: ['lean'] });
  assert.deepEqual(readState(sp), { lang: 'ko', dial: 'full', flags: ['lean'] }); // seeded
});

test('resolveActiveState: null when neither per-session state nor default exists', () => {
  const cfg = freshConfig();
  assert.equal(resolveActiveState(stateFile(cfg, 'z'), defaultFile(cfg)), null);
});

// ── Black-box: activation / off / new-session seeding through the hooks ───────

test('activation records the global default (lang/dial/flags)', () => {
  const cfg = freshConfig();
  runActivate(cfg, '/scrooge ko full lean');
  assert.deepEqual(readState(defaultFile(cfg)), { lang: 'ko', dial: 'full', flags: ['lean'] });
});

test('a brand-new session auto-activates from the global default (SessionStart seeds it)', () => {
  const cfg = freshConfig();
  runActivate(cfg, '/scrooge ko full', 'sessA'); // sets global default
  const ctx = runSessionStart(cfg, 'sessB'); // sessB never activated explicitly
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/); // full rule injected
  assert.deepEqual(readState(stateFile(cfg, 'sessB')), { lang: 'ko', dial: 'full', flags: [] });
});

test('/scrooge off is a GLOBAL off — clears the default so new sessions stay inactive', () => {
  const cfg = freshConfig();
  runActivate(cfg, '/scrooge ko full', 'sessA');
  assert.ok(readState(defaultFile(cfg))); // default present
  runActivate(cfg, '/scrooge off', 'sessA');
  assert.equal(readState(defaultFile(cfg)), null); // global default cleared
  assert.equal(readState(stateFile(cfg, 'sessA')), null);
  assert.equal(runSessionStart(cfg, 'sessC'), null); // new session no longer auto-activates
});

test('off does not yank a concurrent peer: the peer keeps its seeded state this run', () => {
  const cfg = freshConfig();
  runActivate(cfg, '/scrooge ko full', 'sessA'); // default = ko/full
  runSessionStart(cfg, 'sessB'); // sessB seeds ko/full from the default
  assert.deepEqual(readState(stateFile(cfg, 'sessB')), { lang: 'ko', dial: 'full', flags: [] });
  runActivate(cfg, '/scrooge off', 'sessA'); // global off + clears sessA only
  // peer sessB's per-session file is untouched (not clobbered mid-run)…
  assert.deepEqual(readState(stateFile(cfg, 'sessB')), { lang: 'ko', dial: 'full', flags: [] });
  // …but the shared default is gone, so sessB won't re-activate on its next restart.
  assert.equal(readState(defaultFile(cfg)), null);
});

test('default-aware activation: a change in a default-seeded session inherits the default lang/flags', () => {
  const cfg = freshConfig();
  runActivate(cfg, '/scrooge ko full lean', 'sessA'); // default = ko/full+lean
  // fresh sessB changes only the lang; dial(full) + flags(lean) come from the default.
  runActivate(cfg, '/scrooge en', 'sessB');
  assert.deepEqual(readState(stateFile(cfg, 'sessB')), { lang: 'en', dial: 'full', flags: ['lean'] });
});

test('no global default → a fresh session stays inactive (baseline unchanged)', () => {
  const cfg = freshConfig();
  assert.equal(runSessionStart(cfg, 'sessA'), null);
});

// ── Upgrade re-activation notice (SessionStart, version-marker gated) ─────────

test('upgrade + stranded prior activation (default present but unloadable) → notice', () => {
  const cfg = freshConfig();
  writeVersionMarker('0.0.0-old', versionFile(cfg)); // pretend a prior version
  // A default the current version can no longer load (simulating a schema-breaking
  // upgrade): the file exists — prior-activation evidence — but readState rejects it,
  // so the session is inactive yet genuinely stranded.
  fs.writeFileSync(defaultFile(cfg), JSON.stringify({ lang: 'xx', dial: 'yy' }));
  const ctx = runSessionStart(cfg, 'sessA');
  assert.match(ctx, /Scrooge was updated/);
  // Example command + both option lists are derived from VALID_LANGS/VALID_DIALS,
  // so a language or dial added later shows up with no edit to the hook — and a
  // retired dial (`lite`, removed in v0.23.0) can never be advertised as valid.
  assert.match(ctx, new RegExp(`/scrooge ${VALID_LANGS[0]} ${VALID_DIALS[0]}`));
  assert.match(ctx, /ko\/en\/ja/); // lists ja as a re-activation lang option (ja-register)
  assert.match(ctx, new RegExp(`dial ${VALID_DIALS.join('/')}\\)`));
  assert.doesNotMatch(ctx, /\blite\b/);
  assert.equal(readVersionMarker(versionFile(cfg)), PKG_VERSION); // marker advanced
});

test('upgrade + never-activated user (no activation artifact) → NO notice', () => {
  const cfg = freshConfig();
  writeVersionMarker('0.0.0-old', versionFile(cfg)); // marker from a prior session…
  const ctx = runSessionStart(cfg, 'sessA'); // …but no default + no state = never activated
  assert.equal(ctx, null); // do not nag a non-user
  assert.equal(readVersionMarker(versionFile(cfg)), PKG_VERSION); // marker still advanced
});

test('fresh install (no marker) → no notice, marker recorded', () => {
  const cfg = freshConfig();
  const ctx = runSessionStart(cfg, 'sessA');
  assert.equal(ctx, null); // nothing to re-activate
  assert.equal(readVersionMarker(versionFile(cfg)), PKG_VERSION);
});

test('same version (marker == installed) → no notice', () => {
  const cfg = freshConfig();
  writeVersionMarker(PKG_VERSION, versionFile(cfg));
  assert.equal(runSessionStart(cfg, 'sessA'), null);
});

test('upgrade but the session auto-activates from the default → full rule, not the notice', () => {
  const cfg = freshConfig();
  writeVersionMarker('0.0.0-old', versionFile(cfg));
  runActivate(cfg, '/scrooge ko full', 'sessA'); // sets the global default
  const ctx = runSessionStart(cfg, 'sessB'); // seeds from default → active
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/);
  assert.equal(/was updated/.test(ctx), false); // active users get no re-activate nag
  assert.equal(readVersionMarker(versionFile(cfg)), PKG_VERSION);
});

test('SessionStart injection header surfaces active flags (ko/full + lean)', () => {
  const cfg = freshConfig();
  writeState({ lang: 'ko', dial: 'full', flags: ['lean'] }, defaultFile(cfg));
  const ctx = runSessionStart(cfg, 'sessA'); // seeds → active ko/full+lean
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full \+ lean/); // confirmation names lean
});

test('upgrade + active session missing a now-default flag → auto-applied + FYI note', () => {
  const cfg = freshConfig();
  writeVersionMarker('0.0.0-old', versionFile(cfg));
  writeState({ lang: 'ko', dial: 'full', flags: [] }, defaultFile(cfg)); // stale default, no lean
  // Direct spawn with no SCROOGE_DEFAULT_FLAGS so defaultFlags() = ['lean'].
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
  delete env.SCROOGE_DEFAULT_FLAGS;
  const r = spawnSync(process.execPath, [SESSION_START_HOOK], {
    input: JSON.stringify({ session_id: 'sessA' }),
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full \+ lean/); // lean auto-applied to the injection
  assert.match(ctx, /lean is now ON by default and applied/); // FYI note (not "re-run")
  // …and persisted to BOTH the session state and the saved default:
  assert.deepEqual(readState(stateFile(cfg, 'sessA')), { lang: 'ko', dial: 'full', flags: ['lean'] });
  assert.deepEqual(readState(defaultFile(cfg)), { lang: 'ko', dial: 'full', flags: ['lean'] });
});
