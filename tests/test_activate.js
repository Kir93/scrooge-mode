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

import { readState } from '../plugin/hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const HOOK = path.join(REPO_ROOT, 'plugin', 'hooks', 'scrooge-activate.js');
const SESSION_FIXTURE = path.join(HERE, 'fixtures', 'sample-session.jsonl');

// Hook-written session state now carries activatedAt (epoch ms, S3-4); register
// assertions compare lang/dial/flags only, and activatedAt is pinned separately.
function reg(s) {
  if (!s) return s;
  const { activatedAt: _at, ...rest } = s;
  return rest;
}

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-cfg-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// A minimal Codex-format session log. The Claude fixture above can't be reused
// for codex-agent runs because scrooge-stats.js parses it as Codex and finds no
// turns; token-count accuracy itself is covered by test_session_log.js, so here
// we only need a log that yields a real report.
function makeCodexSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-stats-codex-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'codex-session.jsonl');
  const usage = (output, total) => ({
    input_tokens: 1000,
    cached_input_tokens: 100,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: total,
  });
  const lines = [
    { timestamp: '2026-06-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'codex-fixture', model: 'gpt-5-codex' } },
    { timestamp: '2026-06-01T00:00:01.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage(300, 1300), total_token_usage: usage(300, 1300) } } },
    { timestamp: '2026-06-01T00:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage(120, 920), total_token_usage: usage(420, 2220) } } },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

// Run the hook once. Returns { state, ctx } — the persisted {lang,dial,flags}
// (or null) and the injected additionalContext (or null when nothing was emitted).
function runHook(configDir, prompt, extra = {}, envOverrides = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt, ...extra }),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'plugin'),
      // Pin flags off here so lang/dial mechanics stay deterministic regardless of
      // the on-by-default flag policy; default-on is covered by test_flags.js.
      SCROOGE_DEFAULT_FLAGS: '',
      ...envOverrides,
    },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  let ctx = null;
  let result = null;
  if (r.stdout.trim()) {
    result = JSON.parse(r.stdout);
    ctx = result.hookSpecificOutput ? result.hookSpecificOutput.additionalContext : null;
  }
  return { state: reg(readState(path.join(configDir, '.scrooge', 'global'))), ctx, result };
}

test('bare /scrooge on a fresh session activates en/full (G5 default)', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge');
  assert.deepEqual(state, { lang: 'en', dial: 'full', flags: [] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — en\/full/);
});

test('plugin-namespaced /scrooge:scrooge activates like the bare form', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge:scrooge ko');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/);
});

test('plugin-namespaced /scrooge:scrooge off clears state', () => {
  const cfg = freshConfig();
  const activated = runHook(cfg, '/scrooge:scrooge ko');
  // Guard the regression directly: without the namespaced match the activation
  // is a no-op, so this assertion — not the null checks below — is what fails.
  assert.deepEqual(activated.state, { lang: 'ko', dial: 'full', flags: [] });
  const { state, ctx } = runHook(cfg, '/scrooge:scrooge off');
  assert.equal(state, null);
  // Off on an active session injects a countermand (Task 5) instead of nothing.
  assert.match(ctx, /SCROOGE OFF/);
});

// Codex surfaces the hook's block reason, so the stats trigger is intercepted
// there. CODEX_ENV forces the agent regardless of the test runner's own config.
const CODEX_ENV = { SCROOGE_AGENT: 'codex' };

test('Codex intercepts /scrooge-stats and returns the measured hook report', () => {
  const cfg = freshConfig();
  const { result } = runHook(cfg, '/scrooge-stats', { transcript_path: makeCodexSession() }, CODEX_ENV);

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Scrooge Stats/);
  assert.match(result.reason, /Output tokens:/);
});

