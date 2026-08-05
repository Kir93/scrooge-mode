// session-evidence/report.js — N-turn drift report over analyze.js observations.
//
// Classifies real-session prose-output trajectories into one verdict:
//   caveat-relax   — trajectories flat: the register held across multi-turn
//                    sessions (README single-turn caveat may be relaxed on the
//                    register-RETENTION axis only — never the savings clause).
//   reinject-tune  — trajectories drift upward: evidence input for tuning the
//                    reminder cadence (hooks/scrooge-activate.js "every other
//                    turn"). This report is tuning EVIDENCE only; it changes
//                    no register/hook code.
//   inconclusive   — not enough conclusive sessions to judge.
//
// NO SAVINGS (ADR-003): observations and retention verdicts only — never
// saved tokens, USD, or percentages-vs-baseline. Known limitation
// (measurement-gated, spec Open Questions): per-turn output tracks request
// complexity as much as register adherence; the median-based late/early ratio
// dampens but does not remove that confound.

import { fileURLToPath } from 'node:url';

import { analyzeSession } from './analyze.js';

// Empirical defaults from the 2026-07-27 dogfood scan (370 active sessions,
// 223 with ~10+ turns). Overridable per call; not tuned beyond round numbers.
export const DEFAULT_THRESHOLDS = Object.freeze({
  minProseTurns: 5, // fewer register-bearing turns → inconclusive, never judged
  driftRatio: 1.5, // late-half median > 1.5x early-half median → drifting
  driftShare: 0.5, // more than half of conclusive sessions drifting → reinject-tune
});

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Classify one session by its prose trajectory: late-half median output vs
// early-half median (absolute tokens — same-session internal comparison, so
// the turn-1-relative and absolute ratios are identical).
export function classifySession(analysis, thresholds = DEFAULT_THRESHOLDS) {
  const prose = analysis.trajectory.prose;
  const base = {
    // Basename only. The input is a private session transcript under the user's
    // home directory, so emitting the full path would put a local absolute path
    // into a committed artefact (and fail benchmarks/scrub.js). The basename is
    // the session id, which is all a reader needs to line rows up.
    file: analysis.file.replace(/^.*[/\\]/, ''),
    proseTurns: prose.length,
    earlyMedian: null,
    lateMedian: null,
    ratio: null,
  };
  if (prose.length < thresholds.minProseTurns) return { ...base, verdict: 'inconclusive' };
  const tokens = prose.map((p) => p.outputTokens);
  const half = Math.floor(tokens.length / 2);
  const earlyMedian = median(tokens.slice(0, half));
  const lateMedian = median(tokens.slice(half));
  if (!earlyMedian) return { ...base, verdict: 'inconclusive' };
  const ratio = lateMedian / earlyMedian;
  return {
    ...base,
    earlyMedian,
    lateMedian,
    ratio,
    verdict: ratio > thresholds.driftRatio ? 'drifting' : 'retained',
  };
}

// Share of billed output tokens the register can even reach.
//
// The register rewrites PROSE. Tool-call payloads — diffs, file writes, exact
// error strings, tool JSON — are left verbatim by design, so in an agentic
// session they are output the register cannot touch. Every published savings
// figure comes from a single-turn, zero-tool chat corpus, which makes this the
// number that says how far those figures carry into real use.
//
// This is a direct measurement of billed tokens, not a counterfactual: it says
// what fraction of output was prose, never what an uncompressed run would have
// cost. ADR-003 forbids the latter from real sessions and this does not attempt
// it — a whole-session savings percentage is still not derivable from here.
//
// Pooled and per-session medians are both reported because they answer different
// questions: pooled is "of all the output tokens billed, what share was prose"
// (dominated by the largest sessions), median is "in a typical session, what
// share was prose". Quoting only the flattering one would be the whole problem.
function proseShare(analyses) {
  let proseTokens = 0;
  let totalTokens = 0;
  const perSession = [];
  for (const a of analyses) {
    const turns = a.turns || [];
    let p = 0;
    let t = 0;
    for (const turn of turns) {
      const n = Number(turn.outputTokens) || 0;
      t += n;
      if (!turn.isToolUse) p += n;
    }
    proseTokens += p;
    totalTokens += t;
    if (t > 0) perSession.push(p / t);
  }
  return {
    sessions: perSession.length,
    proseTokens,
    totalTokens,
    pooledShare: totalTokens > 0 ? proseTokens / totalTokens : null,
    medianSessionShare: median(perSession),
  };
}

// Aggregate compliance readout for a set of turns (used for the subagent
// propagation readout, kept strictly separate from main-session judgment).
function complianceReadout(turns) {
  return {
    turns: turns.length,
    proseTurns: turns.filter((t) => !t.isToolUse).length,
    safetyTurns: turns.filter((t) => t.safety.length > 0).length,
    spanTurns: turns.filter((t) => t.spans.fenced + t.spans.inline + t.spans.urls > 0).length,
  };
}

export function buildReport(analyses, thresholds = DEFAULT_THRESHOLDS) {
  const sessions = analyses.map((a) => classifySession(a, thresholds));
  const conclusive = sessions.filter((s) => s.verdict !== 'inconclusive');
  const drifting = conclusive.filter((s) => s.verdict === 'drifting');
  let verdict = 'inconclusive';
  if (conclusive.length) {
    verdict = drifting.length / conclusive.length > thresholds.driftShare ? 'reinject-tune' : 'caveat-relax';
  }
  return {
    thresholds: { ...thresholds },
    sessions,
    main: {
      total: sessions.length,
      conclusive: conclusive.length,
      retained: conclusive.length - drifting.length,
      drifting: drifting.length,
      inconclusive: sessions.length - conclusive.length,
      // The README quotes this alongside the counts above and says all four can
      // be checked against the committed results.json — so it has to BE in the
      // file, not something a reader re-derives from `sessions[]`. Median over
      // conclusive sessions only: an inconclusive one carries no ratio at all.
      medianRatio: median(conclusive.map((s) => s.ratio)),
      verdict,
    },
    // Reach, not retention: how much of the billed output the register can act on
    // at all. Committed alongside the retention numbers so both are checkable
    // against this file rather than re-derived. See proseShare().
    reach: proseShare(analyses),
    subagent: complianceReadout(analyses.flatMap((a) => a.subagentTurns || [])),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const includeSubagents = args.includes('--subagents');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node benchmarks/session-evidence/report.js <session.jsonl> [...] [--subagents]');
    process.exit(1);
  }
  const report = buildReport(files.map((f) => analyzeSession(f, { includeSubagents })));
  console.info(JSON.stringify(report, null, 2));
}
