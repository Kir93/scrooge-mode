#!/usr/bin/env node
// scrooge — multi-agent installer.
//
// Detects installed AI coding agents and installs Scrooge into each:
//   - Claude Code  → `claude plugin marketplace add` + `plugin install`
//                    (the plugin manifest wires the UserPromptSubmit hook);
//                    the statusline badge is copied + registered in settings.json.
//   - Codex / others → `npx skills add <repo> -a <profile>` (skill-only).
// Undetected agents are skipped without error.
//
// Distribution:
//   local clone:  node bin/install.js [flags]
//   curl|bash:    install.sh shim → npx -y github:Kir93/scrooge-mode -- [flags]
//
// Pure Node stdlib, zero runtime deps. ESM (package.json "type": "module").
//
// NOTE: `claude plugin install` / `npx skills add` resolve against PUBLISHED
// artifacts (Task 6). Until publishing lands, use --dry-run to inspect actions.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import child_process from 'node:child_process';

const REPO = 'Kir93/scrooge-mode';
const PLUGIN = 'scrooge'; // used as BOTH plugin and marketplace name → install target `scrooge@scrooge` (line below). Task 6's .claude-plugin/marketplace.json MUST set name: "scrooge" or this target won't resolve.
const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  const o = { dryRun: false, force: false, uninstall: false, listOnly: false, help: false, only: [], configDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run': o.dryRun = true; break;
      case '--force': o.force = true; break;
      case '-u': case '--uninstall': o.uninstall = true; break;
      case '--list': o.listOnly = true; break;
      case '-h': case '--help': o.help = true; break;
      case '--': break;
      case '--only': {
        const v = argv[++i];
        if (!v) die('error: --only requires an agent id');
        o.only.push(v);
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

function configDir(opts) {
  return opts.configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// ── Claude install ──────────────────────────────────────────────────────────
function installClaude(opts, results) {
  results.detected++;
  process.stdout.write('→ Claude Code detected\n');

  if (!opts.force) {
    const r = capture('claude', ['plugin', 'list']);
    if (r.status === 0 && /scrooge/i.test(r.stdout || '')) {
      process.stdout.write('  scrooge plugin already installed (use --force to reinstall)\n\n');
      results.skipped.push(['claude', 'already installed']);
      wireStatusline(opts, results);
      return;
    }
  }
  const r1 = run('claude', ['plugin', 'marketplace', 'add', REPO], opts.dryRun);
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
  // --yes --all: no-TTY curl|bash can't drive the skills selection UI.
  const r = run('npx', ['-y', 'skills', 'add', REPO, '-a', prov.profile, '--yes', '--all'], opts.dryRun);
  if ((r.status || 0) === 0) results.installed.push(prov.id);
  else results.failed.push([prov.id, `npx skills add (${prov.profile}) failed`]);
  process.stdout.write('\n');
}

// ── Uninstall ───────────────────────────────────────────────────────────────
function uninstall(opts, results) {
  process.stdout.write('🪙 scrooge uninstall\n');
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
  for (const f of ['scrooge-statusline.sh', '.scrooge-active', '.scrooge-statusline-suffix']) {
    const p = f.startsWith('.') ? path.join(cfg, f) : path.join(cfg, 'hooks', f);
    if (safeExists(p) && !opts.dryRun) { try { fs.unlinkSync(p); } catch (_) {} process.stdout.write(`  removed ${p}\n`); }
  }
  process.stdout.write('\nuninstall done.\n');
  process.stdout.write('npx-skills installs (Codex/Cursor/etc.) — remove via that agent\'s skill manager.\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) die(`scrooge: Node ${process.versions.node} too old. Need Node ≥18. https://nodejs.org`);

  if (opts.listOnly) {
    process.stdout.write('Supported agents:\n');
    for (const p of PROVIDERS) process.stdout.write(`  ${p.id.padEnd(10)} ${p.label}${p.soft ? '  (opt-in: --only ' + p.id + ')' : ''}\n`);
    return;
  }

  const results = { detected: 0, installed: [], skipped: [], failed: [], removed: [] };

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
    else installViaSkills(p, opts, results);
  }

  process.stdout.write(`\nDone. detected ${results.detected}, installed [${results.installed.join(', ')}]`);
  if (results.skipped.length) process.stdout.write(`, skipped ${results.skipped.length}`);
  if (results.failed.length) process.stdout.write(`, failed [${results.failed.map((f) => f[0]).join(', ')}]`);
  process.stdout.write('\n');
}

function printHelp() {
  process.stdout.write(`scrooge installer

Usage: node bin/install.js [flags]

Flags:
  --only <id>     install only the named agent (repeatable; allows soft agents)
  --list          list supported agents
  --uninstall,-u  remove scrooge from detected agents
  --dry-run       print actions without running them
  --force         reinstall even if already present
  --config-dir P  override Claude config dir (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --help,-h       this help
`);
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
