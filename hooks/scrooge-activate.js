#!/usr/bin/env node
// scrooge-activate.js — UserPromptSubmit hook.
//
// Parses /scrooge commands on two independent axes (language + dial), persists
// {lang, dial} via scrooge-config, and injects the active register's rule into
// the model context.
//
// Injection is two-stage:
//   - On an activation/change turn (the prompt held a recognized /scrooge
//     command), inject the FULL rule body, loaded from the registry.
//   - On every other turn while a mode is active, inject a lightweight reminder
//     so the register survives context drift / compression.
//
// Language is never hardcoded here: the rule path is resolved through
// registry.json. Adding a language = a registry entry + a rule file, no edit
// to this hook.
//
// Auto-clarity (security / irreversible-action escape) is carried by the rule
// text the model self-applies; this hook only injects that text and never
// inspects or forces the model's output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  VALID_LANGS,
  VALID_DIALS,
  VALID_FLAGS,
  DEFAULT_STATE,
  defaultFlags,
  readState,
  writeState,
  clearState,
  resolveActiveState,
  getStatePath,
  getDefaultPath,
  deriveSessionKey,
} from './scrooge-config.js';
import { parseNaturalActivation } from './nl-activation.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFF_TOKENS = new Set(['off', 'stop', 'disable']);

// Locate the repo root that holds registry.json + rules/. Tries the plugin
// root env first, then walks up from this hook's directory.
function resolveRepoRoot() {
  const candidates = [];
  if (process.env.CLAUDE_PLUGIN_ROOT) candidates.push(process.env.CLAUDE_PLUGIN_ROOT);
  for (const rel of ['..', '../..', '../../..']) candidates.push(path.join(HERE, rel));
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'registry.json'))) return c;
    } catch (e) {
      /* ignore */
    }
  }
  return path.join(HERE, '..'); // default; rule read may fail → reminder fallback
}

function loadRegistry(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'registry.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function resolveRulePath(repoRoot, lang, dial) {
  const reg = loadRegistry(repoRoot);
  const rel = reg && reg[lang] && reg[lang][dial];
  return typeof rel === 'string' ? path.join(repoRoot, rel) : null;
}

// Assemble the injected register body: base rule + each active flag's fragment,
// joined in order. Reads the registry once. Fragments are OPTIONAL — a flag with
// no registry mapping (e.g. set before its fragment file exists) or an unreadable
// fragment is skipped, so injection degrades to the base rule instead of failing.
// Fragment mapping shape is top-level `fragments[lang][flag]`, so the base
// `reg[lang][dial]` lookup and its lang→dial consumers stay intact.
function assembleRuleBody(repoRoot, lang, dial, flags = []) {
  const reg = loadRegistry(repoRoot);
  if (!reg) return null;
  const baseRel = reg[lang] && reg[lang][dial];
  if (typeof baseRel !== 'string') return null;
  const base = readRuleBody(path.join(repoRoot, baseRel));
  if (!base) return null;
  const fragMap = (reg.fragments && reg.fragments[lang]) || {};
  const parts = [base];
  for (const flag of flags) {
    const rel = fragMap[flag];
    if (typeof rel !== 'string') continue;
    const frag = readRuleBody(path.join(repoRoot, rel));
    if (frag) parts.push(frag);
  }
  return parts.join('\n\n');
}

function readRuleBody(rulePath) {
  try {
    const raw = fs.readFileSync(rulePath, 'utf8');
    // Strip the maintainer-facing HTML skeleton comments before injection.
    const body = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
    return body.length > 0 ? body : null;
  } catch (e) {
    return null;
  }
}

