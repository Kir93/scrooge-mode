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
import { readState, writeSuffix } from './scrooge-config.js';
import { readSession } from '../lib/session-log.js';

// Per-dial mean output-token compression ratio, filled by the Task 5 benchmark
// (e.g. { full: 0.5, lite: 0.3 }). Empty until then — no estimate is shown.
const SAVINGS_RATIO = {};

const SEP = '──────────────────────────────';

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

// Counterfactual estimate for one dial, or null when no benchmark ratio exists.
function deriveEstimate(outputTokens, dial) {
  const ratio = dial != null ? SAVINGS_RATIO[dial] : undefined;
  if (ratio == null || ratio <= 0 || ratio >= 1) return null;
  const estNormal = Math.round(outputTokens / (1 - ratio));
  return { estNormal, saved: estNormal - outputTokens, pct: Math.round(ratio * 100) };
}

function shortPath(p) {
  if (!p) return '';
  return p.length > 48 ? '...' + p.slice(-48) : p;
}

// Pure formatter — split from main() so tests can pass synthetic inputs.
function formatStats({ outputTokens, cacheReadTokens, turns, model, file, state }) {
  const head = `\nScrooge Stats\n${SEP}\n`;
  if (turns === 0) {
    return head + 'No conversation yet — stats available after the first response.\n' + SEP + '\n';
  }

  const modeLabel = state ? `${state.lang}/${state.dial}` : 'inactive';
  const est = state ? deriveEstimate(outputTokens, state.dial) : null;

  let savings;
  let footer = '';
  if (!state) {
    savings = 'Scrooge inactive this session — no savings estimate.';
  } else if (est) {
    savings =
      `Est. without scrooge:  ${est.estNormal.toLocaleString()}\n` +
      `Est. tokens saved:     ${est.saved.toLocaleString()} (~${est.pct}%, est)`;
    footer = `Estimate from benchmarks/ (mean per-dial, ${modeLabel}). Measured tokens above; savings are counterfactual.`;
  } else {
    savings =
      `Savings estimate pending — benchmark (Task 5) not yet run for '${state.dial}'.\n` +
      'Measured output tokens shown above; no estimate fabricated.';
  }

  return (
    head +
    (file ? `Session:  ${shortPath(file)}\n` : '') +
    `Mode:     ${modeLabel}\n` +
    `Turns:    ${turns}\n${SEP}\n` +
    `Output tokens:         ${outputTokens.toLocaleString()}\n` +
    `Cache-read tokens:     ${cacheReadTokens.toLocaleString()}\n${SEP}\n` +
    `${savings}\n` +
    (footer ? footer + '\n' : '')
  );
}

function formatShare({ outputTokens, turns, state }) {
  if (turns === 0) return '💰 scrooge armed, no turns yet';
  const est = state ? deriveEstimate(outputTokens, state.dial) : null;
  if (est) {
    return `💰 saved ~${est.saved.toLocaleString()} output tokens (est) across ${turns} turns this session`;
  }
  return `💰 ${turns} turns, ${outputTokens.toLocaleString()} output tokens this session`;
}

// Pre-rendered statusline suffix: saved estimate when available, else raw output
// tokens while active, else empty (clears the badge suffix when inactive).
function suffixFor({ outputTokens, turns, state }) {
  if (!state || turns === 0) return '';
  const est = deriveEstimate(outputTokens, state.dial);
  if (est) return `⛏ ~${humanizeTokens(est.saved)} saved (est)`;
  return `⛏ ${humanizeTokens(outputTokens)} tok`;
}

function main() {
  const args = process.argv.slice(2);
  const sfIdx = args.indexOf('--session-file');
  const sessionFile = sfIdx !== -1 ? args[sfIdx + 1] : null;
  const share = args.includes('--share');

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const sess = readSession({ claudeDir, sessionFile });
  const state = readState();
  const view = { ...sess, state };

  // Refresh the statusline suffix on every run, tagged "<sessionId>:<text>" so a
  // statusline in a different (or fresh) session does not render a stale number.
  // The session id is the transcript filename stem (Claude writes <uuid>.jsonl),
  // which matches the session_id the statusline receives on its stdin payload.
  const sessionId = sess.file ? path.basename(sess.file, '.jsonl') : '';
  const text = suffixFor(view);
  writeSuffix(text ? `${sessionId}:${text}` : '');

  process.stdout.write(share ? formatShare(view) + '\n' : formatStats(view));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export {
  formatStats,
  formatShare,
  deriveEstimate,
  humanizeTokens,
  suffixFor,
  SAVINGS_RATIO,
};
