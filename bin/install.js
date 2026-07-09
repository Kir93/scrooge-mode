#!/usr/bin/env node
// scrooge — multi-agent installer.
//
// Detects installed AI coding agents and installs Scrooge into each:
//   - Claude Code  → `claude plugin marketplace add` + `plugin install`
//                    (the plugin manifest wires the UserPromptSubmit hook);
//                    the statusline badge is copied + registered in settings.json.
//   - Codex       → `npx skills add <repo> -a codex` + user-level
//                   `~/.codex/config.toml` UserPromptSubmit hook.
//   - Others      → `npx skills add <repo> -a <profile>` (skill-only).
// Undetected agents are skipped without error.
//
// Distribution:
//   local clone:  node bin/install.js [flags]
//   curl|bash:    install.sh shim → npx -y github:Kir93/scrooge-mode -- [flags]
//
// Pure Node stdlib, zero runtime deps. ESM (package.json "type": "module").
//
// NOTE: `claude plugin install` / `npx skills add` resolve against the PUBLISHED
// artifacts (npm + GitHub release). Use --dry-run to inspect actions without
// installing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import child_process from 'node:child_process';
import crypto from 'node:crypto';

const REPO = 'Kir93/scrooge-mode';
const PLUGIN = 'scrooge'; // used as BOTH plugin and marketplace name → install target `scrooge@scrooge` (line below). Task 6's .claude-plugin/marketplace.json MUST set name: "scrooge" or this target won't resolve.
const PACKAGE_NAME = 'scrooge-mode'; // npm package name in package.json; used by self-install guard to detect "running inside our own clone".
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_HOOK_STATUS = 'Tracking scrooge mode...';

// ── Provider matrix ─────────────────────────────────────────────────────────
// `soft: true` = best-effort probe; excluded from auto-detect, opt-in via --only.
const PROVIDERS = [
  { id: 'claude', label: 'Claude Code', mech: 'claude plugin install', detect: 'command:claude' },
  { id: 'codex', label: 'Codex CLI', mech: 'npx skills add (codex)', detect: 'command:codex', profile: 'codex' },
  { id: 'cursor', label: 'Cursor', mech: 'npx skills add (cursor)', detect: 'command:cursor||macapp:Cursor', profile: 'cursor' },
  { id: 'windsurf', label: 'Windsurf', mech: 'npx skills add (windsurf)', detect: 'command:windsurf||macapp:Windsurf', profile: 'windsurf' },
  { id: 'cline', label: 'Cline', mech: 'npx skills add (cline)', detect: 'vscode-ext:cline', profile: 'cline' },
  { id: 'continue', label: 'Continue', mech: 'npx skills add (continue)', detect: 'vscode-ext:continue', profile: 'continue' },
  { id: 'gemini', label: 'Gemini CLI', mech: 'npx skills add (gemini-cli)', detect: 'command:gemini', profile: 'gemini-cli', soft: true },
];

// ── Args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { dryRun: false, force: false, uninstall: false, listOnly: false, help: false, version: false, only: [], configDir: null, tag: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run': o.dryRun = true; break;
      case '--force': o.force = true; break;
      case '-u': case '--uninstall': o.uninstall = true; break;
      case '--list': o.listOnly = true; break;
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '--': break;
      case '--only': {
        const v = argv[++i];
        if (!v) die('error: --only requires an agent id');
        o.only.push(v);
        break;
      }
      case '--tag': case '--ref': {
        const v = argv[++i];
        if (!v || v.startsWith('--')) die('error: --tag requires a git ref (e.g. v0.7.0)');
        o.tag = v;
        break;
      }
      case '--config-dir': {
        const v = argv[++i];
        if (!v || v.startsWith('--')) die('error: --config-dir requires a path');
        o.configDir = expandHome(v);
        break;
      }
      default: die(`error: unknown flag: ${a}\nrun 'scrooge --help' for usage`);
    }
  }
  if (o.only.length) {
    const known = new Set(PROVIDERS.map((p) => p.id));
    for (const id of o.only) if (!known.has(id)) die(`error: unknown agent: ${id}\n  see --list`);
  }
  return o;
}

function die(msg) { process.stderr.write(msg + '\n'); process.exit(2); }
function expandHome(p) { return p.replace(/^~(?=$|\/)/, os.homedir()).replace(/^\$HOME/, os.homedir()); }

