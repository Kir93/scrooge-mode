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
  claudeAction,
  claudeUpdatePlan,
  codexHookHash,
  detectMatch,
  detectCompetingRegisters,
  mergeCodexHookConfig,
  pruneClaudeSkillLeak,
  removeCodexHookConfig,
  safeReplaceFile,
  findOwnRepoRoot,
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

// ── Self-install guard (integrity-sweep Task 12) ──────────────────────────────
// findOwnRepoRoot decides whether the installer is running inside its own clone.
// A wrong answer is not cosmetic: it drives whether we install into the user's
// agent config or refuse as a self-install, and the walk touches every parent
// directory up to `/`.

test('findOwnRepoRoot finds the package root by name, walking up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-own-'));
  const nested = path.join(dir, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'scrooge-mode' }));
  assert.equal(fs.realpathSync(findOwnRepoRoot(nested, 'scrooge-mode')), fs.realpathSync(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findOwnRepoRoot ignores a different package and an unparseable manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-own-'));
  const nested = path.join(dir, 'a');
  fs.mkdirSync(nested, { recursive: true });
  // Someone else's package must not match, and a broken package.json must not
  // abort the walk — it keeps going upward.
  fs.writeFileSync(path.join(nested, 'package.json'), '{ not json');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'some-other-pkg' }));
  assert.equal(findOwnRepoRoot(nested, 'scrooge-mode'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findOwnRepoRoot terminates at the filesystem root instead of looping', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-own-'));
  assert.equal(findOwnRepoRoot(dir, 'a-name-no-package-will-ever-have'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Single-source guards on install.js (integrity-sweep Task 3) ──────────────
// Source-level asserts, not behavioural ones: both properties are about what the
// file is allowed to CONTAIN. A behavioural test would pass just as happily
// against a re-introduced private copy.

test('release comparison comes from hooks/scrooge-config.js, not a local copy', () => {
  // `scrooge --version` and the session-start update notice must agree on what
  // "newer" means. A second parser here drifts silently — no test would fail.
  const src = fs.readFileSync(INSTALL_JS, 'utf8');
  assert.match(src, /import \{ semverGt \} from '\.\.\/hooks\/scrooge-config\.js'/);
  assert.ok(!/function (isNewerVersion|semverGt)\s*\(/.test(src), 'install.js redefines the version compare');
});

test('safeReplaceFile backs up once, preserves mode, and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-write-'));
  const target = path.join(dir, 'settings.json');
  fs.writeFileSync(target, 'original\n');
  fs.chmodSync(target, 0o644);

  safeReplaceFile(target, 'first\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'first\n');
  // The pre-existing content is preserved as the user's snapshot.
  assert.equal(fs.readFileSync(target + '.bak', 'utf8'), 'original\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o644);

  // A later write (e.g. uninstall) must not overwrite that first snapshot.
  safeReplaceFile(target, 'second\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'second\n');
  assert.equal(fs.readFileSync(target + '.bak', 'utf8'), 'original\n');

  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.scrooge.tmp')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('user-owned config files are written through safeReplaceFile only', () => {
  // A raw writeFileSync truncates first: a crash mid-write leaves the user's
  // settings.json/config.toml destroyed with no backup. Match the whole call
  // (balanced-paren-free but newline-tolerant) rather than the first comma-free
  // argument — `fs.writeFileSync(path.join(cfg, 'settings.json'), …)` would slip
  // past an `[^,]+` capture and quietly disarm this guard.
  const src = fs.readFileSync(INSTALL_JS, 'utf8');
  for (const m of src.matchAll(/fs\.writeFileSync\([\s\S]*?\);/g)) {
    assert.ok(
      !/settingsPath|configPath|settings\.json|config\.toml/.test(m[0]),
      `user config written without safeReplaceFile: ${m[0].slice(0, 120)}`
    );
  }
  assert.match(src, /export function safeReplaceFile\(/);
});

test('safeReplaceFile writes through a symlinked config file, not over it', {
  skip: process.platform === 'win32' ? 'symlinkSync needs admin/Developer Mode on Windows' : false,
}, () => {
  // Dotfile setups symlink settings.json into a tracked repo. Renaming over the
  // link would replace it with a plain file and strand the repo copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-link-'));
  const real = path.join(dir, 'dotfiles-settings.json');
  const link = path.join(dir, 'settings.json');
  fs.writeFileSync(real, 'original\n');
  fs.symlinkSync(real, link);

  safeReplaceFile(link, 'updated\n');

  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'symlink was replaced by a regular file');
  assert.equal(fs.readFileSync(real, 'utf8'), 'updated\n');
  assert.equal(fs.readFileSync(real + '.bak', 'utf8'), 'original\n'); // backup beside the real file
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Claude re-run = update (Task: update-path) ───────────────────────────────
// `installClaude` probes `claude plugin list` and routes the result through these
// two pure helpers, so the install-vs-update decision and the emitted command
// sequence are testable without spawning the live `claude` CLI.

test('claudeAction: an installed plugin updates, not skips', () => {
  assert.equal(claudeAction({ force: false }, true), 'update');
});

test('claudeAction: an absent plugin installs fresh', () => {
  assert.equal(claudeAction({ force: false }, false), 'install');
});

test('claudeAction: --force always reinstalls (never update)', () => {
  // --force keeps "always reinstall" meaning — the bypass for any future
  // version-skip optimization, so it must not collapse into the update path.
  assert.equal(claudeAction({ force: true }, true), 'install');
  assert.equal(claudeAction({ force: true }, false), 'install');
});

test('claudeUpdatePlan (latest): marketplace update → plugin update', () => {
  // No --tag → refresh-in-place via the native CLI (verified in `claude plugin
  // --help`): refresh the catalog, then apply the newest. No uninstall→install.
  assert.deepEqual(claudeUpdatePlan({}), [
    ['claude', ['plugin', 'marketplace', 'update', 'scrooge']],
    ['claude', ['plugin', 'update', 'scrooge@scrooge']],
  ]);
});

test('claudeUpdatePlan (--tag): re-points the marketplace then reinstalls', () => {
  // `marketplace update` refreshes from the existing source and cannot re-pin, so
  // a tag pin removes + re-adds the marketplace at REPO#ref, then installs.
  assert.deepEqual(claudeUpdatePlan({ tag: 'v0.7.0' }), [
    ['claude', ['plugin', 'marketplace', 'remove', 'scrooge']],
    ['claude', ['plugin', 'marketplace', 'add', 'Kir93/scrooge-mode#v0.7.0']],
    ['claude', ['plugin', 'install', 'scrooge@scrooge']],
  ]);
});

test('claudeUpdatePlan: latest plan resolves repoSpec to bare REPO (no ref)', () => {
  // Goal 4: no --tag = latest. The latest plan never carries a #ref anywhere.
  const flat = claudeUpdatePlan({}).flatMap(([, args]) => args);
  assert.ok(!flat.some((a) => a.includes('#')), 'no pinned ref in the latest plan');
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

test('mergeCodexHookConfig removes legacy nested scrooge hooks and stale hook state', () => {
  const before = [
    'model = "gpt-5"',
    '',
    '[[hooks.UserPromptSubmit]]',
    '',
    '[[hooks.UserPromptSubmit.hooks]]',
    'type = "command"',
    'command = \'"node" "/old/scrooge/codex-activate.mjs"\'',
    'timeout = 5',
    'statusMessage = "Tracking scrooge mode..."',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [',
    '  { type = "command", command = "\\"node\\" \\"/newer/scrooge/codex-activate.mjs\\"", timeout = 5, statusMessage = "Tracking scrooge mode..." },',
    ']',
    '',
    '[hooks.state]',
    '',
    '[hooks.state."/home/me/.codex/config.toml:user_prompt_submit:0:0"]',
    'trusted_hash = "sha256:old"',
    'enabled = true',
    '',
    '[hooks.state."/home/me/.codex/config.toml:user_prompt_submit:1:0"]',
    'trusted_hash = "sha256:newer"',
    'enabled = true',
    '',
  ].join('\n');
  const command = 'node "/current/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(before, command, '/home/me/.codex/config.toml');

  assert.doesNotMatch(after, /\/old\/scrooge\/codex-activate\.mjs/);
  assert.doesNotMatch(after, /\/newer\/scrooge\/codex-activate\.mjs/);
  assert.match(after, /\/current\/scrooge\/codex-activate\.mjs/);
  assert.equal((after.match(/\[\[hooks\.UserPromptSubmit\]\]/g) || []).length, 1);
  assert.doesNotMatch(after, /user_prompt_submit:1:0/);
  assert.match(after, /\[hooks\.state\."\/home\/me\/\.codex\/config\.toml:user_prompt_submit:0:0"\]/);
  assert.match(after, new RegExp(`trusted_hash = "${codexHookHash(command)}"`));
});

test('mergeCodexHookConfig is idempotent across a re-run (update-path Codex guard)', () => {
  // Re-run = update: the installer re-applies the Codex hook merge every time
  // (and `installCodexPayload` re-copies hooks/rules/lib/registry, a stdlib
  // overwrite). A second merge over already-merged config must be a stable no-op,
  // or re-running would accrete duplicate UserPromptSubmit hooks.
  const command = 'node "/home/me/.codex/scrooge/codex-activate.mjs"';
  const key = '/home/me/.codex/config.toml';
  const once = mergeCodexHookConfig('model = "gpt-5"\n', command, key);
  const twice = mergeCodexHookConfig(once, command, key);
  assert.equal(twice, once, 're-applying the merge must be a stable no-op');
  assert.equal((twice.match(/\[\[hooks\.UserPromptSubmit\]\]/g) || []).length, 1);
  assert.match(twice, /codex-activate\.mjs/);
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

test('removeCodexHookConfig removes legacy nested scrooge hook blocks', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    '',
    '[[hooks.UserPromptSubmit.hooks]]',
    'type = "command"',
    'command = "node /new/codex-activate.mjs"',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "echo keep" }]',
    '',
  ].join('\n');
  const after = removeCodexHookConfig(before);

  assert.doesNotMatch(after, /codex-activate\.mjs/);
  assert.doesNotMatch(after, /\[\[hooks\.UserPromptSubmit\.hooks\]\]/);
  assert.match(after, /echo keep/);
  assert.equal((after.match(/\[\[hooks\.UserPromptSubmit\]\]/g) || []).length, 1);
});

// pruneClaudeSkillLeak — removes a leaked Claude-scope `scrooge` skill symlink
// (the skills CLI scatters one into every globally-linked agent), without
// touching the shared ~/.agents copy or a real directory we didn't create.
function leakFixture() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-leak-'));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-agents-'));
  fs.writeFileSync(path.join(shared, 'SKILL.md'), '# shared skill\n');
  fs.mkdirSync(path.join(cfg, 'skills'));
  return { cfg, shared };
}

test('pruneClaudeSkillLeak unlinks the leaked symlink, keeps its target', () => {
  const { cfg, shared } = leakFixture();
  const link = path.join(cfg, 'skills', 'scrooge');
  fs.symlinkSync(shared, link);
  const results = { removed: [] };

  pruneClaudeSkillLeak({ configDir: cfg }, results);

  assert.equal(fs.existsSync(link), false, 'leaked symlink removed');
  assert.equal(fs.existsSync(path.join(shared, 'SKILL.md')), true, 'shared copy intact');
  assert.deepEqual(results.removed, ['claude-skill-leak']);
  fs.rmSync(cfg, { recursive: true, force: true });
  fs.rmSync(shared, { recursive: true, force: true });
});

test('pruneClaudeSkillLeak leaves a real directory untouched', () => {
  const { cfg, shared } = leakFixture();
  const real = path.join(cfg, 'skills', 'scrooge');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'SKILL.md'), '# user-authored\n');
  const results = { removed: [] };

  pruneClaudeSkillLeak({ configDir: cfg }, results);

  assert.equal(fs.existsSync(path.join(real, 'SKILL.md')), true, 'real dir preserved');
  assert.deepEqual(results.removed, []);
  fs.rmSync(cfg, { recursive: true, force: true });
  fs.rmSync(shared, { recursive: true, force: true });
});

test('pruneClaudeSkillLeak is a no-op when nothing leaked', () => {
  const { cfg, shared } = leakFixture();
  const results = { removed: [] };

  pruneClaudeSkillLeak({ configDir: cfg }, results);

  assert.deepEqual(results.removed, []);
  fs.rmSync(cfg, { recursive: true, force: true });
  fs.rmSync(shared, { recursive: true, force: true });
});

test('pruneClaudeSkillLeak in dry-run reports but does not unlink', () => {
  const { cfg, shared } = leakFixture();
  const link = path.join(cfg, 'skills', 'scrooge');
  fs.symlinkSync(shared, link);
  const results = { removed: [] };

  pruneClaudeSkillLeak({ configDir: cfg, dryRun: true }, results);

  assert.equal(fs.existsSync(link), true, 'dry-run keeps the symlink');
  assert.deepEqual(results.removed, []);
  fs.rmSync(cfg, { recursive: true, force: true });
  fs.rmSync(shared, { recursive: true, force: true });
});

test('pruneClaudeSkillLeak also unlinks a leaked scrooge-stats symlink', () => {
  // Regression guard: `npx skills add --all` links every plugin skill, so
  // scrooge-stats leaks the same way scrooge does and shadows /scrooge-stats
  // (a recurring re-install bug). The prune must cover it, not just `scrooge`.
  const { cfg, shared } = leakFixture();
  const link = path.join(cfg, 'skills', 'scrooge-stats');
  fs.symlinkSync(shared, link);
  const results = { removed: [] };

  pruneClaudeSkillLeak({ configDir: cfg }, results);

  assert.equal(fs.existsSync(link), false, 'leaked scrooge-stats symlink removed');
  assert.equal(fs.existsSync(path.join(shared, 'SKILL.md')), true, 'shared copy intact');
  assert.deepEqual(results.removed, ['claude-skill-leak']);
  fs.rmSync(cfg, { recursive: true, force: true });
  fs.rmSync(shared, { recursive: true, force: true });
});

// Cross-plugin conflict detection (caveman #574). Two output-compression
// registers both emit `additionalContext` on UserPromptSubmit and cannot observe
// each other, so the model receives contradictory style directives. The installer
// cannot fix that — it can only say so, which is what this powers.
test('detectCompetingRegisters finds other compression registers in a plugin list', () => {
  assert.deepEqual(detectCompetingRegisters('scrooge@scrooge  enabled'), []);
  assert.deepEqual(
    detectCompetingRegisters('caveman@caveman enabled\nscrooge@scrooge enabled'),
    ['caveman']
  );
  assert.deepEqual(detectCompetingRegisters('Grill-Me@marketplace'), ['grill-me']);
  assert.deepEqual(detectCompetingRegisters('grillme@x'), ['grillme']);
});

test('detectCompetingRegisters is total on junk input', () => {
  // It runs off `claude plugin list` stdout, which is absent when the CLI is
  // missing or errored — it must degrade to "no conflict", never throw mid-install.
  for (const junk of [null, undefined, '', 0, {}, []]) {
    assert.deepEqual(detectCompetingRegisters(junk), []);
  }
});