// Codex names its transcript `rollout-<timestamp>-<session_id>.jsonl`, so the
// transcript stem is NOT the session_id the activation keyed its state under.
test('Codex /scrooge-stats reads the state the activation wrote (session_id, not transcript stem)', () => {
  const cfg = freshConfig();
  const sid = '01a0f02f-bf9f-7553-bf28-400074c5bf1e';
  const src = makeCodexSession();
  const transcript = path.join(path.dirname(src), `rollout-2026-09-30T11-40-56-${sid}.jsonl`);
  fs.renameSync(src, transcript);
  runHook(cfg, '/scrooge ko', { session_id: sid, transcript_path: transcript }, CODEX_ENV);
  const { result } = runHook(cfg, '/scrooge-stats', { session_id: sid, transcript_path: transcript }, CODEX_ENV);

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /ko\/full/);
  assert.doesNotMatch(result.reason, /inactive/);
});

test('Codex intercepts the $scrooge-stats skill trigger like the slash command', () => {
  const cfg = freshConfig();
  const { result } = runHook(cfg, '$scrooge-stats', { transcript_path: makeCodexSession() }, CODEX_ENV);

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Scrooge Stats/);
});

test('Codex intercepts the markdown skill link for scrooge-stats', () => {
  const cfg = freshConfig();
  const { result } = runHook(
    cfg,
    '[$scrooge-stats](/Users/crhan/.agents/skills/scrooge-stats/SKILL.md)',
    { transcript_path: makeCodexSession() },
    CODEX_ENV
  );

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Scrooge Stats/);
});

test('Codex skill-link stats trigger supports --share', () => {
  const cfg = freshConfig();
  const { result } = runHook(
    cfg,
    '[$scrooge-stats](/Users/crhan/.agents/skills/scrooge-stats/SKILL.md) --share',
    { transcript_path: makeCodexSession() },
    CODEX_ENV
  );

  assert.equal(result.decision, 'block');
  // --share yields the one-line summary, not the full block.
  assert.match(result.reason, /output tokens this session/);
});

test('Claude does not intercept /scrooge-stats — the skill surfaces the figures', () => {
  const cfg = freshConfig();
  // Real Claude Code carries the same session_id on every turn; pass it on both
  // so the activation and the fall-through reminder resolve the same state file.
  const sid = 'sess-stats';
  runHook(cfg, '/scrooge ko', { session_id: sid }); // active mode so a fall-through turn reminds
  const { result, ctx } = runHook(cfg, '/scrooge-stats', { session_id: sid, transcript_path: SESSION_FIXTURE });

  // No block: the prompt passes through to the registered skill instead, which
  // runs the stats script and prints a normal, user-visible message.
  assert.notEqual(result?.decision, 'block');
  // Falls through to the active-mode reminder branch (not the stats intercept).
  assert.match(ctx, /SCROOGE 활성 \(ko\/full\)/);
});

test('bare /scrooge forces dial=full but keeps the current lang (G5)', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge en'); // → en/full
  const { state } = runHook(cfg, '/scrooge'); // bare: dial→full, lang kept
  assert.deepEqual(state, { lang: 'en', dial: 'full', flags: [] });
});

test('lang and dial are independent axes; unspecified axis is preserved', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko'); // lang→ko, dial kept (full default)
  let { state } = runHook(cfg, '/scrooge full'); // dial→full, lang kept
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] });
  // Only one dial ships since v0.23.0, so the axes are exercised through the
  // flag axis too: a flag token must not disturb the lang.
  ({ state } = runHook(cfg, '/scrooge nolean'));
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] });
});

test('token order does not matter', () => {
  const a = freshConfig();
  const b = freshConfig();
  const sa = runHook(a, '/scrooge ko full').state;
  const sb = runHook(b, '/scrooge full ko').state;
  assert.deepEqual(sa, { lang: 'ko', dial: 'full', flags: [] });
  assert.deepEqual(sb, { lang: 'ko', dial: 'full', flags: [] });
});

