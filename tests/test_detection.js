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
  hasMixedScroogeGroup,
  safeReplaceFile,
  findOwnRepoRoot,
  installCodexPayload,
} from '../cli/install.js';

const INSTALL_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'install.js');

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

// ── Installer exit status ─────────────────────────────────────────────────────
// A run that failed a host still printed `Done. … failed [cursor]` and exited 0,
// so `install.sh`'s `exec node cli/install.js` under a curl|bash `set -euo
// pipefail`, and any CI wrapper, read a broken install as a good one. Both sides
// are pinned here: a recorded failure exits non-zero, a skip stays zero.

test('a failed host install exits non-zero', {
  // Windows spells the variable `Path`, so the spread below leaves the real one
  // in place beside our `PATH` and which wins is a libuv detail, not a contract.
  skip: process.platform === 'win32' ? 'PATH override is case-ambiguous on Windows' : false,
}, () => {
  // `--only cursor` with an empty PATH makes hasCmd('npx') false, so
  // installViaSkills records the failure and returns before touching anything.
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-nopath-'));
  const r = spawnSync(process.execPath, [INSTALL_JS, '--only', 'cursor'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: emptyPath },
  });
  fs.rmSync(emptyPath, { recursive: true, force: true });
  assert.match(r.stdout, /failed \[cursor\]/); // the run really did fail a host
  assert.notEqual(r.status, 0, `installer reported a failure but exited 0:\n${r.stdout}`);
});

test('inside our own clone the skills CLI still runs, from outside the clone', () => {
  // Launching the installer from the scrooge clone used to skip every skills-CLI
  // host, leaving Codex/Cursor SKILL.md on the old release. The guard now moves
  // the call out of the clone instead: `-g` installs at user level, so where it
  // runs from does not change what gets installed.
  const r = spawnSync(process.execPath, [INSTALL_JS, '--only', 'cursor', '--dry-run'], {
    encoding: 'utf8',
    cwd: path.dirname(path.dirname(INSTALL_JS)),
  });
  assert.match(r.stdout, /running the skills CLI from a temp dir/);
  assert.match(r.stdout, /would run: npx -y skills add \S+ -a cursor -g/);
  assert.doesNotMatch(r.stdout, /skipped/);
  assert.equal(r.status, 0, r.stderr);
});

