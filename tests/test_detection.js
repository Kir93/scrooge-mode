// install.js detectMatch — provider detection clause routing.
//
// The OS probes (command/macapp/vscode-ext) are thin stdlib wrappers; the logic
// worth covering is the `||` clause splitting, `kind:value` dispatch, and
// home-expansion. Tests inject stub probes so routing is deterministic and free
// of real filesystem / PATH lookups. (Per task §5, the probes themselves stay
// uncovered — mocking the host environment has limits.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  codexHookHash,
  detectMatch,
  mergeCodexHookConfig,
  removeCodexHookConfig,
} from '../bin/install.js';

const INSTALL_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'install.js');

test('a single matching clause detects', () => {
  assert.equal(detectMatch('command:claude', { command: (v) => v === 'claude' }), true);
});

test('a single non-matching clause does not detect', () => {
  assert.equal(detectMatch('command:claude', { command: () => false }), false);
});

test('|| tries each clause until one matches', () => {
  const ok = detectMatch('command:cursor||macapp:Cursor', {
    command: () => false,
    macapp: () => true,
  });
  assert.equal(ok, true);
});

test('|| short-circuits on the first match', () => {
  let macChecked = false;
  const ok = detectMatch('command:x||macapp:Y', {
    command: () => true,
    macapp: () => {
      macChecked = true;
      return false;
    },
  });
  assert.equal(ok, true);
  assert.equal(macChecked, false);
});

test('an unknown clause kind never matches', () => {
  assert.equal(detectMatch('mystery:thing', {}), false);
});

test('prototype-member clause kinds never match and never throw', () => {
  // Regression: a plain-object probe table would leak Object.prototype members
  // (constructor/toString → truthy; __proto__/hasOwnProperty/valueOf → throw).
  // No injected probes → exercises the real DEFAULT_PROBES table (the exported
  // API surface), which is also a plain object.
  for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.equal(detectMatch(`${kind}:x`), false, `${kind} leaked through`);
  }
});

test('empty / falsy specs never match', () => {
  const probes = { command: () => true };
  assert.equal(detectMatch('', probes), false);
  assert.equal(detectMatch(null, probes), false);
  assert.equal(detectMatch(undefined, probes), false);
});

test('the clause value is home-expanded before probing', () => {
  let seen = null;
  detectMatch('dir:~/some/path', {
    dir: (v) => {
      seen = v;
      return false;
    },
  });
  assert.ok(seen.startsWith(os.homedir()));
  assert.ok(!seen.includes('~'));
});

test('default probes resolve a definitely-absent command to false', () => {
  // Smoke test against the real default probe table (no injection).
  assert.equal(detectMatch('command:scrooge-not-a-real-binary-zzz'), false);
});

test('main() fires when invoked through a bin symlink (CLI-guard regression)', {
  skip: process.platform === 'win32' ? 'symlinkSync needs admin/Developer Mode on Windows' : false,
}, () => {
  // The npm `bin` and curl|bash→npx paths invoke install.js through a symlink.
  // The CLI guard must realpath both sides, or main() silently never runs.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-bin-'));
  const link = path.join(dir, 'scrooge');
  fs.symlinkSync(INSTALL_JS, link);
  const r = spawnSync(process.execPath, [link, '--list'], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Supported agents/); // proves main() ran via the symlink
});

test('mergeCodexHookConfig inserts user hook before hook state', () => {
  const before = [
    'model = "gpt-5"',
    '',
    '[hooks.state]',
    '',
    '[hooks.state."/tmp/x:post_tool_use:0:0"]',
    'trusted_hash = "sha256:abc"',
    '',
  ].join('\n');
  const command = 'node "/tmp/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(before, command, '/home/me/.codex/config.toml');

  assert.match(after, /\[\[hooks\.UserPromptSubmit\]\]/);
  assert.match(after, /codex-activate\.mjs/);
  assert.ok(after.indexOf('[[hooks.UserPromptSubmit]]') < after.indexOf('[hooks.state]'));
  assert.match(after, /\[hooks\.state\."\/tmp\/x:post_tool_use:0:0"\]/);
  assert.match(after, /\[hooks\.state\."\/home\/me\/\.codex\/config\.toml:user_prompt_submit:0:0"\]/);
  assert.match(after, new RegExp(`trusted_hash = "${codexHookHash(command)}"`));
});

test('mergeCodexHookConfig replaces old scrooge hook and preserves unrelated hooks', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /old/scrooge-activate.js" }]',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "echo keep" }]',
    '',
  ].join('\n');
  const after = mergeCodexHookConfig(before, 'node "/new/codex-activate.mjs"', '/home/me/.codex/config.toml');

  assert.doesNotMatch(after, /\/old\/scrooge-activate\.js/);
  assert.match(after, /echo keep/);
  assert.equal((after.match(/\[\[hooks\.UserPromptSubmit\]\]/g) || []).length, 2);
  assert.match(after, /\[hooks\.state\."\/home\/me\/\.codex\/config\.toml:user_prompt_submit:1:0"\]/);
});

test('removeCodexHookConfig removes only scrooge hook blocks', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /new/codex-activate.mjs" }]',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "echo keep" }]',
    '',
    '[hooks.state]',
    '',
  ].join('\n');
  const after = removeCodexHookConfig(before);

  assert.doesNotMatch(after, /codex-activate\.mjs/);
  assert.match(after, /echo keep/);
  assert.match(after, /\[hooks\.state\]/);
});