test('a retired dial token migrates instead of failing the state closed', () => {
  // `lite` was removed in v0.23.0. A saved state naming it must keep working:
  // rejecting it would silently deactivate a user whose global default said lite,
  // which reads as the tool breaking rather than as a dial being retired.
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko full', { session_id: 'sessMig' });
  const sp = statePathFor(cfg, 'sessMig');
  fs.writeFileSync(sp, JSON.stringify({ lang: 'ko', dial: 'lite', flags: ['lean'] }));
  assert.deepEqual(readState(sp), { lang: 'ko', dial: 'full', flags: ['lean'] });
});

test('an unknown arg leaves state unchanged and reinjects a reminder', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko'); // → ko/full
  const { state, ctx } = runHook(cfg, '/scrooge bogus');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] }); // no silent overwrite
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

test('/scrooge ja full activates and injects the full ja rule', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge ja full');
  assert.deepEqual(state, { lang: 'ja', dial: 'full', flags: [] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — ja\/full/);
});

test('the reminder is localized for ja', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ja');
  const { ctx } = runHook(cfg, 'この関数を説明して');
  assert.match(ctx, /SCROOGE 活性 \(ja\/full\)/);
});

test('/scrooge hi full activates and injects the full hi rule', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge hi full');
  assert.deepEqual(state, { lang: 'hi', dial: 'full', flags: [] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — hi\/full/);
});

test('the reminder is localized for hi', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge hi');
  const { ctx } = runHook(cfg, 'इस function को समझाओ');
  assert.match(ctx, /SCROOGE सक्रिय \(hi\/full\)/);
});

test('/scrooge zh full activates and injects the full zh rule', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '/scrooge zh full');
  assert.deepEqual(state, { lang: 'zh', dial: 'full', flags: [] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — zh\/full/);
});

test('the reminder is localized for zh', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge zh');
  const { ctx } = runHook(cfg, '解释一下这个 function');
  assert.match(ctx, /SCROOGE 已激活 \(zh\/full\)/);
});

test('/scrooge off clears state and injects a countermand', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge');
  const { state, ctx } = runHook(cfg, '/scrooge off');
  assert.equal(state, null);
  assert.match(ctx, /SCROOGE OFF/); // active → countermand (Task 5)
});

test('an inactive session injects nothing on a plain prompt', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, 'just a normal question');
  assert.equal(state, null);
  assert.equal(ctx, null);
});

// Session-scope (Task 5): each session keeps its own state file, so an off in
// one session never clears another's. session_id rides in the hook payload.
function statePathFor(configDir, sid) {
  return sid
    ? path.join(configDir, '.scrooge', 'sessions', sid)
    : path.join(configDir, '.scrooge', 'global');
}

test('session-scope: /scrooge off in one session does not clear another', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko', { session_id: 'sessA' });
  runHook(cfg, '/scrooge en', { session_id: 'sessB' });
  assert.deepEqual(reg(readState(statePathFor(cfg, 'sessA'))), { lang: 'ko', dial: 'full', flags: [] });
  assert.deepEqual(reg(readState(statePathFor(cfg, 'sessB'))), { lang: 'en', dial: 'full', flags: [] });
  runHook(cfg, '/scrooge off', { session_id: 'sessA' });
  assert.equal(readState(statePathFor(cfg, 'sessA')), null);
  assert.deepEqual(reg(readState(statePathFor(cfg, 'sessB'))), { lang: 'en', dial: 'full', flags: [] }); // untouched
});

test('session-scope: off on an active session injects a localized countermand', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko', { session_id: 'sessC' });
  const { ctx } = runHook(cfg, '/scrooge off', { session_id: 'sessC' });
  assert.match(ctx, /SCROOGE OFF/);
  assert.match(ctx, /평소 register|일반 문체/); // ko-localized
});

test('session-scope: off on an active ja session injects a ja-localized countermand', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ja', { session_id: 'sessJa' });
  const { ctx } = runHook(cfg, '/scrooge off', { session_id: 'sessJa' });
  assert.match(ctx, /SCROOGE OFF/);
  assert.match(ctx, /圧縮モード解除|通常文体/); // ja-localized
});