// Parse a /scrooge command from the prompt.
// Returns { action: 'off' }
//       | { action: 'set', lang?, dial?, addFlags, removeFlags, preset, bare }
//       | null.
// null means "no recognized command this turn" (every token unknown — leave
// state untouched, matching caveman's no-silent-overwrite behavior).
function parseCommand(prompt) {
  // `:scrooge` covers the plugin-namespaced invocation form (/scrooge:scrooge),
  // which some hosts pass through verbatim — matching the stats path below and
  // the reference caveman hook. Without it, namespaced activation never persists.
  const m = /^\/scrooge(?::scrooge)?(?:\s+(.*))?$/i.exec((prompt || '').trim());
  if (!m) return null;
  const args = (m[1] || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (args.length === 0) return { action: 'set', bare: true };
  if (args.some((a) => OFF_TOKENS.has(a))) return { action: 'off' };
  const lang = args.find((a) => VALID_LANGS.includes(a));
  const dial = args.find((a) => VALID_DIALS.includes(a));
  // Flags are an additive axis orthogonal to lang/dial: `lean`/`ctx` turn one on,
  // `nolean`/`noctx` turn one off, `max` is the preset for all flags. Unknown
  // tokens are ignored (not an error), mirroring the lang/dial scan above.
  const addFlags = [];
  const removeFlags = [];
  let preset = false;
  for (const a of args) {
    if (a === 'max') preset = true;
    else if (VALID_FLAGS.includes(a)) addFlags.push(a);
    else if (a.startsWith('no') && VALID_FLAGS.includes(a.slice(2))) {
      removeFlags.push(a.slice(2));
    }
  }
  // Every token unknown on every axis → no state change (e.g. `/scrooge bogus`).
  if (!lang && !dial && !preset && addFlags.length === 0 && removeFlags.length === 0) {
    return null;
  }
  return { action: 'set', lang, dial, addFlags, removeFlags, preset, bare: false };
}

// Compact per-flag behavior label for the high-frequency per-turn reminder. Each
// label mirrors its fragment heading; an unmapped flag degrades to its bare name.
// Keep ko/en in sync (bilingual parity).
const FLAG_HINT = {
  ko: { lean: 'lean(최소 코드)', ctx: 'ctx(컨텍스트 절약)' },
  en: { lean: 'lean (minimal code)', ctx: 'ctx (context economy)' },
};

function flagHints(lang, flags) {
  const map = FLAG_HINT[lang] || {};
  return flags.map((f) => map[f] || f);
}

// Per-turn reminder (the high-frequency injection). Each active flag is named
// with a compact behavior hint (flagHints) so the flag's intent — not just its
// label — survives context drift; the flag's FULL register still lives in its
// fragment, injected on the activation/SessionStart turn, not repeated here.
function buildReminder(lang, dial, flags = []) {
  if (lang === 'ko') {
    const body =
      dial === 'full'
        ? '개조식·음슴체(~함/~됨), 의미 명확 시 조사 드롭, 존대 제거. '
        : '다듬은 존댓말, filler·빈 인사·hedging 드롭, 완전문. ';
    return (
      `SCROOGE 활성 (ko/${dial}). ` +
      body +
      'code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose.' +
      (flags.length ? ` flag: ${flagHints('ko', flags).join('·')} 활성.` : '')
    );
  }
  const body =
    dial === 'full'
      ? 'Drop articles/filler/pleasantries, fragments OK, short synonyms. '
      : 'Drop filler/pleasantry/hedging, keep grammar + articles. ';
  return (
    `SCROOGE active (en/${dial}). ` +
    body +
    'Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.' +
    (flags.length ? ` Flags: ${flagHints('en', flags).join(', ')} active.` : '')
  );
}

function buildFullInjection(lang, dial, ruleBody) {
  return (
    `SCROOGE MODE ACTIVE — ${lang}/${dial}. Apply this register to every ` +
    `response until the mode changes or the session ends:\n\n${ruleBody}`
  );
}

// Deactivation countermand. Clearing the state file stops future reminders, but
// the model may still be mid-conversation in the compressed register — so on the
// off turn we actively tell it to return to normal prose. Localized to the
// register that was active when off fired.
function buildCountermand(lang) {
  if (lang === 'ko') {
    return 'SCROOGE OFF — 압축 모드 해제. 이번 턴부터 평소 register(일반 문체)로 복귀.';
  }
  return 'SCROOGE OFF — compression mode deactivated. Return to your normal register from this turn on.';
}

function parseStatsCommand(prompt) {
  const trimmed = (prompt || '').trim();
  const patterns = [
    /^\/scrooge(?::scrooge)?-stats(?<args>(?:\s+.*)?)$/i,
    /^\$scrooge-stats(?<args>(?:\s+.*)?)$/i,
    /^\[\$scrooge-stats\]\([^)]+\)(?<args>(?:\s+.*)?)$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const args = match.groups?.args || '';
    return { share: /\s--share(?:\s|$)/.test(` ${args.trim()}`) };
  }
  return null;
}

// Codex surfaces a hook's block reason to the user; Claude (especially in the
// editor) renders it invisibly. So we intercept the stats trigger only under
// Codex — on Claude the scrooge-stats skill runs the script and prints the
// figures as a normal, user-visible message instead. Detection mirrors
// scrooge-stats.js: explicit SCROOGE_AGENT wins, else a .codex config dir.
function isCodexAgent() {
  if (process.env.SCROOGE_AGENT) return process.env.SCROOGE_AGENT === 'codex';
  const dir = process.env.CLAUDE_CONFIG_DIR;
  return Boolean(dir && path.basename(dir) === '.codex');
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    })
  );
}