// ── Detection ───────────────────────────────────────────────────────────────
const IS_WIN = process.platform === 'win32';

function hasCmd(cmd) {
  try {
    const probe = IS_WIN ? ['where', [cmd]] : ['sh', ['-c', `command -v '${cmd.replace(/'/g, "'\\''")}'`]];
    return child_process.spawnSync(probe[0], probe[1], { stdio: 'ignore' }).status === 0;
  } catch (_) { return false; }
}

function macAppPresent(name) {
  if (process.platform !== 'darwin') return false;
  return [`/Applications/${name}.app`, path.join(os.homedir(), 'Applications', `${name}.app`)].some((p) => safeExists(p));
}

function vscodeExtPresent(needle) {
  const re = new RegExp(needle, 'i');
  const roots = ['.vscode/extensions', '.vscode-server/extensions', '.cursor/extensions', '.windsurf/extensions'].map((r) => path.join(os.homedir(), r));
  for (const r of roots) {
    let entries;
    try { entries = fs.readdirSync(r); } catch (_) { continue; }
    if (entries.some((e) => re.test(e))) return true;
  }
  return false;
}

function safeExists(p) { try { return fs.existsSync(p); } catch (_) { return false; } }

// Probe table keyed by clause kind. Exposed as a default so tests can inject
// deterministic stubs in place of the real OS probes.
const DEFAULT_PROBES = {
  command: hasCmd,
  macapp: macAppPresent,
  'vscode-ext': vscodeExtPresent,
  dir: safeExists,
};

export function detectMatch(spec, probes = DEFAULT_PROBES) {
  if (!spec) return false;
  for (const clause of spec.split('||')) {
    const c = clause.trim();
    if (!c) continue;
    const i = c.indexOf(':');
    const kind = i === -1 ? c : c.slice(0, i);
    const val = i === -1 ? '' : expandHome(c.slice(i + 1));
    // Object.hasOwn guard: a plain-object probe table would otherwise leak
    // Object.prototype members (constructor/toString → truthy, __proto__ →
    // throw) for kinds the table doesn't define. Unknown kinds must be false.
    const probe = Object.hasOwn(probes, kind) ? probes[kind] : undefined;
    if (probe && probe(val)) return true;
  }
  return false;
}

// ── Run helpers ─────────────────────────────────────────────────────────────
function run(cmd, args, dry) {
  if (dry) { process.stdout.write(`  would run: ${cmd} ${args.join(' ')}\n`); return { status: 0 }; }
  process.stdout.write(`  $ ${cmd} ${args.join(' ')}\n`);
  if (IS_WIN) return child_process.spawnSync(`${cmd} ${args.join(' ')}`, [], { shell: true, stdio: 'inherit' });
  return child_process.spawnSync(cmd, args, { stdio: 'inherit' });
}

function capture(cmd, args) {
  try { return child_process.spawnSync(cmd, args, { encoding: 'utf8' }); }
  catch (_) { return { status: 1, stdout: '', stderr: '' }; }
}

function repoRoot() {
  const root = path.resolve(HERE, '..');
  return safeExists(path.join(root, 'registry.json')) && safeExists(path.join(root, 'hooks')) ? root : null;
}

