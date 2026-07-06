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
const SESSION_FIXTURE = path.join(HERE, 'fixtures', 'sample-session.jsonl');

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
      CLAUDE_PLUGIN_ROOT: REPO_ROOT,
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
  return { state: readState(path.join(configDir, '.scrooge', 'global')), ctx, result };
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
  runHook(cfg, '/scrooge lite'); // → en/lite
  const { state } = runHook(cfg, '/scrooge'); // bare: dial→full, lang kept
  assert.deepEqual(state, { lang: 'en', dial: 'full', flags: [] });
});

test('lang and dial are independent axes; unspecified axis is preserved', () => {
  const cfg = freshConfig();
  runHook(cfg, '/scrooge ko'); // lang→ko, dial kept (full default)
  let { state } = runHook(cfg, '/scrooge lite'); // dial→lite, lang kept
  assert.deepEqual(state, { lang: 'ko', dial: 'lite', flags: [] });
});

test('token order does not matter', () => {
  const a = freshConfig();
  const b = freshConfig();
  const sa = runHook(a, '/scrooge ko lite').state;
  const sb = runHook(b, '/scrooge lite ko').state;
  assert.deepEqual(sa, { lang: 'ko', dial: 'lite', flags: [] });
  assert.deepEqual(sb, { lang: 'ko', dial: 'lite', flags: [] });
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
  runHook(cfg, '/scrooge en lite', { session_id: 'sessB' });
  assert.deepEqual(readState(statePathFor(cfg, 'sessA')), { lang: 'ko', dial: 'full', flags: [] });
  assert.deepEqual(readState(statePathFor(cfg, 'sessB')), { lang: 'en', dial: 'lite', flags: [] });
  runHook(cfg, '/scrooge off', { session_id: 'sessA' });
  assert.equal(readState(statePathFor(cfg, 'sessA')), null);
  assert.deepEqual(readState(statePathFor(cfg, 'sessB')), { lang: 'en', dial: 'lite', flags: [] }); // untouched
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
  assert.deepEqual(readState(statePathFor(cfg, null)), { lang: 'ko', dial: 'full', flags: [] });
});