test('session-scope: off on an active hi session injects a hi-localized countermand', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge hi', { session_id: 'sessHi' });
  const { ctx } = runHook(cfg, '/scrooge off', { session_id: 'sessHi' });
  assert.match(ctx, /SCROOGE OFF/);
  assert.match(ctx, /संपीड़न मोड बंद|सामान्य शैली/); // hi-localized
});

test('session-scope: off on an active zh session injects a zh-localized countermand', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge zh', { session_id: 'sessZh' });
  const { ctx } = runHook(cfg, '/scrooge off', { session_id: 'sessZh' });
  assert.match(ctx, /SCROOGE OFF/);
  assert.match(ctx, /压缩模式解除|常规文体/); // zh-localized
});

test('session-scope: off on an inactive session injects nothing', () => {
  const cfg = freshConfig();
  const { ctx } = runHook(cfg, '/scrooge off', { session_id: 'sessD' });
  assert.equal(ctx, null);
  assert.equal(readState(statePathFor(cfg, 'sessD')), null);
});

test('session-scope: a sessionless payload falls back to the global state path', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko'); // no session_id → global
  assert.deepEqual(reg(readState(statePathFor(cfg, null))), { lang: 'ko', dial: 'full', flags: [] });
});

// ── activatedAt stamping (S3-4 write side) ──────────────────────────────────

// Stamped only on the inactive→active transition; a set on an already-active
// session keeps it. Restamping on a lang/flag change made stats drop every
// compressed turn before e.g. `/scrooge nolean`.
test('activatedAt: stamped when a set turns the mode on, kept on any set while active', () => {
  const cfg = freshConfig();
  const sp = statePathFor(cfg, 'sessAt');
  const before = Date.now();
  runHook(cfg, '/scrooge ko', { session_id: 'sessAt' });
  const on = readState(sp).activatedAt;
  assert.ok(on >= before && on <= Date.now(), String(on));
  // Pin a sentinel so "kept" vs "restamped" is observable without timing.
  fs.writeFileSync(sp, JSON.stringify({ lang: 'ko', dial: 'full', flags: [], activatedAt: 1000 }));
  for (const p of ['/scrooge ko', '/scrooge en', '/scrooge lean', '/scrooge nolean', 'talk like scrooge']) {
    runHook(cfg, p, { session_id: 'sessAt' });
    assert.equal(readState(sp).activatedAt, 1000, p);
  }
  assert.equal(readState(sp).lang, 'en'); // the sets did apply
  // off → set is a fresh inactive→active transition: restamped.
  runHook(cfg, '/scrooge off', { session_id: 'sessAt' });
  runHook(cfg, '/scrooge ko', { session_id: 'sessAt' });
  assert.ok(readState(sp).activatedAt > 1000);
});

// A SessionStart seed was active from the session's start: unstamped, and a later
// set keeps it absent. A UserPromptSubmit seed is an in-session transition (the
// default appeared mid-session, or Codex's first prompt): stamped, and kept.
test('activatedAt: a set on a SessionStart-seeded session keeps it absent (whole-session basis)', () => {
  const cfg = freshConfig();
  const sp = statePathFor(cfg, 'sessSeeded');
  fs.mkdirSync(path.join(cfg, '.scrooge'), { recursive: true });
  fs.writeFileSync(path.join(cfg, '.scrooge', 'default'), JSON.stringify({ lang: 'ko', dial: 'full', flags: ['lean'] }));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'plugin', 'hooks', 'scrooge-session-start.js')], {
    input: JSON.stringify({ session_id: 'sessSeeded', source: 'startup' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'plugin'), SCROOGE_DEFAULT_FLAGS: '', SCROOGE_NO_UPDATE_CHECK: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal('activatedAt' in readState(sp), false);
  runHook(cfg, '/scrooge nolean', { session_id: 'sessSeeded' });
  assert.deepEqual(readState(sp), { lang: 'ko', dial: 'full', flags: [] });
  // UPS seed: stamped, and a later set keeps that stamp.
  const up = statePathFor(cfg, 'sessUpsSeeded');
  runHook(cfg, '이 코드 설명해줘', { session_id: 'sessUpsSeeded' });
  const at = readState(up).activatedAt;
  assert.ok(Number.isFinite(at), `activatedAt ${at}`);
  runHook(cfg, '/scrooge en', { session_id: 'sessUpsSeeded' });
  assert.equal(readState(up).activatedAt, at);
});

