#!/usr/bin/env node
// scrooge-stats.js — read the active host-agent session log, print real output
// token usage plus (when benchmark data exists) an estimated savings figure.
//
// Run directly:    node hooks/scrooge-stats.js
// Inside Codex:    /scrooge-stats is intercepted by scrooge-activate.js, which
//                  runs this with --session-file <transcript_path> so we read
//                  the active session rather than the most-recently-modified one.
// Inside Claude:   the scrooge-stats skill runs this directly (no intercept) with
//                  --session-id ${CLAUDE_SESSION_ID}, which resolves the same way.
//
// Honesty: token counts are MEASURED from the session JSONL `usage` fields.
// Savings are a COUNTERFACTUAL ESTIMATE (what the same turns would have cost
// uncompressed), always labelled "(est)". Per-dial ratios come from the
// subscription benchmark, carried per language in lang-meta.js (LANG_META.savings)
// and read here via savingsMeta(); a language with no published ratio shows raw
// tokens only — never a fabricated number.

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
import { savingsMeta, buildReminder, statsText } from './lang-meta.js';

// Per-(lang, dial) mean output-token compression ratios now live in lang-meta.js
// (LANG_META[lang].savings), one row per language alongside the rest of that
// language's metadata, each with its provenance (results file(s), N, model). This
// hook reads them through savingsMeta().
//
// `full` is the only dial. `lite` shipped through v0.22.1 carrying no ratio
// because its measurement rejected it (lite-dial-verification, 2026-07-20: ko/lite
// +43.8% at fidelity 0.650 and en/lite +60.3% at 0.700, against ko/full 0.690 and
// en/full 0.720 — less compression AND less preservation). v0.23.0 finished that
// decision and removed the dial. Register-only isolation means real sessions may
// differ from the benchmark — hence the "(est)" label on every derived figure.

const SEP = '──────────────────────────────';

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

// Counterfactual estimate for one (lang, dial), or null when that pair carries no
// published ratio — any language not yet benchmarked.
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
// lean-flags SC9).
//
// Billed per hook firing, which is what the hooks actually inject: the full
// register at each SessionStart that carried it, plus one reminder per user
// prompt (UserPromptSubmit). Through v0.22.1 the reminder was omitted; through
// v0.29.1 it was multiplied by API responses (`turns`), and one prompt can drive
// dozens of tool-loop responses (one real session: 36 responses, 1 prompt). With
// no SessionStart evidence (mid-session /scrooge, Codex, an older transcript) the
// activation prompt itself carried the full register, hence one reminder fewer.
// A mid-session activation (`activatedAt`) bills only what fired after it: the
// activating prompt's full register, a reminder per later prompt, and the full
// register per later SessionStart. The transcript stamps a prompt at submit,
// before the UserPromptSubmit hook stamps activatedAt (verified locally 2026-10:
// user line ~35 ms ahead of the hook context; Codex task_started likewise), so
// the activating prompt sits before the stamp and later prompts strictly after.
// A prompt whose UserPromptSubmit context the transcript records as the full
// register (`fullPromptTimeline`: a /scrooge set on an already-active session)
// bills full instead of a reminder. A SessionStart-seeded session carries no
// stamp and an untimestamped prompt or start cannot be placed — both keep the
// whole-session bill.
// Returns 0 when inactive or the rule body cannot be read (degrades to no
// overhead rather than a fabricated number).
function selfOverheadTokens(
  state,
  { userPrompts = 0, sessionStarts = 0, promptTimeline, sessionStartTimeline, fullPromptTimeline = [] } = {}
) {
  if (!state) return 0;
  try {
    const root = resolveRepoRoot();
    const body = assembleRuleBody(root, state.lang, state.dial, state.flags);
    if (!body) return 0;
    const full = estimateTokens(buildFullInjection(state.lang, state.dial, body, state.flags));
    const reminder = estimateTokens(buildReminder(state.lang, state.dial, state.flags));
    const prompts = Number(userPrompts) || 0;
    const starts = Number(sessionStarts) || 0;
    const fulls = Array.isArray(fullPromptTimeline) ? fullPromptTimeline : [];
    const at = state.activatedAt;
    const placeable = (times, n) =>
      Array.isArray(times) && times.length === n && times.every((t) => Number.isFinite(t));
    if (
      Number.isFinite(at) &&
      placeable(promptTimeline, prompts) &&
      placeable(sessionStartTimeline, starts) &&
      placeable(fulls, fulls.length)
    ) {
      const remindersAfter = promptTimeline.filter((t) => t > at).length;
      const startsAfter = sessionStartTimeline.filter((t) => t >= at).length;
      const fullsAfter = fulls.filter((t) => t > at).length;
      return full * (1 + startsAfter + fullsAfter) + reminder * Math.max(0, remindersAfter - fullsAfter);
    }
    // Recorded full-register prompts (a /scrooge set on an active session, a
    // UserPromptSubmit seed) replace the assumed activation prompt; without that
    // evidence the activation prompt is assumed when no SessionStart fired.
    if (fulls.length > 0) return full * (starts + fulls.length) + reminder * Math.max(0, prompts - fulls.length);
    const reminders = starts > 0 ? prompts : Math.max(0, prompts - 1);
    return full * Math.max(1, starts) + reminder * reminders;
  } catch (e) {
    return 0;
  }
}

