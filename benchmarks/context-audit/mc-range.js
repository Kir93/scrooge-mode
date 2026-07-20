// context-audit/mc-range.js — LLM-dependent memory-compress RANGE measurement (Task 4).
//
// Widens the single memory-compress floor point (deterministic re-measurement in
// run.js) into a DISTRIBUTION (min/median/max) by live-compressing each corpus file
// with the subscription `claude` CLI and metering `compressionDelta(original,
// compressed)`. Because `compressionDelta` only meters two existing texts (it does
// NOT generate compressed prose), the compressed side must come from a live model —
// so this measurement is LLM-dependent, quota-gated, and NON-bit-identical. It is
// therefore ISOLATED from the deterministic GO verdict (F1): results land in a
// SEPARATE file (`results/mc-range.json`) and never feed `results/report.json`.
//
// Isolation (fidelity-bench parity): each compression runs `claude --print` with
// `--setting-sources ''` (loads NO user/project settings -> the active scrooge
// register hooks do NOT contaminate the child, which would inflate the saving) and
// a full `--system-prompt` override, from an empty tmpdir cwd (no host CLAUDE.md).
// FOREGROUND only — a backgrounded run gets killed each turn (see benchmarks memory).
//
// Usage:
//   node benchmarks/context-audit/mc-range.js            # write results/mc-range.json
//   node benchmarks/context-audit/mc-range.js --print    # also print the range summary
//   node benchmarks/context-audit/mc-range.js --model claude-opus-4-8

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { compressionDelta, verifyPreservation } from '../../lib/memory-compress.js';
import { loadCorpus, loadFloorPair, estimateTokens } from './lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const MODEL = argVal('--model', 'claude-opus-4-8');
const TIMEOUT_MS = Number(argVal('--timeout', '300')) * 1000; // verbose docs need 300s+

const SYSTEM_PROMPT =
  'You compress instruction/memory files (CLAUDE.md-style) to fewer tokens while ' +
  'preserving meaning. Rewrite the prose tighter: remove redundancy, filler, and ' +
  'hedging; merge repetitive lines. PRESERVE VERBATIM every code span, file path, ' +
  'URL, command, and every security / destructive-action / irreversible-action ' +
  'warning — never drop or alter them. Keep all headings and document structure. ' +
  'Output ONLY the compressed file content — no preamble, no explanation, no code fences.';

// Strip an accidental wrapping code fence / leading preamble the model may add.
function cleanOutput(s) {
  let t = s.trim();
  const fence = t.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  return t;
}