// Walk up from cwd looking for a package.json whose `name` matches PACKAGE_NAME.
// Used to detect "user is running the installer from inside the scrooge clone
// itself" — `npx skills add` would otherwise clobber the tracked source layout
// (regular `skills/<name>/SKILL.md` files get replaced by symlinks pointing at
// a new `.agents/skills/<name>/`). Returns the matching root or null.
export function findOwnRepoRoot(startDir, pkgName = PACKAGE_NAME) {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (safeExists(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === pkgName) return dir;
      } catch (_) { /* unparseable package.json — keep walking */ }
    }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function configDir(opts) {
  return opts.configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function codexDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function quoteCmd(s) {
  if (IS_WIN) return `"${String(s).replace(/"/g, '\\"')}"`;
  return `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
}

// ── Claude install ──────────────────────────────────────────────────────────
// The repo spec passed to the marketplace / skills CLIs. With --tag it pins to a
// git ref (`Kir93/scrooge-mode#v0.7.0`); npm-resolved channels honor the ref, and
// the curl|bash path pins directly via `npx -y github:<repo>#<ref>`. A CLI that
// does not parse a ref will reject it — --tag is opt-in, so an unpinned install is
// unaffected. See INSTALL.md for the per-channel pinning matrix.
function repoSpec(opts) {
  return opts.tag ? `${REPO}#${opts.tag}` : REPO;
}

// Remove Scrooge state/suffix files in a config dir, across both generations:
// the current `.scrooge/` subdir (sessions/ markers, global, suffix) and any
// legacy root-level `.scrooge-active*` / suffix dotfiles from an older install.
// Deliberately KEEPS `.scrooge/{default,version,history.jsonl}` — user
// preference and lifetime stats survive a reinstall, matching the legacy
// behavior of leaving `.scrooge-default` and friends in place. unlinkSync/rmSync
// remove a symlink itself rather than following it.
function removeStateFiles(dir, opts) {
  const sub = path.join(dir, '.scrooge');
  const subTargets = [path.join(sub, 'sessions'), path.join(sub, 'global'), path.join(sub, 'suffix'), path.join(sub, 'update')];
  for (const p of subTargets) {
    if (!safeExists(p)) continue;
    if (opts.dryRun) { process.stdout.write(`  would remove ${p}\n`); continue; }
    try { fs.rmSync(p, { recursive: true, force: true }); process.stdout.write(`  removed ${p}\n`); } catch (_) {}
  }
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const name of names) {
    const isState = name === '.scrooge-active' || name.startsWith('.scrooge-active-');
    const isSuffix =
      name === '.scrooge-statusline-suffix' || name.startsWith('.scrooge-statusline-suffix-');
    if (!isState && !isSuffix) continue;
    const p = path.join(dir, name);
    if (opts.dryRun) { process.stdout.write(`  would remove ${p}\n`); continue; }
    try { fs.unlinkSync(p); process.stdout.write(`  removed ${p}\n`); } catch (_) {}
  }
}

// Re-run on an already-installed plugin is an update, not a skip ("safe to
// re-run"). Both legs use the native CLI verified present in `claude plugin
// --help`. No --tag (latest): `marketplace update` refreshes the catalog from
// the marketplace's existing source, then `plugin update` applies the newest —
// no uninstall→install, so plugin enabled/disabled state and running-session
// hooks are left intact. `marketplace update` refreshes from the *existing*
// source and cannot re-pin, so a `--tag` pin re-points the marketplace (remove +
// add at the ref) and reinstalls. Pure planner → the command sequence is
// unit-testable without the live `claude` CLI.
export function claudeUpdatePlan(opts) {
  const target = `${PLUGIN}@${PLUGIN}`;
  if (opts.tag) {
    return [
      ['claude', ['plugin', 'marketplace', 'remove', PLUGIN]],
      ['claude', ['plugin', 'marketplace', 'add', repoSpec(opts)]],
      ['claude', ['plugin', 'install', target]],
    ];
  }
  return [
    ['claude', ['plugin', 'marketplace', 'update', PLUGIN]],
    ['claude', ['plugin', 'update', target]],
  ];
}

// Decide the Claude action from install state. --force keeps its "always
// reinstall" meaning (the bypass for a future version-skip optimization); an
// already-installed plugin without --force updates; anything else is a fresh
// install.
export function claudeAction(opts, installed) {
  if (opts.force) return 'install';
  return installed ? 'update' : 'install';
}

function scroogePluginInstalled() {
  const r = capture('claude', ['plugin', 'list']);
  return (r.status || 0) === 0 && /scrooge/i.test(r.stdout || '');
}

function installClaude(opts, results) {
  results.detected++;
  process.stdout.write('→ Claude Code detected\n');

  const installed = opts.force ? false : scroogePluginInstalled();
  if (claudeAction(opts, installed) === 'update') {
    process.stdout.write(`  scrooge plugin already installed — ${opts.tag ? `re-pinning to ${opts.tag}` : 'updating to latest'}\n`);
    let ok = true;
    for (const [cmd, args] of claudeUpdatePlan(opts)) {
      if ((run(cmd, args, opts.dryRun).status || 0) !== 0) ok = false;
    }
    if (ok) results.updated.push('claude');
    else results.failed.push(['claude', 'claude plugin update failed']);
    wireStatusline(opts, results);
    process.stdout.write('\n');
    return;
  }

  const r1 = run('claude', ['plugin', 'marketplace', 'add', repoSpec(opts)], opts.dryRun);
  const r2 = run('claude', ['plugin', 'install', `${PLUGIN}@${PLUGIN}`], opts.dryRun);
  if ((r1.status || 0) === 0 && (r2.status || 0) === 0) results.installed.push('claude');
  else results.failed.push(['claude', 'claude plugin install failed']);

  wireStatusline(opts, results);
  process.stdout.write('\n');
}

// The plugin manifest wires the UserPromptSubmit hook, but Claude Code plugin
// manifests cannot declare a statusLine. Copy the badge script to the config
// dir and register it in settings.json — only when no statusLine exists yet, so
// we never clobber the user's own.
function wireStatusline(opts, results) {
  const root = repoRoot();
  if (!root) { process.stdout.write('  (statusline: run from a clone to install the badge)\n'); return; }
  const cfg = configDir(opts);
  const hooksDir = path.join(cfg, 'hooks');
  const src = path.join(root, 'hooks', 'scrooge-statusline.sh');
  const dest = path.join(hooksDir, 'scrooge-statusline.sh');
  const settingsPath = path.join(cfg, 'settings.json');

  if (opts.dryRun) {
    process.stdout.write(`  would copy ${src} → ${dest}\n  would set statusLine in ${settingsPath} (if absent)\n`);
    return;
  }
  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    let settings = {};
    if (safeExists(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
      catch (_) { process.stdout.write('  NOTE: settings.json unparseable — statusline not wired.\n'); return; }
    }
    if (!settings.statusLine) {
      const bak = settingsPath + '.bak';
      if (safeExists(settingsPath) && !safeExists(bak)) { try { fs.copyFileSync(settingsPath, bak); } catch (_) {} }
      settings.statusLine = { type: 'command', command: `bash "${dest}"` };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      process.stdout.write('  statusline badge configured.\n');
    } else {
      const cur = typeof settings.statusLine === 'string' ? settings.statusLine : settings.statusLine.command || '';
      process.stdout.write(cur.includes('scrooge-statusline') ? '  statusline already configured.\n'
        : '  NOTE: existing statusline detected — scrooge badge NOT added.\n');
    }
  } catch (e) {
    process.stdout.write(`  statusline wiring failed: ${e.message}\n`);
  }
}

// ── Skills install (Codex + others) ─────────────────────────────────────────
function installViaSkills(prov, opts, results) {
  results.detected++;
  process.stdout.write(`→ ${prov.label} detected\n`);
  if (!opts.dryRun && !hasCmd('npx')) {
    process.stdout.write('  npx not found — install Node.js to use the skills ecosystem. Skipping.\n\n');
    results.failed.push([prov.id, 'npx absent']);
    return;
  }
  // Self-install guard: when invoked from inside the scrooge clone itself,
  // `npx skills add` would rewrite our tracked source layout (regular
  // `skills/<name>/SKILL.md` files become symlinks to a new `.agents/skills/`
  // tree). Skip the skills CLI call here — the source already IS the canonical
  // layout, and the Claude install path above doesn't need this step.
  const ownRoot = findOwnRepoRoot(process.cwd());
  if (ownRoot) {
    process.stdout.write(`  skipped: running inside the scrooge clone (${ownRoot}).\n`);
    process.stdout.write('    To install into a separate target dir, cd elsewhere first.\n\n');
    results.skipped.push([prov.id, 'inside own repo']);
    return;
  }
  // --yes --all: no-TTY curl|bash can't drive the skills selection UI.
  // -g (global): always install under the agent's user-level dir; the
  // skills ecosystem default of project scope drops `.agents/` + a lock file
  // into cwd, which we never want for scrooge.
  const r = run('npx', ['-y', 'skills', 'add', repoSpec(opts), '-a', prov.profile, '-g', '--yes', '--all'], opts.dryRun);
  if ((r.status || 0) === 0) results.installed.push(prov.id);
  else results.failed.push([prov.id, `npx skills add (${prov.profile}) failed`]);
  process.stdout.write('\n');
}

// ── Codex hook install ─────────────────────────────────────────────────────
function installCodex(prov, opts, results) {
  installViaSkills(prov, opts, results);
  wireCodexHook(opts, results);
}

function codexPayloadRoot() {
  return path.join(codexDir(), 'scrooge');
}

function codexWrapperBody() {
  return `#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.dirname(here);
process.env.SCROOGE_AGENT = 'codex';
await import('./hooks/scrooge-activate.js');
`;
}

function codexHookCommand(wrapperPath) {
  return `${quoteCmd(process.execPath)} ${quoteCmd(wrapperPath)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalJson(value[k])]));
  }
  return value;
}

export function codexHookHash(command) {
  const identity = {
    event_name: 'user_prompt_submit',
    hooks: [{ async: false, command, statusMessage: CODEX_HOOK_STATUS, timeout: 5, type: 'command' }],
  };
  const serialized = JSON.stringify(canonicalJson(identity));
  return 'sha256:' + crypto.createHash('sha256').update(serialized).digest('hex');
}

function normalizedPath(p) {
  try { return fs.realpathSync(p); } catch (_) {}
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch (_) {}
  return path.resolve(p);
}

function countUserPromptSubmitGroups(text) {
  return (String(text || '').match(/^\s*\[\[hooks\.UserPromptSubmit\]\]/gm) || []).length;
}

function removeHookStateBlock(text, stateKey) {
  if (!stateKey) return text;
  const lines = String(text || '').split(/\n/);
  const header = `[hooks.state.${JSON.stringify(stateKey)}]`;
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].trim() !== header) {
      out.push(lines[i++]);
      continue;
    }
    i++;
    while (i < lines.length && !/^\s*\[/.test(lines[i])) i++;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function isUserPromptSubmitHeader(line) {
  return String(line || '').trim() === '[[hooks.UserPromptSubmit]]';
}

function isUserPromptSubmitHooksHeader(line) {
  return String(line || '').trim() === '[[hooks.UserPromptSubmit.hooks]]';
}

function isTableHeader(line) {
  return /^\s*\[/.test(String(line || ''));
}

function collectUserPromptSubmitBlock(lines, start) {
  const block = [lines[start++]];
  while (start < lines.length) {
    const line = lines[start];
    if (isUserPromptSubmitHeader(line)) break;
    if (isTableHeader(line) && !isUserPromptSubmitHooksHeader(line)) break;
    block.push(line);
    start++;
  }
  return { block, next: start };
}

export function removeCodexHookConfig(text, keySource = null) {
  const lines = String(text || '').split(/\n/);
  const out = [];
  const removedStateKeys = [];
  let groupIndex = 0;
  for (let i = 0; i < lines.length;) {
    if (!isUserPromptSubmitHeader(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const { block, next } = collectUserPromptSubmitBlock(lines, i);
    i = next;
    const joined = block.join('\n');
    if (joined.includes('scrooge-activate.js') || joined.includes('codex-activate.mjs')) {
      if (keySource) removedStateKeys.push(`${keySource}:user_prompt_submit:${groupIndex}:0`);
      groupIndex++;
      continue;
    }
    out.push(...block);
    groupIndex++;
  }
  let nextText = out.join('\n');
  for (const stateKey of removedStateKeys) {
    nextText = removeHookStateBlock(nextText, stateKey);
  }
  return nextText.replace(/\n{3,}/g, '\n\n');
}

export function mergeCodexHookConfig(text, command, keySource = null) {
  let current = removeCodexHookConfig(text, keySource).replace(/\s*$/, '');
  const stateIdx = current.search(/^\[hooks\.state/m);
  const beforeState = stateIdx === -1 ? current : current.slice(0, stateIdx);
  const groupIndex = countUserPromptSubmitGroups(beforeState);
  const stateKey = keySource ? `${keySource}:user_prompt_submit:${groupIndex}:0` : null;
  current = removeHookStateBlock(current, stateKey).replace(/\s*$/, '');
  const block =
    `[[hooks.UserPromptSubmit]]\n` +
    `hooks = [\n` +
    `  { type = "command", command = ${JSON.stringify(command)}, timeout = 5, statusMessage = ${JSON.stringify(CODEX_HOOK_STATUS)} },\n` +
    `]\n`;
  const stateBlock = stateKey
    ? `\n[hooks.state.${JSON.stringify(stateKey)}]\ntrusted_hash = ${JSON.stringify(codexHookHash(command))}\nenabled = true\n`
    : '';
  const newStateIdx = current.search(/^\[hooks\.state/m);
  if (newStateIdx === -1) return `${current}${current ? '\n\n' : ''}${block}${stateBlock}`;
  const before = current.slice(0, newStateIdx).replace(/\s*$/, '');
  const after = current.slice(newStateIdx).replace(/^\s*/, '');
  return `${before}${before ? '\n\n' : ''}${block}\n${after}${stateBlock}`;
}

function installCodexPayload(root, dest, opts) {
  const wrapper = path.join(dest, 'codex-activate.mjs');
  if (opts.dryRun) {
    process.stdout.write(`  would copy Scrooge Codex hook payload to ${dest}\n`);
    return wrapper;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
  fs.copyFileSync(path.join(root, 'registry.json'), path.join(dest, 'registry.json'));
  copyDirRecursive(path.join(root, 'hooks'), path.join(dest, 'hooks'));
  copyDirRecursive(path.join(root, 'rules'), path.join(dest, 'rules'));
  copyDirRecursive(path.join(root, 'lib'), path.join(dest, 'lib'));
  fs.writeFileSync(wrapper, codexWrapperBody());
  try { fs.chmodSync(wrapper, 0o755); } catch (_) {}
  return wrapper;
}

function wireCodexHook(opts, results) {
  const root = repoRoot();
  if (!root) {
    process.stdout.write('  (codex hook: run from a package/clone that includes hooks, rules, lib, and registry.json)\n');
    results.failed.push(['codex-hook', 'missing package files']);
    return;
  }

  const cfg = codexDir();
  const payload = codexPayloadRoot();
  const configPath = path.join(cfg, 'config.toml');
  const wrapper = installCodexPayload(root, payload, opts);
  const command = codexHookCommand(wrapper);

  if (opts.dryRun) {
    process.stdout.write(`  would merge Scrooge UserPromptSubmit hook into ${configPath}\n`);
    results.installed.push('codex-hook');
    return;
  }

  try {
    fs.mkdirSync(cfg, { recursive: true });
    const before = safeExists(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    const after = mergeCodexHookConfig(before, command, normalizedPath(configPath));
    if (after !== before) {
      if (safeExists(configPath) && !safeExists(configPath + '.bak')) {
        try { fs.copyFileSync(configPath, configPath + '.bak'); } catch (_) {}
      }
      fs.writeFileSync(configPath, after + (after.endsWith('\n') ? '' : '\n'));
      process.stdout.write('  Codex user-level hook configured.\n');
      results.installed.push('codex-hook');
    } else {
      process.stdout.write('  Codex user-level hook already configured.\n');
      results.skipped.push(['codex-hook', 'already configured']);
    }
  } catch (e) {
    process.stdout.write(`  Codex hook wiring failed: ${e.message}\n`);
    results.failed.push(['codex-hook', e.message]);
  }
}

function unwireCodexHook(opts, results) {
  const cfg = codexDir();
  const configPath = path.join(cfg, 'config.toml');
  const payload = codexPayloadRoot();

  if (opts.dryRun) {
    process.stdout.write(`  would remove Scrooge Codex hook from ${configPath}\n`);
    process.stdout.write(`  would remove ${payload}\n`);
    return;
  }

  if (safeExists(configPath)) {
    try {
      const before = fs.readFileSync(configPath, 'utf8');
      const after = removeCodexHookConfig(before);
      if (after !== before) {
        fs.writeFileSync(configPath, after.replace(/\s*$/, '\n'));
        process.stdout.write('  removed Scrooge Codex hook from config.toml\n');
        results.removed.push('codex-hook');
      }
    } catch (e) {
      process.stdout.write(`  Codex hook removal failed: ${e.message}\n`);
    }
  }
  if (safeExists(payload)) {
    try {
      fs.rmSync(payload, { recursive: true, force: true });
      process.stdout.write(`  removed ${payload}\n`);
    } catch (_) {}
  }
  removeStateFiles(cfg, opts);
}

// ── Uninstall ───────────────────────────────────────────────────────────────
function uninstall(opts, results) {
  process.stdout.write('💰 scrooge uninstall\n');
  // Claude plugin + statusline
  if (hasCmd('claude')) {
    const probe = capture('claude', ['plugin', 'list']);
    if (probe.status === 0 && /scrooge/i.test(probe.stdout || '')) {
      run('claude', ['plugin', 'uninstall', `${PLUGIN}@${PLUGIN}`], opts.dryRun);
      results.removed.push('claude');
    } else process.stdout.write('  claude plugin not installed — skipping\n');
  }
  const cfg = configDir(opts);
  const settingsPath = path.join(cfg, 'settings.json');
  if (safeExists(settingsPath) && !opts.dryRun) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const cur = settings.statusLine && (typeof settings.statusLine === 'string' ? settings.statusLine : settings.statusLine.command || '');
      if (cur && cur.includes('scrooge-statusline')) { delete settings.statusLine; fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n'); process.stdout.write('  removed scrooge statusline from settings.json\n'); }
    } catch (_) {}
  }
  // Don't auto-delete the .bak: install only writes it when absent, so it may be
  // the user's pre-install snapshot. Point at it instead of risking data loss.
  const bakPath = settingsPath + '.bak';
  if (safeExists(bakPath)) process.stdout.write(`  NOTE: ${bakPath} kept (pre-install settings snapshot) — restore or delete it manually if unneeded.\n`);
  const statuslineScript = path.join(cfg, 'hooks', 'scrooge-statusline.sh');
  if (safeExists(statuslineScript) && !opts.dryRun) {
    try { fs.unlinkSync(statuslineScript); } catch (_) {}
    process.stdout.write(`  removed ${statuslineScript}\n`);
  }
  // Glob-remove state/suffix files, incl. per-session `.scrooge-active-<key>` (Task 5).
  removeStateFiles(cfg, opts);
  pruneClaudeSkillLeak(opts, results);
  unwireCodexHook(opts, results);
  process.stdout.write('\nuninstall done.\n');
  process.stdout.write('npx-skills installs (Codex/Cursor/etc.) — remove via that agent\'s skill manager.\n');
}

// ── Claude skill-leak prune ──────────────────────────────────────────────────
// The skills CLI (codex/cursor/etc. paths) symlinks each added skill into every
// globally-linked agent — so when the user's ~/.agents already links Claude, the
// plugin's skills leak into <config>/skills/ even though we target another agent.
// On Claude these run through the plugin's UserPromptSubmit hook; a competing
// user-level skill is redundant and, on hosts that route the trigger to the
// skill, shadows the plugin — `scrooge-stats` especially, where the leaked
// symlink breaks `/scrooge-stats`. When the Claude plugin is in play this run,
// drop those leaked symlinks — never a real directory we didn't create, and never
// the shared ~/.agents copy other agents still use. Array-based so a future
// plugin skill is covered by adding its name here.
const CLAUDE_SKILL_LEAK_NAMES = ['scrooge', 'scrooge-stats'];

export function pruneClaudeSkillLeak(opts, results) {
  const skillsDir = path.join(configDir(opts), 'skills');
  for (const name of CLAUDE_SKILL_LEAK_NAMES) {
    const leak = path.join(skillsDir, name);
    let st;
    try { st = fs.lstatSync(leak); } catch (_) { continue; } // absent → nothing to prune
    if (!st.isSymbolicLink()) continue; // a real dir we didn't create — leave it
    if (opts.dryRun) { process.stdout.write(`  would remove redundant Claude-scope ${name} skill ${leak}\n`); continue; }
    try {
      try {
        fs.unlinkSync(leak);
      } catch (e) {
        // Windows rejects unlink on a directory symlink/junction (EPERM/EISDIR);
        // rmdir removes the link itself without recursing into the target.
        if (IS_WIN && (e.code === 'EPERM' || e.code === 'EISDIR')) fs.rmdirSync(leak);
        else throw e;
      }
      process.stdout.write(`  removed redundant Claude-scope ${name} skill (plugin hook is canonical)\n`);
      results.removed.push('claude-skill-leak');
    } catch (e) {
      process.stdout.write(`  NOTE: could not remove ${leak}: ${e.message}\n`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }
  if (opts.version) { printVersion(); return; }

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) die(`scrooge: Node ${process.versions.node} too old. Need Node ≥18. https://nodejs.org`);

  if (opts.listOnly) {
    process.stdout.write('Supported agents:\n');
    for (const p of PROVIDERS) process.stdout.write(`  ${p.id.padEnd(10)} ${p.label}${p.soft ? '  (opt-in: --only ' + p.id + ')' : ''}\n`);
    return;
  }

  const results = { detected: 0, installed: [], updated: [], skipped: [], failed: [], removed: [] };

  if (opts.uninstall) { uninstall(opts, results); return; }

  const targets = opts.only.length
    ? PROVIDERS.filter((p) => opts.only.includes(p.id))
    : PROVIDERS.filter((p) => !p.soft && detectMatch(p.detect));

  if (targets.length === 0) {
    process.stdout.write('No supported agents detected. Use --only <id> to force, or --list.\n');
    return;
  }

  for (const p of targets) {
    if (!opts.only.length && !detectMatch(p.detect)) continue;
    if (p.id === 'claude') installClaude(opts, results);
    else if (p.id === 'codex') installCodex(p, opts, results);
    else installViaSkills(p, opts, results);
  }

  // Claude is served by the plugin hook, so a skill-CLI leak into its scope is
  // redundant — prune it, but only once the plugin is actually in place (installed
  // this run or already present). If the plugin install failed, leave the leak: it
  // is the one /scrooge surface left, and removing it would strand Claude entirely.
  const claudePluginPresent =
    results.installed.includes('claude') ||
    results.updated.includes('claude') ||
    results.skipped.some(([id]) => id === 'claude');
  if (claudePluginPresent) pruneClaudeSkillLeak(opts, results);

  process.stdout.write(`\nDone. detected ${results.detected}, installed [${results.installed.join(', ')}]`);
  if (results.updated.length) process.stdout.write(`, updated [${results.updated.join(', ')}]`);
  if (results.skipped.length) process.stdout.write(`, skipped ${results.skipped.length}`);
  if (results.failed.length) process.stdout.write(`, failed [${results.failed.map((f) => f[0]).join(', ')}]`);
  process.stdout.write('\n');
}

function printHelp() {
  process.stdout.write(`scrooge installer

Usage: node bin/install.js [flags]

Flags:
  --only <id>      install only the named agent (repeatable; allows soft agents)
  --tag,--ref <r>  pin the install to a git ref (e.g. v0.7.0); npx git-ref is the
                   guaranteed pin, marketplace/skills channels best-effort
  --list           list supported agents
  --uninstall,-u   remove scrooge from detected agents
  --dry-run        print actions without running them
  --force          reinstall even if already present
  --config-dir P   override Claude config dir (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --version,-v     print the installed version and check for a newer release
  --help,-h        this help
`);
}

// Installed version from the packaged manifest (one dir up from bin/install.js).
function installedVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch (_) { return null; }
}

