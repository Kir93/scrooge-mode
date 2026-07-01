#!/usr/bin/env node
// scrooge-stats.js — read the active host-agent session log, print real output
// token usage plus (when benchmark data exists) an estimated savings figure.
//
// Run directly:    node hooks/scrooge-stats.js
// Inside Claude:   /scrooge-stats is intercepted by scrooge-activate.js, which
//                  runs this with --session-file <transcript_path> so we read
//                  the active session rather than the most-recently-modified one.
//
// Honesty: token counts are MEASURED from the session JSONL `usage` fields.
// Savings are a COUNTERFACTUAL ESTIMATE (what the same turns would have cost
// uncompressed), always labelled "(est)". Per-dial ratios come from the Task 5
// subscription benchmark; until that lands SAVINGS_RATIO is empty and we show
// raw tokens only — never a fabricated savings number.

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readState, writeSuffix, getStatePath, deriveSessionKey } from './scrooge-config.js';
import { readSession } from '../lib/session-log.js';
import { upsertSession, aggregateLedger, sinceToEpoch } from '../lib/ledger.js';
import { resolveRepoRoot, assembleRuleBody, buildFullInjection } from './scrooge-activate.js';

// Per-(lang, dial) mean output-token compression ratio vs the uncompressed
// baseline, register-only isolation: ko/full ~67%, en/full ~65% (N=24,
// claude-opus-4-7); ja/full ~63% (claude-opus-4-8, mean of N=15 tuning 0.567 /
// N=11 held-out 0.693; measured cwd-isolated so the normal baseline answers in
// Japanese, not host-CLAUDE.md Korean). hi/full ~66% (claude-opus-4-8, held-out
// N=11 per-prompt median 0.666, scrooge<normal 11/11; held-out only — no separate
// tuning corpus). zh/full ~63% (claude-opus-4-8, held-out N=11 per-prompt median
// 0.629, ratio-of-medians 0.668, scrooge<normal 11/11; zh-native register — not a
// KO port — held-out only). Only `full` is measured; `lite` has no benchmark yet,
// so it is omitted and lite sessions still show "estimate pending" rather than a
// fabricated number. Register-only isolation means real sessions may differ —
// hence the "(est)" label on every derived figure.
const SAVINGS_RATIO = {
  ko: { full: 0.67 },
  en: { full: 0.65 },
  ja: { full: 0.63 },
  hi: { full: 0.66 },
  zh: { full: 0.63 },
};

const SEP = '──────────────────────────────';

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

// Counterfactual estimate for one (lang, dial), or null when no benchmark ratio
// exists for that pair (e.g. any lite session, or a lang not yet benchmarked).
// The ratio is a prose-register figure, so it is applied to prose output tokens
// only — tool_use output (bash/edit/tool JSON) is not compressed by the register
// and must stay out of the savings base (ADR-003).
function deriveEstimate(proseOutputTokens, lang, dial) {
  const ratio =
    lang != null && dial != null ? SAVINGS_RATIO[lang]?.[dial] : undefined;
  if (ratio == null || ratio <= 0 || ratio >= 1) return null;
  const estNormal = Math.round(proseOutputTokens / (1 - ratio));
  return {
    estNormal,
    saved: estNormal - proseOutputTokens,
    pct: Math.round(ratio * 100),
  };
}

function shortPath(p) {
  if (!p) return '';
  return p.length > 48 ? '...' + p.slice(-48) : p;
}

// Rough char→token estimate (~4 chars/token). No tokenizer dependency — that
// would be a heavy dep for a rough receipt; everything derived from it is
// labelled "(est)", the same honesty discipline as SAVINGS_RATIO.
function estimateTokens(text) {
  return text ? Math.ceil(text.length / 4) : 0;
}

// Static self-injection overhead: the token cost of the register Scrooge injects
// for (lang, dial, flags), measured from the actual rule body length. This is a
// STATIC measure of injected context — never a runtime counterfactual (ADR-003 /
// lean-flags SC9). Counts the full injected register once per session; the small
// per-turn reminder is not separately billed. Returns 0 when inactive or the rule
// body cannot be read (degrades to no overhead rather than a fabricated number).
function selfOverheadTokens(state) {
  if (!state) return 0;
  try {
    const root = resolveRepoRoot();
    const body = assembleRuleBody(root, state.lang, state.dial, state.flags);
    if (!body) return 0;
    return estimateTokens(buildFullInjection(state.lang, state.dial, body, state.flags));
  } catch (e) {
    return 0;
  }
}