// One live compression via the subscription CLI, isolated from host settings.
function compressLive(text) {
  const cwd = mkdtempSync(join(tmpdir(), 'mc-range-'));
  try {
    const out = execFileSync(
      'claude',
      ['--print', '--setting-sources', '', '--model', MODEL, '--system-prompt', SYSTEM_PROMPT, text],
      { cwd, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    return cleanOutput(out);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const round = (n, p = 2) => (n === null ? null : Math.round(n * 10 ** p) / 10 ** p);

async function main() {
  const { manifest, files } = loadCorpus();
  // Floor pair as an anchor row (its deterministic delta is the run.js floor point).
  const fp = loadFloorPair(manifest);
  const results = [];

  for (const f of files) {
    process.stderr.write(`[mc-range] compressing ${f.id} (${estimateTokens(f.text)} tok)...\n`);
    let row;
    try {
      const compressed = compressLive(f.text);
      const guard = verifyPreservation(f.text, compressed);
      const d = compressionDelta(f.text, compressed);
      const savingPct = d.baseline ? round((d.saved / d.baseline) * 100) : 0;
      row = {
        id: f.id,
        // local (private) file paths are redacted — never committed (local-corpus convention)
        path: f.source === 'local' ? `local:${f.id}` : f.path,
        source: f.source,
        baselineTokens: d.baseline,
        savedTokens: d.saved,
        savingPct,
        guardOk: guard.ok,
        guardMissing: guard.ok ? undefined : guard.missing.slice(0, 5),
      };
    } catch (e) {
      row = { id: f.id, path: f.source === 'local' ? `local:${f.id}` : f.path, source: f.source, error: String(e.message || e).slice(0, 200) };
    }
    results.push(row);
  }

  // Range over guard-passing, non-errored rows only (an un-realizable / failed
  // compression is not a valid saving — honest, mirrors the product guard).
  const valid = results.filter((r) => r.guardOk && typeof r.savingPct === 'number');
  const pcts = valid.map((r) => r.savingPct);
  const floorDelta = fp ? compressionDelta(fp.original, fp.compressed) : null;
  const floorPct = floorDelta && floorDelta.baseline ? round((floorDelta.saved / floorDelta.baseline) * 100) : null;

  // Classify the guard-failing rows so the committed artifact self-explains why n
  // is thin — gutted (model truncated/summarized a large doc) vs guard-rejected
  // (model dropped a protected span on a harder compression — the F2 phenomenon live).
  const gutted = results.filter((r) => r.guardOk === false && typeof r.savingPct === 'number' && r.savingPct > 80);
  const guardRejected = results.filter((r) => r.guardOk === false && typeof r.savingPct === 'number' && r.savingPct <= 80);
  const errored = results.filter((r) => r.error);
  const minPct = pcts.length ? round(Math.min(...pcts)) : null;
  const maxPct = pcts.length ? round(Math.max(...pcts)) : null;
  const medPct = round(median(pcts));
  const validSelf = valid.filter((r) => r.source === 'self-repo').length;
  const validSyn = valid.filter((r) => r.source === 'synthetic').length;
  const validLocal = valid.filter((r) => r.source === 'local').length;
  const mix = [validSelf && `${validSelf} self-repo`, validSyn && `${validSyn} synthetic`, validLocal && `${validLocal} local`].filter(Boolean).join(' + ');
  const caveats = [
    `n=${valid.length} guard-passing row(s) (${mix || 'none'}) — thin; treat the range as INDICATIVE, not a distribution.`,
    gutted.length
      ? `${gutted.length} row(s) GUTTED (model truncated/summarized instead of compressing — saving>80% but guard-failed): ${gutted.map((r) => r.id).join(', ')} — invalid, excluded.`
      : null,
    guardRejected.length
      ? `${guardRejected.length} row(s) guard-REJECTED (model dropped a protected span on harder compression — the F2 phenomenon, live): ${guardRejected.map((r) => r.id).join(', ')} — excluded (not safely realizable).`
      : null,
    errored.length ? `${errored.length} row(s) errored: ${errored.map((r) => r.id).join(', ')}.` : null,
    medPct !== null && floorPct !== null
      ? `realizable (guard-passing) live saving: median ${medPct}%, range ${minPct}–${maxPct}% across ${mix}. Median ${medPct >= 7.7 ? 'at/above' : 'below'} the 7.7% historical floor anchor and the ${floorPct}% deterministic floor pair. Harder compressions were gutted or guard-rejected (see counts) — realizable headroom is modest and the guard, not the model, caps it.`
      : null,
  ].filter(Boolean);

  const report = {
    schema: 'context-audit/mc-range@1',
    // NOTE: LLM-dependent + NON-bit-identical — excluded from the deterministic GO
    // verdict (results/report.json). This file is the F1-isolated range measurement.
    llm_dependent: true,
    bit_identical: false,
    generated_at: new Date().toISOString(),
    model: MODEL,
    note:
      'memory-compress corpus-expansion RANGE (Task 4). Live-compressed via subscription `claude` ' +
      '(--setting-sources "" isolation, empty cwd). NON-deterministic: re-running yields different ' +
      'compressed prose. EXCLUDED from the deterministic GO verdict (F1) — separate from report.json. ' +
      'Range covers guard-passing rows only. Local (private) rows are path-redacted / not committed.',
    anchors: { memoryCompressFloorPct: 7.7, deterministicFloorPct: floorPct },
    range: {
      minPct,
      medianPct: round(median(pcts)),
      maxPct,
      n: valid.length,
      note: 'min/median/max of per-file live memory-compress saving %, guard-passing rows only.',
    },
    caveats,
    floorRelation: {
      historicalFloorPct: 7.7,
      deterministicFloorPct: floorPct,
      liveMedianPct: medPct,
      liveRangePct: minPct === null ? null : [minPct, maxPct],
      finding:
        medPct === null || floorPct === null
          ? 'insufficient guard-passing data'
          : medPct >= 7.7
            ? `live median ${medPct}% sits at/above the 7.7% floor anchor; range ${minPct}–${maxPct}%.`
            : maxPct > 7.7
              ? `live range ${minPct}–${maxPct}% STRADDLES the 7.7% floor: median ${medPct}% is below it, the top is pulled up by looser synthetic samples while real tight self docs sit below. The floor point is not a floor of the realizable distribution — safely-realizable saving on tight docs runs lower.`
              : `entire live range ${minPct}–${maxPct}% sits BELOW the 7.7% floor anchor and the ${floorPct}% deterministic pair — realizable live saving on this corpus is smaller than the floor point.`,
    },
    counts: { validGuardPassing: valid.length, gutted: gutted.length, guardRejected: guardRejected.length, errored: errored.length },
    files: results,
  };

  writeFileSync(join(HERE, 'results', 'mc-range.json'), JSON.stringify(report, null, 2) + '\n');
  process.stderr.write(`[mc-range] wrote results/mc-range.json — n=${valid.length}, range ${report.range.minPct}%–${report.range.maxPct}% (median ${report.range.medianPct}%)\n`);
  if (argv.includes('--print')) console.info(JSON.stringify(report, null, 2));
  else console.info(`mc-range: n=${valid.length} range ${report.range.minPct}%–${report.range.maxPct}% median ${report.range.medianPct}% (floor anchor 7.7% / deterministic ${floorPct}%)`);
}

main().catch((e) => {
  process.stderr.write(`mc-range failed: ${e.message || e}\n`);
  process.exit(1);
});
