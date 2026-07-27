// session-evidence/analyze.js — per-turn register-compliance signals and
// output-token trajectory for REAL session transcripts.
//
// Consumes the per-turn array from lib/session-log.js (parseClaudeSessionTurns
// — the single parser contract; this file never re-parses JSONL) and attaches
// the single-text deterministic signals from benchmarks/fidelity/checks.js
// (detectSafety, extractSpans). Offline, zero-dep, no runtime per-reply use.
//
// NO SAVINGS: real sessions have no counterfactual baseline (ADR-003), so this
// module emits observations only — safety/span presence per turn and an
// intra-session output-token trajectory relative to turn 1. It never computes
// saved tokens, USD, or percentages, and never calls the paired checks
// (byteExactCheck / safetyCheck need a baseline arm that does not exist here).

import { fileURLToPath } from 'node:url';

import { parseClaudeSessionTurns, listSubagentTranscripts } from '../../lib/session-log.js';
import { detectSafety, extractSpans } from '../fidelity/checks.js';

// Attach compliance signals to each turn. Drops the raw `text` from the output
// on purpose: results are observation records, not transcript dumps.
export function attachSignals(turns) {
  return turns.map((t) => {
    const spans = extractSpans(t.text);
    return {
      turnIndex: t.turnIndex,
      id: t.id,
      model: t.model,
      outputTokens: t.outputTokens,
      isToolUse: t.isToolUse,
      isSubagent: t.isSubagent,
      safety: detectSafety(t.text),
      spans: { fenced: spans.fenced.length, inline: spans.inline.length, urls: spans.urls.length },
    };
  });
}

// Intra-session output-token trajectory, prose and tool_use separated so
// tool-call payloads never pollute the register-bearing prose trend. Each
// bucket is relative to its own first turn ("turn 1"); a zero-token first turn
// yields null ratios (no fabricated trend).
export function trajectory(turns) {
  const rel = (list) => {
    const first = list.length ? list[0].outputTokens : 0;
    return list.map((t) => ({
      turnIndex: t.turnIndex,
      outputTokens: t.outputTokens,
      relativeToFirst: first > 0 ? t.outputTokens / first : null,
    }));
  };
  return {
    prose: rel(turns.filter((t) => !t.isToolUse)),
    toolUse: rel(turns.filter((t) => t.isToolUse)),
  };
}

// Analyze one session transcript. Subagent transcripts are opt-in and kept in
// a separate array (never mixed into the main trajectory) so propagation can
// be aggregated independently.
export function analyzeSession(filePath, { includeSubagents = false } = {}) {
  const turns = parseClaudeSessionTurns(filePath);
  const result = {
    file: filePath,
    turnCount: turns.length,
    turns: attachSignals(turns),
    trajectory: trajectory(turns),
  };
  if (includeSubagents) {
    result.subagentTurns = listSubagentTranscripts(filePath).flatMap((f) =>
      attachSignals(parseClaudeSessionTurns(f, { isSubagent: true }))
    );
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const includeSubagents = args.includes('--subagents');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node benchmarks/session-evidence/analyze.js <session.jsonl> [...] [--subagents]');
    process.exit(1);
  }
  const out = files.map((f) => analyzeSession(f, { includeSubagents }));
  console.info(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
}