// Lifetime ledger block — accumulated savings across sessions, or a `--since`
// window. Empty when the ledger has no sessions yet.
function formatLedger(ledger, since) {
  if (!ledger || ledger.sessions === 0) return '';
  const label = since ? `Since ${since}` : 'Lifetime';
  let block =
    `${SEP}\n${label} (ledger):\n` +
    `Sessions:              ${ledger.sessions.toLocaleString()}\n` +
    `Output tokens saved:   ${ledger.savedTokens.toLocaleString()} (est, prose-only)\n`;
  if (ledger.inputSavedTokens > 0) {
    block += `Input tokens saved:    ${ledger.inputSavedTokens.toLocaleString()} (est)\n`;
    for (const [source, saved] of Object.entries(ledger.bySource)) {
      if (saved > 0) block += `  ${source}: ${saved.toLocaleString()}\n`;
    }
  }
  if (ledger.inputOverheadTokens > 0) {
    block += `Self overhead:         -${ledger.inputOverheadTokens.toLocaleString()} (est, static rule ctx)\n`;
  }
  if (ledger.inputSavedTokens > 0 || ledger.inputOverheadTokens > 0) {
    block += `Net tokens saved:      ${ledger.netSavedTokens.toLocaleString()} (est)\n`;
  }
  if (ledger.reasoningTokens > 0) {
    block += `Reasoning tokens:      ${ledger.reasoningTokens.toLocaleString()} (uncompressed, not a saving)\n`;
  }
  if (ledger.savedUsd > 0) {
    block += `Est. value saved:      ~$${ledger.savedUsd.toFixed(2)} (est, net)\n`;
  }
  return block;
}

// Pure formatter — split from main() so tests can pass synthetic inputs.
function formatStats({
  inputTokens = 0,
  outputTokens,
  proseOutputTokens = 0,
  toolUseOutputTokens = 0,
  reasoningOutputTokens = 0,
  inputOverheadTokens = 0,
  cacheReadTokens,
  turns,
  model,
  file,
  state,
  ledger = null,
  since = null,
}) {
  const head = `\nScrooge Stats\n${SEP}\n`;
  if (turns === 0) {
    return (
      head +
      'No conversation yet — stats available after the first response.\n' +
      SEP +
      '\n'
    );
  }

  const modeLabel = state ? `${state.lang}/${state.dial}` : 'inactive';
  const est = state
    ? deriveEstimate(proseOutputTokens, state.lang, state.dial)
    : null;

  let savings;
  let footer = '';
  if (!state) {
    savings = 'Scrooge inactive this session — no savings estimate.';
  } else if (est) {
    savings =
      `Est. without scrooge:  ${est.estNormal.toLocaleString()} (prose-only basis)\n` +
      `Est. tokens saved:     ${est.saved.toLocaleString()} (~${est.pct}%, est)`;
    footer = `Estimate from benchmarks/ (mean per-dial, ${modeLabel}); applied to prose output only — tool_use output excluded. Savings are counterfactual.`;
  } else {
    savings =
      `Savings estimate pending — no benchmark ratio for '${state.lang}/${state.dial}' yet.\n` +
      'Measured output tokens shown above; no estimate fabricated.';
  }

  // Self-injection overhead nets against this session's savings: Scrooge adds its
  // register to the input, so the honest bill subtracts that static cost. Shown
  // only when active and measurable.
  const overheadLine =
    state && inputOverheadTokens > 0
      ? `Self overhead (input): -${inputOverheadTokens.toLocaleString()} (est, static rule ctx)\n`
      : '';

  return (
    head +
    (file ? `Session:  ${shortPath(file)}\n` : '') +
    `Mode:     ${modeLabel}\n` +
    `Turns:    ${turns}\n${SEP}\n` +
    `Input tokens:          ${inputTokens.toLocaleString()} (measured)\n` +
    `Output tokens:         ${outputTokens.toLocaleString()}\n` +
    `  prose:               ${proseOutputTokens.toLocaleString()}\n` +
    `  tool_use:            ${toolUseOutputTokens.toLocaleString()}\n` +
    (reasoningOutputTokens > 0
      ? `  reasoning:           ${reasoningOutputTokens.toLocaleString()} (uncompressed)\n`
      : '') +
    `Cache-read tokens:     ${cacheReadTokens.toLocaleString()}\n${SEP}\n` +
    `${savings}\n` +
    overheadLine +
    (footer ? footer + '\n' : '') +
    formatLedger(ledger, since)
  );
}

