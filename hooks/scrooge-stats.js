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
// uncompressed), always labelled "(est)". Per-dial ratios come from the
// subscription benchmark, carried per language in lang-meta.js (LANG_META.savings)
// and read here via savingsMeta(); a dial with no published ratio (lite, or an
// unbenchmarked language) shows raw tokens only — never a fabricated number.

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  readState,
  writeSuffix,
  getStatePath,
  deriveSessionKey,
  migrateLegacyState,
} from './scrooge-config.js';
import { readSession } from '../lib/session-log.js';
import { upsertSession, aggregateLedger, sinceToEpoch, getHistoryPath } from '../lib/ledger.js';
import { resolveRepoRoot, assembleRuleBody, buildFullInjection } from './scrooge-activate.js';
import { savingsMeta } from './lang-meta.js';

// Per-(lang, dial) mean output-token compression ratios now live in lang-meta.js
// (LANG_META[lang].savings), one row per language alongside the rest of that
// language's metadata, each with its provenance (results file(s), N, model). This
// hook reads them through savingsMeta().
//
// `lite` carries no ratio on purpose, and it is NOT unmeasured. It was measured
// (lite-dial-verification, 2026-07-20): ko/lite +43.8% vs normal at fidelity
// 0.650, en/lite +60.3% at 0.700 — against ko/full 0.690 and en/full 0.720. lite
// compresses LESS than full and preserves LESS, a Pareto loss, so the verdict was
// NO-GO and decision D2 (option A) kept the dial shipped but its ratio out of the
// product surface. Publishing a lite estimate would advertise a dial we measured
// and did not adopt. Register-only isolation means real sessions may differ —
// hence the "(est)" label on every derived figure.

const SEP = '──────────────────────────────';

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

// Counterfactual estimate for one (lang, dial), or null when that pair carries no
// published ratio — every lite session (measured, NO-GO, see above) and any
// language not yet benchmarked.
// The ratio is a prose-register figure, so it is applied to prose output tokens
// only — tool_use output (bash/edit/tool JSON) is not compressed by the register
// and must stay out of the savings base (ADR-003).
function deriveEstimate(proseOutputTokens, lang, dial) {
  const meta = lang != null && dial != null ? savingsMeta(lang, dial) : null;
  const ratio = meta ? meta.ratio : undefined;
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
// labelled "(est)", the same honesty discipline as the savings ratios.
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
  if (!ledger) return '';
  // An unreadable history reads as zero sessions, which is NOT the same as
  // "nothing saved yet" — the entries are still on disk. Saying so is the
  // difference between a visible pause and a silent loss of the lifetime total
  // (integrity-sweep Task 2).
  if (ledger.unreadable) {
    return (
      `${SEP}\nLifetime (ledger):     unavailable — history file could not be read (likely over the size cap).\n` +
      `Trim or move ${getHistoryPath()} to resume accumulating.\n`
    );
  }
  if (ledger.sessions === 0) return '';
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
      `No savings estimate published for '${state.lang}/${state.dial}'.\n` +
      (state.dial === 'lite'
        ? 'The lite dial was measured and not adopted for estimates — it compresses less than full AND preserves less (see benchmarks/README.md).\n'
        : 'That language/dial pair has no benchmark run yet.\n') +
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
  // After the Codex env resolution above, so legacy files fold into the right dir.
  migrateLegacyState();
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
};