function handlePayload(data) {
  try {
    const prompt = data.prompt || '';
    // Session-scoped state: each Claude Code session keeps its own state file so
    // a `/scrooge off` in one session never clears another's. Sessionless hosts
    // (no session_id / transcript_path) resolve to the legacy global path.
    const sessionKey = deriveSessionKey(data);
    const statePath = getStatePath(sessionKey);

    // /scrooge-stats and Codex skill-link forms — under Codex, intercept, run
    // the stats script, and block the prompt, returning its output as the
    // reason. On Claude we let the prompt through so the scrooge-stats skill
    // surfaces the figures as a normal message (the block reason is not shown).
    // transcript_path is passed so stats reads the active session, not
    // whichever JSONL changed most recently.
    const statsCommand = parseStatsCommand(prompt);
    if (statsCommand && isCodexAgent()) {
      try {
        const argv = [path.join(HERE, 'scrooge-stats.js')];
        if (data.transcript_path) argv.push('--session-file', data.transcript_path);
        if (statsCommand.share) argv.push('--share');
        const out = execFileSync(process.execPath, argv, { encoding: 'utf8', timeout: 5000 });
        process.stdout.write(JSON.stringify({ decision: 'block', reason: out.trim() }));
      } catch (e) {
        process.stdout.write(
          JSON.stringify({
            decision: 'block',
            reason: 'scrooge-stats: 실행 실패 — node hooks/scrooge-stats.js 수동 실행.',
          })
        );
      }
      return;
    }

    // Slash command wins (SC 3.3); natural-language intent is the fallback when
    // the prompt holds no recognized /scrooge command. Both return the same
    // shape, so the set/off branches below handle either source uniformly.
    const cmd = parseCommand(prompt) || parseNaturalActivation(prompt);

    if (cmd && cmd.action === 'off') {
      // Read the effective register (per-session, else the global default) before
      // clearing so the countermand can be localized. `/scrooge off` is a GLOBAL
      // off: it clears this session AND the global default so no future session
      // auto-activates. Peer sessions keep their own per-session files (off never
      // touches them), so a concurrent worktree session is not yanked mid-run.
      // Only inject when a mode was actually active — nothing to counter otherwise.
      const prior = readState(statePath) || readState(getDefaultPath());
      clearState(statePath);
      // Accepted race: a concurrent activation in another session can write a new
      // default between the read above and this clear, which then removes it (the
      // global default fails to update). Rare and self-healing — re-run `/scrooge`.
      // A lock on this per-prompt hot path would cost more than the benign outcome.
      clearState(getDefaultPath());
      if (prior) emit(buildCountermand(prior.lang));
      return;
    }

    if (cmd && cmd.action === 'set') {
      // Base for the merge: the session's own state, else the global default
      // (so a change in a default-seeded session keeps the default's lang/flags),
      // else a fresh state whose flags come from SCROOGE_DEFAULT_FLAGS.
      const base =
        readState(statePath) ||
        readState(getDefaultPath()) ||
        { ...DEFAULT_STATE, flags: defaultFlags() };
      const lang = cmd.bare ? base.lang : cmd.lang || base.lang;
      const dial = cmd.bare ? 'full' : cmd.dial || base.dial;
      // Bare /scrooge is a reset-to-default gesture (dial→full), so flags reset
      // to the env default too — a stray bare toggle never leaves stale flags.
      // Any explicit arg takes the additive merge below and preserves flags.
      let flags;
      if (cmd.bare) {
        flags = defaultFlags();
      } else {
        const set = new Set(base.flags || []);
        if (cmd.preset) for (const f of VALID_FLAGS) set.add(f);
        for (const f of cmd.addFlags || []) set.add(f);
        for (const f of cmd.removeFlags || []) set.delete(f);
        flags = VALID_FLAGS.filter((f) => set.has(f));
      }
      const next = { lang, dial, flags };
      writeState(next, statePath);
      // Register the activation as the GLOBAL default so every new session
      // auto-activates with it (the "type once anywhere → on everywhere" gesture).
      // `/scrooge off` clears it again. The last /scrooge run anywhere wins.
      writeState(next, getDefaultPath());

      // Activation/change turn → inject the full rule body + active fragments.
      const root = resolveRepoRoot();
      const body = assembleRuleBody(root, next.lang, next.dial, next.flags);
      emit(
        body
          ? buildFullInjection(next.lang, next.dial, body)
          : buildReminder(next.lang, next.dial, next.flags)
      );
      return;
    }

    // No command this turn — reinforce the active mode with a reminder. Resolve
    // through the global default so a session that never explicitly activated
    // (but a default exists) still gets seeded + reminded.
    const state = resolveActiveState(statePath);
    if (state) emit(buildReminder(state.lang, state.dial, state.flags));
  } catch (e) {
    // Silent fail — never break prompt submission.
  }
}

// Read the hook's JSON payload from stdin, then dispatch.
function main() {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    let data;
    try {
      data = JSON.parse(input || '{}');
    } catch (e) {
      return; // malformed payload — never break prompt submission
    }
    handlePayload(data);
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

// Exported for reuse by the SessionStart hook, which re-injects the same full
// rule for an already-active session. Importing this module does NOT run the
// stdin handler — main() is gated on isMain — so the import has no side effects.
export { resolveRepoRoot, resolveRulePath, readRuleBody, buildFullInjection, assembleRuleBody };