function formatShare({ outputTokens, proseOutputTokens = 0, turns, state }) {
  if (turns === 0) return '💰 scrooge armed, no turns yet';
  const est = state
    ? deriveEstimate(proseOutputTokens, state.lang, state.dial)
    : null;
  if (est) {
    return `💰 saved ~${est.saved.toLocaleString()} prose output tokens (est) across ${turns} turns this session`;
  }
  return `💰 ${turns} turns, ${outputTokens.toLocaleString()} output tokens this session`;
}

// Pre-rendered statusline suffix: saved estimate when available, else raw output
// tokens while active, else empty (clears the badge suffix when inactive).
function suffixFor({ outputTokens, proseOutputTokens = 0, turns, state }) {
  if (!state || turns === 0) return '';
  const est = deriveEstimate(proseOutputTokens, state.lang, state.dial);
  if (est) return `⛏ ~${humanizeTokens(est.saved)} saved (est)`;
  return `⛏ ${humanizeTokens(outputTokens)} tok`;
}

function main() {
  const args = process.argv.slice(2);
  const sfIdx = args.indexOf('--session-file');
  const sessionFile = sfIdx !== -1 ? args[sfIdx + 1] : null;
  const share = args.includes('--share');
  const sinceIdx = args.indexOf('--since');
  const sinceArg = sinceIdx !== -1 ? args[sinceIdx + 1] || null : null;

  const defaultCodexDir =
    process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const configuredDir = process.env.CLAUDE_CONFIG_DIR;
  const agent =
    process.env.SCROOGE_AGENT ||
    (configuredDir && path.basename(configuredDir) === '.codex'
      ? 'codex'
      : 'claude');
  if (agent === 'codex' && !process.env.CLAUDE_CONFIG_DIR) {
    process.env.CLAUDE_CONFIG_DIR = defaultCodexDir;
  }
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const sess = readSession({
    agent,
    claudeDir,
    codexDir: defaultCodexDir,
    sessionFile,
  });
  // Session-scoped state: derive the canonical session key from the transcript
  // (its stem is the session_id, the same key the activation hook wrote under) so
  // stats reads the SAME state file the other surfaces use, not the global one.
  const sessionKey = deriveSessionKey({ transcript_path: sess.file });
  const state = readState(getStatePath(sessionKey));

  // Upsert this session into the lifetime ledger BEFORE aggregating, so the
  // total includes the current run. Upsert (not append) is keyed on sessionKey:
  // running /scrooge-stats N times in one session overwrites the one entry, never
  // double-counts. Skipped when sessionless or no turns yet.
  const est = state ? deriveEstimate(sess.proseOutputTokens, state.lang, state.dial) : null;
  const inputOverheadTokens = selfOverheadTokens(state);
  if (sessionKey && sess.turns > 0) {
    upsertSession({
      sessionId: sessionKey,
      model: sess.model,
      proseOutputTokens: sess.proseOutputTokens,
      savedTokens: est ? est.saved : 0,
      reasoningTokens: sess.reasoningOutputTokens,
      inputOverheadTokens,
      ts: Date.now(),
    });
  }
  const since = sinceArg ? sinceToEpoch(sinceArg, Date.now()) : null;
  const ledger = aggregateLedger({ since });
  const view = { ...sess, state, ledger, since: sinceArg, inputOverheadTokens };

  // Refresh the statusline suffix on every run, tagged "<sessionKey>:<text>" so a
  // statusline in a different (or fresh) session does not render a stale number.
  // The key is the sanitized transcript stem, matching the statusline's own
  // sanitized session_id — so the tag compare is exact across both surfaces.
  const text = suffixFor(view);
  writeSuffix(text && sessionKey ? `${sessionKey}:${text}` : '');

  process.stdout.write(share ? formatShare(view) + '\n' : formatStats(view));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export {
  formatStats,
  formatShare,
  deriveEstimate,
  humanizeTokens,
  estimateTokens,
  suffixFor,
  SAVINGS_RATIO,
};