// Prose output the register actually shaped: responses at/after `activatedAt`
// (epoch ms the activation hook stamps on state). Turns before activation were
// never compressed, so pricing them at the savings ratio over-claims. A legacy
// state without the stamp — or a timeline entry with no timestamp — keeps the
// whole-session basis rather than guessing.
function estimateBasis(sess, activatedAt) {
  const whole = sess.proseOutputTokens || 0;
  if (!Number.isFinite(activatedAt) || !Array.isArray(sess.proseTimeline)) return whole;
  let sum = 0;
  for (const p of sess.proseTimeline) {
    if (p.ts == null) return whole;
    if (p.ts >= activatedAt) sum += p.outputTokens;
  }
  return sum;
}

// `{name}` slot fill for the lang-meta stats templates.
function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// One `label: value (note)` row. Labels are not column-padded: CJK and Devanagari
// labels have no fixed terminal width, so padEnd alignment breaks across languages.
function row(label, value, note) {
  return `${label}: ${value}${note ? ` (${note})` : ''}\n`;
}

const num = (n) => n.toLocaleString();

// Lifetime ledger block — accumulated savings across sessions, or a `--since`
// window. Empty when the ledger has no sessions yet.
function formatLedger(ledger, since, t) {
  if (!ledger) return '';
  const label = `${since ? fill(t.since, { since }) : t.lifetime} (${t.ledger})`;
  // An unreadable history reads as zero sessions, which is NOT the same as
  // "nothing saved yet" — the entries are still on disk. Saying so is the
  // difference between a visible pause and a silent loss of the lifetime total
  // (integrity-sweep Task 2).
  if (ledger.unreadable) {
    return `${SEP}\n${label}: ${fill(t.unreadable, { path: getHistoryPath() })}\n`;
  }
  if (ledger.sessions === 0) return '';
  let block =
    `${SEP}\n${label}:\n` +
    row(t.sessions, num(ledger.sessions)) +
    row(t.savedOut, num(ledger.savedTokens), t.note.estProse);
  if (ledger.inputOverheadTokens > 0) {
    block += row(t.overheadTotal, `-${num(ledger.inputOverheadTokens)}`, t.note.staticCtx);
    block += row(t.net, num(ledger.netSavedTokens), t.note.est);
  }
  if (ledger.reasoningTokens > 0) {
    block += row(t.reasoningTotal, num(ledger.reasoningTokens), t.note.notSaving);
  }
  if (ledger.savedUsd > 0) {
    block += row(t.usd, `~$${ledger.savedUsd.toFixed(2)}`, t.note.estNet);
  }
  return block;
}