test('activatedAt: an NL set that turns the mode on stamps it too', () => {
  const cfg = freshConfig();
  runHook(cfg, '스크루지처럼 답해줘', { session_id: 'sessNlAt' });
  assert.equal(typeof readState(statePathFor(cfg, 'sessNlAt')).activatedAt, 'number');
});

// ── default-seeded first turn (S3-7) ────────────────────────────────────────
// Codex wires only UserPromptSubmit, so the turn that seeds a session from the
// global default must carry the full rule itself; on Claude, SessionStart already
// seeded + injected it, so the first prompt must NOT inject it a second time.

const SESSION_START = path.join(REPO_ROOT, 'plugin', 'hooks', 'scrooge-session-start.js');

function seedDefault(cfg, state) {
  fs.mkdirSync(path.join(cfg, '.scrooge'), { recursive: true });
  fs.writeFileSync(path.join(cfg, '.scrooge', 'default'), JSON.stringify(state));
}

test('a turn that seeds the session from the default injects the full rule (Codex: no SessionStart)', () => {
  const cfg = freshConfig();
  seedDefault(cfg, { lang: 'ko', dial: 'full', flags: ['lean'] });
  const first = runHook(cfg, '이 코드 설명해줘', { session_id: 'codexSeed' });
  assert.match(first.ctx, /SCROOGE MODE ACTIVE — ko\/full \+ lean/);
  assert.match(first.ctx, /Auto-Clarity/); // the full rule, not the reminder
  const second = runHook(cfg, '이 코드 설명해줘', { session_id: 'codexSeed' });
  assert.match(second.ctx, /SCROOGE 활성 \(ko\/full\)/); // seeded now → reminder only
  assert.doesNotMatch(second.ctx, /SCROOGE MODE ACTIVE/);
});

test('Claude: SessionStart seeds + injects, so the first prompt stays reminder-only (no double full rule)', () => {
  const cfg = freshConfig();
  seedDefault(cfg, { lang: 'ko', dial: 'full', flags: [] });
  const r = spawnSync(process.execPath, [SESSION_START], {
    input: JSON.stringify({ session_id: 'claudeSeed', source: 'startup' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'plugin'), SCROOGE_DEFAULT_FLAGS: '', SCROOGE_NO_UPDATE_CHECK: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /SCROOGE MODE ACTIVE — ko\/full/);
  const { ctx } = runHook(cfg, '이 코드 설명해줘', { session_id: 'claudeSeed' });
  assert.match(ctx, /SCROOGE 활성 \(ko\/full\)/);
  assert.doesNotMatch(ctx, /SCROOGE MODE ACTIVE/);
});

// ── off tombstone (S3-6) ────────────────────────────────────────────────────

test('off in a keyed session leaves a tombstone; a sessionless off deletes the global file', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko', { session_id: 'sessTomb' });
  runHook(cfg, '/scrooge off', { session_id: 'sessTomb' });
  const sp = statePathFor(cfg, 'sessTomb');
  assert.equal(fs.existsSync(sp), true); // kept as an explicit-off marker
  assert.equal(readState(sp), null); // …that reads as inactive
  runHook(cfg, '/scrooge ko'); // sessionless → global
  runHook(cfg, '/scrooge off');
  assert.equal(fs.existsSync(statePathFor(cfg, null)), false);
});

// ── live-marker refresh + Codex daily sweep (audit-followups task 1) ────────

const DAY_MS = 24 * 60 * 60 * 1000;
function ageFile(p, days) {
  const t = new Date(Date.now() - days * DAY_MS);
  fs.utimesSync(p, t, t);
}
const isFresh = (p) => Date.now() - fs.statSync(p).mtimeMs < 60 * 1000;

test('a reminder turn refreshes the active marker mtime, keeping its content', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko', { session_id: 'sessLive' });
  const sp = statePathFor(cfg, 'sessLive');
  const before = fs.readFileSync(sp, 'utf8');
  ageFile(sp, 2);
  const { ctx } = runHook(cfg, '이 코드 설명해줘', { session_id: 'sessLive' });
  assert.match(ctx, /SCROOGE 활성 \(ko\/full\)/);
  assert.equal(isFresh(sp), true);
  assert.equal(fs.readFileSync(sp, 'utf8'), before); // activatedAt kept
});

