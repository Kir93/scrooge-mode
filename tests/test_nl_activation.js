// nl-activation.js — natural-language activation parser contract.
//
// Two layers:
//   - Pure-function tests import parseNaturalActivation directly (no I/O, no
//     state) — the deterministic fixtures core v1 required before NL could land.
//   - Black-box hook tests run the real scrooge-activate.js binary against a
//     temp $CLAUDE_CONFIG_DIR (same harness as test_activate.js) to prove the
//     NL fallback wires into the existing set/off + slash-precedence paths.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseNaturalActivation } from '../hooks/nl-activation.js';
import { readState } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'scrooge-activate.js');

// ---- Layer 1: pure parser ----

test('(a) KO activation triggers set ko/full', () => {
  for (const p of ['스크루지처럼 답해줘', '스크루지 모드로 부탁', '스크루지로 답해줘']) {
    assert.deepEqual(parseNaturalActivation(p), { action: 'set', lang: 'ko', dial: 'full' }, p);
  }
});

test('(a) EN activation triggers set en/full', () => {
  for (const p of ['talk like scrooge please', 'enable scrooge mode', 'be a token miser', 'turn on scrooge']) {
    assert.deepEqual(parseNaturalActivation(p), { action: 'set', lang: 'en', dial: 'full' }, p);
  }
});

test('(b) negation guard suppresses activation (no-op)', () => {
  for (const p of ['스크루지처럼 말하지 마', '스크루지 모드 쓰지 말아', "don't talk like scrooge", 'do not use scrooge mode']) {
    assert.equal(parseNaturalActivation(p), null, p);
  }
});

test('(c) off phrases deactivate', () => {
  for (const p of ['스크루지 꺼줘', '스크루지 그만', '스크루지 비활성', 'stop scrooge', 'scrooge off']) {
    assert.deepEqual(parseNaturalActivation(p), { action: 'off' }, p);
  }
});

test('(c) off cue with "모드"/"mode" between still deactivates (not activate)', () => {
  for (const p of ['스크루지 모드 꺼', '스크루지 모드 꺼줘', '스크루지 모드 끄기', 'scrooge mode off', 'turn scrooge mode off']) {
    assert.deepEqual(parseNaturalActivation(p), { action: 'off' }, p);
  }
});

test('(g) benign "no" does not suppress activation', () => {
  for (const p of ['talk like scrooge, no rush', 'enable scrooge mode, no need for verbose']) {
    assert.deepEqual(parseNaturalActivation(p), { action: 'set', lang: 'en', dial: 'full' }, p);
  }
});

test('(c) negated off is a no-op (keep the active mode)', () => {
  assert.equal(parseNaturalActivation('스크루지 끄지 마'), null);
  assert.equal(parseNaturalActivation("don't turn off scrooge"), null);
});

test('(d) no-intent sentences do not activate', () => {
  for (const p of ['스크루지 영화 봤어', '스크루지 소설 재밌더라', 'I read A Christmas Carol about Scrooge', '그냥 이 코드 설명해줘']) {
    assert.equal(parseNaturalActivation(p), null, p);
  }
});

test('(h) meta-questions about scrooge mode do not toggle (no-op)', () => {
  // The maintainer hits these while dogfooding this repo: asking ABOUT the mode
  // must not turn it on or off. Covers the off-cue trap ("끄는 로직"/"mode off"),
  // the bare-mode activate trap ("스크루지 모드 버그"), and how-it-works questions.
  for (const p of [
    '스크루지 모드 끄는 로직 설명해줘',
    'explain scrooge mode off',
    '스크루지 모드 버그',
    '스크루지 모드 어떻게 동작해?',
    'how does scrooge mode work',
  ]) {
    assert.equal(parseNaturalActivation(p), null, p);
  }
});

test('(h) a style directive still activates even with a meta cue present', () => {
  // Guard against over-suppression: "answer like scrooge, explaining X" is a real
  // activation, not a question about the mode — the style directive is exempt.
  assert.deepEqual(parseNaturalActivation('스크루지처럼 설명해줘'), { action: 'set', lang: 'ko', dial: 'full' });
  assert.deepEqual(parseNaturalActivation('talk like scrooge and explain this'), { action: 'set', lang: 'en', dial: 'full' });
});

test('(d) "압축 모드" / "토큰 아껴" without the name do not activate (W1)', () => {
  for (const p of ['이미지 압축 모드로 저장해줘', '파일 압축 모드 설정', '이 API 토큰 아껴 쓰자', '압축 모드 해제했어']) {
    assert.equal(parseNaturalActivation(p), null, p);
  }
});

test('language is inferred from the matched phrase', () => {
  assert.equal(parseNaturalActivation('스크루지처럼').lang, 'ko');
  assert.equal(parseNaturalActivation('scrooge mode').lang, 'en');
});

test('parser is pure — same input, same output, empty/garbage → null', () => {
  const a = parseNaturalActivation('스크루지처럼 답해');
  const b = parseNaturalActivation('스크루지처럼 답해');
  assert.deepEqual(a, b);
  assert.equal(parseNaturalActivation(''), null);
  assert.equal(parseNaturalActivation(null), null);
  assert.equal(parseNaturalActivation('hello world'), null);
});

// ---- Layer 2: hook integration (black-box) ----

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-nl-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

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

test('NL activation through the hook persists state + injects the full rule', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '스크루지처럼 답해줘');
  assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: [] });
  assert.match(ctx, /SCROOGE MODE ACTIVE — ko\/full/);
});

test('NL off through the hook clears state and injects a countermand', () => {
  const cfg = freshConfig();
  runHook(cfg, 'talk like scrooge'); // en/full active
  const { state, ctx } = runHook(cfg, 'stop scrooge');
  assert.equal(state, null);
  assert.match(ctx, /SCROOGE OFF/); // active → countermand (Task 5)
});

test('(e) a valid slash command wins over NL text in the same prompt (SC 3.3)', () => {
  const cfg = freshConfig();
  // "lite" is a valid slash dial, so parseCommand returns non-null and NL never
  // runs — dial stays lite, not the full an NL trigger would force.
  const { state } = runHook(cfg, '/scrooge lite talk like scrooge');
  assert.deepEqual(state, { lang: 'en', dial: 'lite', flags: [] });
});

test('(f) inactive session + plain prompt injects nothing', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '스크루지 영화 봤어');
  assert.equal(state, null);
  assert.equal(ctx, null);
});

test('NL off is a no-op while inactive (negated off does not error)', () => {
  const cfg = freshConfig();
  const { state, ctx } = runHook(cfg, '스크루지 끄지 마');
  assert.equal(state, null);
  assert.equal(ctx, null);
});