// Pure formatter — split from main() so tests can pass synthetic inputs. Strings
// follow the active register's language (lang-meta `stats`); inactive → en.
function formatStats({
  inputTokens = 0,
  outputTokens,
  proseOutputTokens = 0,
  estimateProseTokens = proseOutputTokens,
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
  const t = statsText(state && state.lang);
  const head = `\n${t.title}\n${SEP}\n`;
  if (turns === 0) return `${head}${t.noTurns}\n${SEP}\n`;

  const modeLabel = state ? `${state.lang}/${state.dial}` : 'inactive';
  const est = state
    ? deriveEstimate(estimateProseTokens, state.lang, state.dial)
    : null;

  // Unlocalized branches are reachable only through the en fallback: an inactive
  // session has no lang, and every shipped language carries a savings ratio.
  let savings;
  let footer = '';
  if (!state) {
    savings = 'Scrooge inactive this session — no savings estimate.\n';
  } else if (est) {
    savings =
      row(t.estNormal, num(est.estNormal), t.note.proseBasis) +
      row(t.estSaved, num(est.saved), fill(t.note.pctEst, { pct: est.pct }));
    footer = fill(t.footer, { mode: modeLabel }) + '\n';
  } else {
    savings =
      `No savings estimate published for '${state.lang}/${state.dial}'.\n` +
      'That language has no benchmark run yet.\n' +
      'Measured output tokens shown above; no estimate fabricated.\n';
  }

  // Self-injection overhead nets against this session's savings: Scrooge adds its
  // register to the input, so the honest bill subtracts that static cost. Shown
  // only when active and measurable.
  const overheadLine =
    state && inputOverheadTokens > 0
      ? row(t.overhead, `-${num(inputOverheadTokens)}`, t.note.staticCtx)
      : '';

  return (
    head +
    (file ? row(t.session, shortPath(file)) : '') +
    row(t.mode, modeLabel) +
    row(t.turns, turns) +
    `${SEP}\n` +
    row(t.input, num(inputTokens), t.note.measured) +
    row(t.output, num(outputTokens)) +
    row('  prose', num(proseOutputTokens)) +
    (state && estimateProseTokens !== proseOutputTokens
      ? row(`    ${t.sinceActivation}`, num(estimateProseTokens), t.note.estimateBasis)
      : '') +
    row('  tool_use', num(toolUseOutputTokens)) +
    (reasoningOutputTokens > 0
      ? row('  reasoning', num(reasoningOutputTokens), t.note.uncompressed)
      : '') +
    row(t.cacheRead, num(cacheReadTokens)) +
    `${SEP}\n` +
    savings +
    overheadLine +
    footer +
    formatLedger(ledger, since, t)
  );
}

function formatShare({ outputTokens, proseOutputTokens = 0, estimateProseTokens = proseOutputTokens, turns, state }) {
  const t = statsText(state && state.lang);
  if (turns === 0) return t.shareNoTurns;
  const est = state
    ? deriveEstimate(estimateProseTokens, state.lang, state.dial)
    : null;
  if (est) return fill(t.shareSaved, { saved: num(est.saved), turns });
  return fill(t.shareRaw, { turns, output: num(outputTokens) });
}

// Pre-rendered statusline suffix: saved estimate when available, else raw output
// tokens while active, else empty (clears the badge suffix when inactive).
function suffixFor({ outputTokens, proseOutputTokens = 0, estimateProseTokens = proseOutputTokens, turns, state }) {
  if (!state || turns === 0) return '';
  const est = deriveEstimate(estimateProseTokens, state.lang, state.dial);
  if (est) return fill(statsText(state.lang).suffixSaved, { saved: humanizeTokens(est.saved) });
  return `⛏ ${humanizeTokens(outputTokens)} tok`;
}

function main() {
  const args = process.argv.slice(2);
  const sfIdx = args.indexOf('--session-file');
  const sessionFile = sfIdx !== -1 ? args[sfIdx + 1] : null;
  const sidIdx = args.indexOf('--session-id');
  const sessionId = sidIdx !== -1 ? args[sidIdx + 1] || null : null;
  const share = args.includes('--share');
  const sinceIdx = args.indexOf('--since');
  const sinceArg = sinceIdx !== -1 ? args[sinceIdx + 1] || null : null;

  // Host detection mirrors scrooge-activate.js `isCodexAgent()` — same rule
  // (SCROOGE_AGENT, else CLAUDE_CONFIG_DIR's basename). Kept separate rather than
  // shared because this side also *sets* CLAUDE_CONFIG_DIR and needs
  // defaultCodexDir for readSession; a shared helper would take an options bag for
  // a three-line branch. If the rule changes, change it in both.
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
    sessionId,
  });
  // Session-scoped state: derive the canonical session key the activation hook
  // wrote under, so stats reads the SAME state file the other surfaces use. An
  // explicit --session-id wins; otherwise the transcript stem stands in for it,
  // which holds on Claude (`<session_id>.jsonl`) but not on Codex (`rollout-…`).
  const sessionKey = deriveSessionKey({ session_id: sessionId, transcript_path: sess.file });
  const state = readState(getStatePath(sessionKey));

  // Upsert this session into the lifetime ledger BEFORE aggregating, so the
  // total includes the current run. Upsert (not append) is keyed on sessionKey:
  // running /scrooge-stats N times in one session overwrites the one entry, never
  // double-counts. Skipped when sessionless or no turns yet.
  const estimateProseTokens = state ? estimateBasis(sess, state.activatedAt) : sess.proseOutputTokens;
  const est = state ? deriveEstimate(estimateProseTokens, state.lang, state.dial) : null;
  const inputOverheadTokens = selfOverheadTokens(state, sess);
  if (sessionKey && sess.turns > 0) {
    upsertSession({
      sessionId: sessionKey,
      model: sess.model,
      proseOutputTokens: sess.proseOutputTokens,
      // Inactive → undefined: the ledger keeps whatever an active run recorded.
      savedTokens: state ? (est ? est.saved : 0) : undefined,
      reasoningTokens: sess.reasoningOutputTokens,
      inputOverheadTokens: state ? inputOverheadTokens : undefined,
      ts: Date.now(),
    });
  }
  const since = sinceArg ? sinceToEpoch(sinceArg, Date.now()) : null;
  const ledger = aggregateLedger({ since });
  // Label the window only when it parsed: a malformed --since aggregates all-time,
  // so a "Since <arg>" header over lifetime totals would mislabel them.
  const view = {
    ...sess,
    state,
    ledger,
    since: since != null ? sinceArg : null,
    inputOverheadTokens,
    estimateProseTokens,
  };

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
  selfOverheadTokens,
  estimateBasis,
};