test('a plain turn never refreshes an off tombstone or the sessionless global file', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko', { session_id: 'sessOff' });
  runHook(cfg, '/scrooge off', { session_id: 'sessOff' });
  const tomb = statePathFor(cfg, 'sessOff');
  ageFile(tomb, 2);
  runHook(cfg, 'hello', { session_id: 'sessOff' });
  assert.equal(isFresh(tomb), false);

  runHook(cfg, '/scrooge ko'); // sessionless → global
  const global = statePathFor(cfg, null);
  ageFile(global, 2);
  runHook(cfg, 'hello');
  assert.equal(isFresh(global), false);
});

// An idle peer whose marker equals the default is swept after a day.
function idlePeer(cfg) {
  const p = statePathFor(cfg, 'idlePeer');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ lang: 'ko', dial: 'full', flags: [] }));
  ageFile(p, 2);
  return p;
}

test('Codex: a plain turn sweeps stale markers at most once a day', () => {
  const cfg = freshConfig();
  seedDefault(cfg, { lang: 'ko', dial: 'full', flags: [] });
  let peer = idlePeer(cfg);
  runHook(cfg, 'hello', { session_id: 'codexSweep' }, CODEX_ENV);
  assert.equal(fs.existsSync(peer), false);
  assert.equal(fs.existsSync(path.join(cfg, '.scrooge', 'last-sweep')), true);
  peer = idlePeer(cfg);
  runHook(cfg, 'hello', { session_id: 'codexSweep' }, CODEX_ENV);
  assert.equal(fs.existsSync(peer), true); // within the day: no second sweep
});

test('Codex: the sweep never takes the current session’s own idle marker', () => {
  const cfg = freshConfig();
  seedDefault(cfg, { lang: 'ko', dial: 'full', flags: [] });
  const own = statePathFor(cfg, 'codexOwn');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, JSON.stringify({ lang: 'ko', dial: 'full', flags: [] })); // redundant, no activatedAt
  ageFile(own, 2);
  const { ctx } = runHook(cfg, 'hello', { session_id: 'codexOwn' }, CODEX_ENV);
  assert.match(ctx, /SCROOGE 활성 \(ko\/full\)/); // reminder: the marker was not re-seeded
  assert.equal(readState(own).activatedAt, undefined);
});

test('Codex: a corrupt sweep record skips the sweep and leaves the hook output intact', () => {
  const cfg = freshConfig();
  seedDefault(cfg, { lang: 'ko', dial: 'full', flags: [] });
  const peer = idlePeer(cfg);
  fs.writeFileSync(path.join(cfg, '.scrooge', 'last-sweep'), 'garbage');
  const { ctx } = runHook(cfg, 'hello', { session_id: 'codexCorrupt' }, CODEX_ENV);
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/); // first turn seeds → full rule
  assert.equal(fs.existsSync(peer), true);
});

test('Claude: a plain turn never sweeps (SessionStart owns the sweep there)', () => {
  const cfg = freshConfig();
  seedDefault(cfg, { lang: 'ko', dial: 'full', flags: [] });
  const peer = idlePeer(cfg);
  runHook(cfg, 'hello', { session_id: 'claudeNoSweep' }, { SCROOGE_AGENT: '' });
  assert.equal(fs.existsSync(peer), true);
  assert.equal(fs.existsSync(path.join(cfg, '.scrooge', 'last-sweep')), false);
});