test('the skills CLI installs to the detected agent only, not every agent', () => {
  // `--all` is shorthand for `--skill '*' --agent '*' -y`: it overrides `-a` and
  // sprays the skill into every agent the CLI knows (79 dirs, measured 2026-09-28,
  // `.claude` among them). `--skill '*'` keeps both skills and honours `-a`.
  const r = spawnSync(process.execPath, [INSTALL_JS, '--only', 'cursor', '--dry-run'], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
  });
  assert.match(r.stdout, /would run: npx -y skills add \S+ -a cursor -g -y --skill \*/);
  assert.doesNotMatch(r.stdout, /--all\b/);
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
  assert.match(src, /import \{ semverGt \} from '\.\.\/plugin\/hooks\/scrooge-config\.js'/);
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
  // Rewritten in place: our group keeps index 0, so "echo keep" keeps index 1.
  assert.ok(after.indexOf('/new/codex-activate.mjs') < after.indexOf('echo keep'));
  assert.match(after, /\[hooks\.state\."\/home\/me\/\.codex\/config\.toml:user_prompt_submit:0:0"\]/);
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

// Codex keys hook trust by group position (`<source>:user_prompt_submit:<group>:0`),
// so moving our group on a re-run would hand its index — and the user's trust — to
// whichever hook slid into it.
const KEY = '/home/me/.codex/config.toml';
const userAfterScrooge = (command) =>
  mergeCodexHookConfig('', command, KEY).replace(
    /\[hooks\.state/,
    '[[hooks.UserPromptSubmit]]\nhooks = [{ type = "command", command = "echo user" }]\n\n[hooks.state'
  ) + `\n[hooks.state."${KEY}:user_prompt_submit:1:0"]\ntrusted_hash = "sha256:user"\nenabled = true\n`;

test('mergeCodexHookConfig re-run keeps scrooge in place so a later user hook keeps its trust', () => {
  const command = 'node "/new/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(userAfterScrooge('node "/old/scrooge/codex-activate.mjs"'), command, KEY);

  assert.ok(after.indexOf('codex-activate.mjs') < after.indexOf('echo user'), 'scrooge group stays first');
  assert.match(after, new RegExp(`user_prompt_submit:1:0"\\]\\ntrusted_hash = "sha256:user"`));
  assert.match(after, new RegExp(`user_prompt_submit:0:0"\\]\\ntrusted_hash = "${codexHookHash(command)}"`));
  assert.doesNotMatch(after, /\/old\/scrooge/);
});

test('removeCodexHookConfig with a key source drops our trust state and shifts later keys down', () => {
  const after = removeCodexHookConfig(userAfterScrooge('node "/x/scrooge/codex-activate.mjs"'), KEY);

  assert.doesNotMatch(after, /codex-activate\.mjs/);
  assert.match(after, /echo user/);
  assert.match(after, /user_prompt_submit:0:0"\]\ntrusted_hash = "sha256:user"/, 'user hook now at 0 keeps its hash');
  assert.doesNotMatch(after, /user_prompt_submit:1:0/);
  assert.equal((after.match(/trusted_hash/g) || []).length, 1, 'no orphaned scrooge trust block');
});

// A user may add their own command into our group's `hooks` array. Rewriting that
// group would delete it, so a mixed group is left as is and the caller warns.
const MIXED = [
  '[[hooks.UserPromptSubmit]]',
  'hooks = [',
  '  { type = "command", command = "node /x/scrooge/codex-activate.mjs" },',
  '  { type = "command", command = "policy-check.sh" },',
  ']',
  '',
].join('\n');

test('mixed scrooge + user group: merge and remove leave it untouched, detector flags it', () => {
  assert.equal(mergeCodexHookConfig(MIXED, 'node "/new/scrooge/codex-activate.mjs"', KEY), MIXED);
  assert.equal(removeCodexHookConfig(MIXED, KEY), MIXED);
  assert.equal(hasMixedScroogeGroup(MIXED), true);
  assert.equal(hasMixedScroogeGroup(mergeCodexHookConfig('', 'node "/a/codex-activate.mjs"', KEY)), false);
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

test('detectCompetingRegisters skips a competing register that is installed but disabled', () => {
  // Real `claude plugin list` shape (2026-09-28): one `❯ name@market` entry per
  // install with an indented `Status:` line. A disabled plugin injects nothing, so
  // warning on it is a false positive — the benchmark keeps caveman installed but
  // disabled so the `caveman:full` arm can read its SKILL.md.
  const entry = (name, status) =>
    `  ❯ ${name}\n    Version: 655b7d9c5431\n    Scope: user\n    Status: ${status}\n`;
  const list = (cavemanStatus) =>
    'Installed plugins:\n\n' +
    entry('caveman@caveman', cavemanStatus) + '\n' +
    entry('scrooge@scrooge', '✔ enabled');
  assert.deepEqual(detectCompetingRegisters(list('✘ disabled')), []);
  assert.deepEqual(detectCompetingRegisters(list('✔ enabled')), ['caveman']);
  // Flat one-line entries: each line is its own entry, so a disabled neighbour
  // does not hide an enabled one and vice versa.
  assert.deepEqual(detectCompetingRegisters('caveman@caveman disabled\nscrooge@scrooge enabled'), []);
  assert.deepEqual(detectCompetingRegisters('grill-me@x disabled\ncaveman@caveman enabled'), ['caveman']);
});

test('detectCompetingRegisters is total on junk input', () => {
  // It runs off `claude plugin list` stdout, which is absent when the CLI is
  // missing or errored — it must degrade to "no conflict", never throw mid-install.
  for (const junk of [null, undefined, '', 0, {}, []]) {
    assert.deepEqual(detectCompetingRegisters(junk), []);
  }
});

test('installed Codex payload: the wrapper runs the activate hook end-to-end', () => {
  // The wrapper imports the hook module, so the hook's own isMain gate never
  // fires there — this pins that the wrapper still drives the stdin handler.
  // Nested like ~/.codex/scrooge: the wrapper keeps state in the payload's parent.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-codex-'));
  const pluginRoot = path.join(path.dirname(INSTALL_JS), '..', 'plugin');
  const wrapper = installCodexPayload(pluginRoot, path.join(home, 'scrooge'), { dryRun: false });
  const r = spawnSync(process.execPath, [wrapper], {
    input: JSON.stringify({ session_id: 'codex-e2e', prompt: '/scrooge ko' }),
    encoding: 'utf8',
  });
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout || '{}');
  assert.match(out.hookSpecificOutput?.additionalContext ?? '', /SCROOGE MODE ACTIVE — ko\/full/);
});

// ── Codex config.toml merge edge cases (S3-1, S3-13b/c/d) ─────────────────────
// Codex keys trust by group position, so every one of these is a trust bug, not
// a cosmetic one: a misplaced or miscounted group hands one hook's trust to another.

// Every `[table]` header (not `[[array]]`) appears at most once — TOML rejects a
// redefined table, and Codex then refuses the whole config.
function duplicateTableHeaders(text) {
  const seen = new Map();
  for (const line of text.split('\n')) {
    const h = line.replace(/#.*$/, '').trim();
    if (!/^\[[^[]/.test(h)) continue;
    seen.set(h, (seen.get(h) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([h]) => h);
}

test('mergeCodexHookConfig: a user group after hook state keeps its slot and trust', () => {
  // Inserting before the first [hooks.state counted only the groups above it, so
  // our block took index 0, the user's group slid to 1, and our trust block was
  // written at the user's key — a second `[hooks.state."K:user_prompt_submit:0:0"]`.
  const before = [
    '[hooks.state]',
    '',
    '[hooks.state."K:post_tool_use:0:0"]',
    'trusted_hash = "sha256:post"',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "echo user" }]',
    '',
    '[hooks.state."K:user_prompt_submit:0:0"]',
    'trusted_hash = "sha256:user"',
    'enabled = true',
    '',
  ].join('\n');
  const command = 'node "/x/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(before, command, 'K');

  assert.deepEqual(duplicateTableHeaders(after), []);
  assert.ok(after.indexOf('echo user') < after.indexOf('codex-activate.mjs'), 'user group keeps index 0');
  assert.match(after, /user_prompt_submit:0:0"\]\ntrusted_hash = "sha256:user"/);
  assert.match(after, new RegExp(`user_prompt_submit:1:0"\\]\\ntrusted_hash = "${codexHookHash(command)}"`));
  assert.equal(mergeCodexHookConfig(after, command, 'K'), after, 're-run must be a stable no-op');
});

test('mergeCodexHookConfig: an orphaned trust block at our new slot is replaced, not duplicated', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "echo user" }]',
    '',
    '[hooks.state."K:user_prompt_submit:1:0"]',
    'trusted_hash = "sha256:stale"',
    '',
  ].join('\n');
  const after = mergeCodexHookConfig(before, 'node "/x/codex-activate.mjs"', 'K');

  assert.deepEqual(duplicateTableHeaders(after), []);
  assert.doesNotMatch(after, /sha256:stale/);
});

test('mergeCodexHookConfig re-run keeps a user-disabled scrooge hook disabled', () => {
  const key = (i) => `[hooks.state."K:user_prompt_submit:${i}:0"]`;
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /old/scrooge/codex-activate.mjs" }]',
    '',
    key(0),
    'trusted_hash = "sha256:old"',
    'enabled = false',
    '',
  ].join('\n');
  const after = mergeCodexHookConfig(before, 'node "/new/scrooge/codex-activate.mjs"', 'K');

  assert.match(after, /user_prompt_submit:0:0"\]\ntrusted_hash = "sha256:[0-9a-f]{64}"\nenabled = false\n/);
  assert.doesNotMatch(after, /enabled = true/);
});

test('a header with a trailing comment is still a group header (slot count stays aligned)', () => {
  // The group counter matched `[[hooks.UserPromptSubmit]]  # policy` but the group
  // walker required an exact line, so the walker saw one group fewer and our
  // rewrite took — and overwrote — the user's trust slot 0.
  const before = [
    '[[hooks.UserPromptSubmit]]  # policy',
    'hooks = [{ type = "command", command = "policy.sh" }]',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /old/scrooge/codex-activate.mjs" }]',
    '',
    '[hooks.state."K:user_prompt_submit:0:0"]',
    'trusted_hash = "sha256:user"',
    'enabled = true',
    '',
    '[hooks.state."K:user_prompt_submit:1:0"]  # scrooge',
    'trusted_hash = "sha256:old"',
    'enabled = true',
    '',
  ].join('\n');
  const command = 'node "/new/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(before, command, 'K');

  assert.deepEqual(duplicateTableHeaders(after), []);
  assert.match(after, /user_prompt_submit:0:0"\]\ntrusted_hash = "sha256:user"/);
  assert.match(after, new RegExp(`user_prompt_submit:1:0"\\]\\ntrusted_hash = "${codexHookHash(command)}"`));
  assert.doesNotMatch(after, /sha256:old/);
});

test('a trailing comment on a later trust header still shifts down on removal', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /x/scrooge/codex-activate.mjs" }]',
    '',
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "echo user" }]',
    '',
    '[hooks.state."K:user_prompt_submit:0:0"]',
    'trusted_hash = "sha256:ours"',
    '',
    '[hooks.state."K:user_prompt_submit:1:0"]  # mine',
    'trusted_hash = "sha256:user"',
    '',
  ].join('\n');
  const after = removeCodexHookConfig(before, 'K');

  assert.match(after, /user_prompt_submit:0:0"\]  # mine\ntrusted_hash = "sha256:user"/);
  assert.doesNotMatch(after, /sha256:ours/);
});

test('comment lines heading the next section survive a scrooge group rewrite or removal', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /old/scrooge/codex-activate.mjs" }]',
    '',
    '# --- notifications (mine) ---',
    '[notify]',
    'x = 1',
    '',
  ].join('\n');
  assert.match(removeCodexHookConfig(before, 'K'), /# --- notifications \(mine\) ---\n\[notify\]/);
  assert.match(
    mergeCodexHookConfig(before, 'node "/new/scrooge/codex-activate.mjs"', 'K'),
    /# --- notifications \(mine\) ---\n\[notify\]/
  );
});

// TOML allows whitespace inside header brackets and around the dots. A matcher
// that compares the exact `[[hooks.UserPromptSubmit]]` text misses the spaced
// form, so the group count runs short and our slot lands on the user's trust key.
test('a header with spaces inside the brackets is still a group header (slot count stays aligned)', () => {
  const before = [
    '[[ hooks.UserPromptSubmit ]]',
    'hooks = [{ type = "command", command = "policy.sh" }]',
    '',
    '[[ hooks . UserPromptSubmit ]]',
    'hooks = [{ type = "command", command = "node /old/scrooge/codex-activate.mjs" }]',
    '',
    '[ hooks.state."K:user_prompt_submit:0:0" ]',
    'trusted_hash = "sha256:user"',
    'enabled = true',
    '',
    '[ hooks.state."K:user_prompt_submit:1:0" ]',
    'trusted_hash = "sha256:old"',
    'enabled = true',
    '',
  ].join('\n');
  const command = 'node "/new/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(before, command, 'K');

  assert.equal(after.match(/user_prompt_submit:1:0"\s*\]/g).length, 1, 'one trust table at our slot');
  assert.match(after, /user_prompt_submit:0:0" \]\ntrusted_hash = "sha256:user"/);
  assert.match(after, new RegExp(`user_prompt_submit:1:0"\\]\\ntrusted_hash = "${codexHookHash(command)}"`));
  assert.doesNotMatch(after, /sha256:old|\/old\/scrooge/);
  assert.equal(mergeCodexHookConfig(after, command, 'K'), after, 're-run must be a stable no-op');
});

test('a spaced user group counts toward the slot of a newly appended scrooge group', () => {
  const before = [
    '[[ hooks.UserPromptSubmit ]]',
    'hooks = [{ type = "command", command = "policy.sh" }]',
    '',
    '[ hooks.state."K:user_prompt_submit:0:0" ]',
    'trusted_hash = "sha256:user"',
    '',
  ].join('\n');
  const command = 'node "/new/scrooge/codex-activate.mjs"';
  const after = mergeCodexHookConfig(before, command, 'K');

  assert.ok(after.indexOf('policy.sh') < after.indexOf('codex-activate.mjs'), 'user group keeps index 0');
  assert.match(after, /user_prompt_submit:0:0" \]\ntrusted_hash = "sha256:user"/);
  assert.match(after, new RegExp(`user_prompt_submit:1:0"\\]\\ntrusted_hash = "${codexHookHash(command)}"`));
  assert.equal(mergeCodexHookConfig(after, command, 'K'), after, 're-run must be a stable no-op');
});

test('a spaced trust header still shifts down on removal, keeping its comment', () => {
  const before = [
    '[[hooks.UserPromptSubmit]]',
    'hooks = [{ type = "command", command = "node /x/scrooge/codex-activate.mjs" }]',
    '',
    '[[ hooks.UserPromptSubmit ]]',
    'hooks = [{ type = "command", command = "echo user" }]',
    '',
    '[ hooks.state."K:user_prompt_submit:0:0" ]',
    'trusted_hash = "sha256:ours"',
    '',
    '[ hooks.state."K:user_prompt_submit:1:0" ]  # mine',
    'trusted_hash = "sha256:user"',
    '',
  ].join('\n');
  const after = removeCodexHookConfig(before, 'K');

  assert.match(after, /user_prompt_submit:0:0"\]  # mine\ntrusted_hash = "sha256:user"/);
  assert.doesNotMatch(after, /sha256:ours|codex-activate/);
});

// ── Codex wrapper owns its state dir (S3-8) ───────────────────────────────────
test('Codex wrapper keeps state under the Codex dir even when CLAUDE_CONFIG_DIR is set', () => {
  // Codex inherits the shell env. Honouring an exported CLAUDE_CONFIG_DIR made
  // Codex read and write a Claude profile — `/scrooge off` in Codex cleared
  // Claude's global default.
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-codexhome-'));
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-claudehome-'));
  const pluginRoot = path.join(path.dirname(INSTALL_JS), '..', 'plugin');
  const wrapper = installCodexPayload(pluginRoot, path.join(codexHome, 'scrooge'), { dryRun: false });
  const r = spawnSync(process.execPath, [wrapper], {
    input: JSON.stringify({ session_id: 'codex-iso', prompt: '/scrooge ko' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  const claudeTouched = fs.existsSync(path.join(claudeHome, '.scrooge'));
  const codexWritten = fs.existsSync(path.join(codexHome, '.scrooge'));
  fs.rmSync(codexHome, { recursive: true, force: true });
  fs.rmSync(claudeHome, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(claudeTouched, false, 'Codex wrote into the Claude config dir');
  assert.equal(codexWritten, true, 'Codex state not under the Codex dir');
});

// ── Installer CLI: --config-dir, uninstall scope, payload failures ────────────
const posixOnly = { skip: process.platform === 'win32' ? 'sh shim / PATH override are POSIX-only here' : false };

function runInstaller(args, env) {
  return spawnSync(process.execPath, [INSTALL_JS, ...args], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, ...env },
  });
}

test('--config-dir reaches every `claude` subprocess as CLAUDE_CONFIG_DIR (S3-9)', posixOnly, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-cfgdir-'));
  const bin = path.join(tmp, 'bin');
  const cfg = path.join(tmp, 'profile');
  const log = path.join(tmp, 'claude.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'%s|%s\\n\' "$CLAUDE_CONFIG_DIR" "$*" >> "$SCROOGE_FAKE_LOG"\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const r = runInstaller(['--only', 'claude', '--config-dir', cfg], {
    PATH: `${bin}:/usr/bin:/bin`,
    CLAUDE_CONFIG_DIR: path.join(tmp, 'decoy'),
    SCROOGE_FAKE_LOG: log,
  });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(calls.some((c) => c.includes('plugin install')), calls.join('\n'));
  for (const c of calls) assert.ok(c.startsWith(`${cfg}|`), `claude ran without --config-dir: ${c}`);
});

test('--uninstall refuses --only instead of silently uninstalling everything (S3-10)', () => {
  const r = runInstaller(['-u', '--only', 'claude', '--dry-run'], {});
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /--uninstall.*--only|--only.*--uninstall/);
  assert.doesNotMatch(r.stdout, /scrooge uninstall/);
});

function uninstallWithStatusLine(statusLine) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-uninst-'));
  const cfg = path.join(tmp, 'claude');
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(cfg);
  fs.mkdirSync(empty);
  const script = path.join(cfg, 'hooks', 'scrooge-statusline.sh');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, '#!/bin/sh\n');
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ statusLine: statusLine(script) }, null, 2));
  const r = runInstaller(['-u', '--config-dir', cfg], { PATH: empty, CODEX_HOME: path.join(tmp, 'codex') });
  const settings = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  const scriptKept = fs.existsSync(script);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { r, settings, scriptKept };
}

test('uninstall removes the statusLine it wrote, verbatim', posixOnly, () => {
  const { r, settings, scriptKept } = uninstallWithStatusLine((s) => ({ type: 'command', command: `bash "${s}"` }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(settings.statusLine, undefined);
  assert.equal(scriptKept, false);
});

test('uninstall keeps a customized statusLine that merely mentions scrooge-statusline', posixOnly, () => {
  const custom = (s) => ({ type: 'command', command: `bash "${s}"; ~/bin/my-git-status.sh` });
  const { r, settings, scriptKept } = uninstallWithStatusLine(custom);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(settings.statusLine?.type, 'command', 'customized statusLine was deleted');
  assert.match(settings.statusLine.command, /my-git-status/);
  assert.match(r.stdout, /NOTE: .*statusLine/);
  assert.equal(scriptKept, true, 'the kept statusLine now calls a deleted script');
});

test('a Codex payload copy failure is recorded and the run still finishes (S3-11)', posixOnly, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-payload-'));
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(tmp, 'scrooge'), 'not a directory'); // payload dir is a file
  const r = runInstaller(['--only', 'codex'], { PATH: empty, CODEX_HOME: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.match(r.stdout, /Codex hook wiring failed/, r.stderr);
  assert.match(r.stdout, /failed \[.*codex-hook.*\]/);
  assert.equal(r.status, 1, r.stderr);
});
