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
  DEFAULT_STATE,
  readState,
  writeState,
  clearState,
  getStatePath,
} from './scrooge-config.js';

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

function resolveRulePath(repoRoot, lang, dial) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'registry.json'), 'utf8'));
    const rel = reg && reg[lang] && reg[lang][dial];
    if (typeof rel !== 'string') return null;
    return path.join(repoRoot, rel);
  } catch (e) {
    return null;
  }
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
// Returns { action: 'off' } | { action: 'set', lang?, dial?, bare } | null.
// null means "no recognized command this turn" (including unknown args — leave
// state untouched, matching caveman's no-silent-overwrite behavior).
function parseCommand(prompt) {
  const m = /^\/scrooge(?:\s+(.*))?$/i.exec((prompt || '').trim());
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
  if (!lang && !dial) return null; // unknown args — no state change
  return { action: 'set', lang, dial, bare: false };
}

function buildReminder(lang, dial) {
  if (lang === 'ko') {
    const body =
      dial === 'full'
        ? '개조식·음슴체(~함/~됨), 의미 명확 시 조사 드롭, 존대 제거. '
        : '다듬은 존댓말, filler·빈 인사·hedging 드롭, 완전문. ';
    return (
      `SCROOGE 활성 (ko/${dial}). ` +
      body +
      'code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose.'
    );
  }
  const body =
    dial === 'full'
      ? 'Drop articles/filler/pleasantries, fragments OK, short synonyms. '
      : 'Drop filler/pleasantry/hedging, keep grammar + articles. ';
  return (
    `SCROOGE active (en/${dial}). ` +
    body +
    'Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.'
  );
}

function buildFullInjection(lang, dial, ruleBody) {
  return (
    `SCROOGE MODE ACTIVE — ${lang}/${dial}. Apply this register to every ` +
    `response until the mode changes or the session ends:\n\n${ruleBody}`
  );
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

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const prompt = data.prompt || '';
    const statePath = getStatePath();

    // /scrooge-stats — intercept, run the stats script, and block the prompt,
    // returning its output as the reason. transcript_path is passed so stats
    // reads the active session, not whichever JSONL changed most recently.
    if (/^\/scrooge(?::scrooge)?-stats(?:\s|$)/i.test(prompt.trim())) {
      try {
        const argv = [path.join(HERE, 'scrooge-stats.js')];
        if (data.transcript_path) argv.push('--session-file', data.transcript_path);
        if (/\s--share(?:\s|$)/.test(prompt)) argv.push('--share');
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

    const cmd = parseCommand(prompt);

    if (cmd && cmd.action === 'off') {
      clearState(statePath);
      return; // deactivated — inject nothing
    }

    if (cmd && cmd.action === 'set') {
      const base = readState(statePath) || DEFAULT_STATE;
      const lang = cmd.bare ? base.lang : cmd.lang || base.lang;
      const dial = cmd.bare ? 'full' : cmd.dial || base.dial;
      const next = { lang, dial };
      writeState(next, statePath);

      // Activation/change turn → inject the full rule body.
      const root = resolveRepoRoot();
      const rulePath = resolveRulePath(root, next.lang, next.dial);
      const body = rulePath ? readRuleBody(rulePath) : null;
      emit(body ? buildFullInjection(next.lang, next.dial, body) : buildReminder(next.lang, next.dial));
      return;
    }

    // No command this turn — reinforce the active mode with a reminder.
    const state = readState(statePath);
    if (state) emit(buildReminder(state.lang, state.dial));
  } catch (e) {
    // Silent fail — never break prompt submission.
  }
});