// Numeric release-tuple compare — "0.18.0" > "0.9.0" (a string compare wouldn't).
// Pre-release suffixes are ignored; non-parseable input is not "newer".
function isNewerVersion(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10));
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(pa[i]) || !Number.isFinite(pb[i])) return false;
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

// Latest published release tag from GitHub ("v0.19.0" → "0.19.0"), or null on any
// failure (offline, rate-limited, pre-Node-18 without fetch). Best-effort only.
async function fetchLatestRelease() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'scrooge-mode', Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// On-demand version report: current + whether a newer release exists. The one
// blocking network call is fine here — the user asked for it explicitly (unlike
// the hooks, which must never fetch inline).
async function printVersion() {
  const cur = installedVersion();
  process.stdout.write(`scrooge ${cur ? 'v' + cur : '(unknown version)'}\n`);
  const latest = await fetchLatestRelease();
  if (!latest || !cur) return;
  if (isNewerVersion(latest, cur)) {
    process.stdout.write(`\nA newer release is available: v${latest}\n`);
    process.stdout.write(`Update: npx -y github:${REPO}\n`);
  } else {
    process.stdout.write(`You're on the latest release.\n`);
  }
}

// Run only when invoked as a CLI, not when imported by tests. Compare REAL
// paths: import.meta.url is symlink-resolved, so the npm `bin` symlink (and the
// curl|bash → npx shim) must be realpath'd too or main() would never fire.
let invokedAsCli = false;
try {
  invokedAsCli =
    !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch (_) {
  /* argv[1] not a real path → not a CLI invocation */
}
if (invokedAsCli) main();
