// context-audit/run.js — deterministic scorer + GO/NO-GO report (Task 3).
//
// Runs the detectors over the corpus, scores per-category recall/precision against
// the labeled synthetic set, computes gross + structural-marginal saving (dup+dead
// only — low-density is the axis memory-compress already absorbs, F1/F4), re-measures
// the memory-compress floor point deterministically (compressionDelta over the
// committed reference pair), and emits a GO/NO-GO verdict vs the D2 threshold.
//
// Deterministic core: no LLM, no subscription quota, no Date.now/randomness. Given a
// fixed repo state the output is bit-identical, but the report is a SNAPSHOT: self-repo
// rows read LIVE docs (flagged `live: true`) and ARE verdict inputs — they feed the
// full-corpus marginal median and the regime-divergence guard, so the verdict can
// shift if those docs change. The drift-free/stable parts are the labeled SCORING
// (recall/precision, computed on the synthetic set only) and the floor re-measurement.
// The corpus-expansion RANGE (min/median/max) needs live per-file LLM compression and
// is isolated to Task 4.
//
// Usage:
//   node benchmarks/context-audit/run.js            # write results/report.{json,md}
//   node benchmarks/context-audit/run.js --print    # also print the human report
//   CA_VERDICT=off node ...                          # compute numbers, withhold label
//   CA_MARGINAL_GO=10 CA_PRECISION_GO=0.8 node ...   # override D2 thresholds

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compressionDelta } from '../../lib/memory-compress.js';
import { loadCorpus, loadLabels, loadFloorPair, estimateTokens, byteLen } from './lib.js';
import { detectAll } from './detectors.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// D2-confirmed thresholds (overridable via env;산출/판정 분리 — CA_VERDICT=off withholds).
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
export function thresholds(env = process.env) {
  return {
    marginalGoPct: num(env.CA_MARGINAL_GO, 8),
    marginalKillPct: num(env.CA_MARGINAL_KILL, 3),
    precisionGo: num(env.CA_PRECISION_GO, 0.8),
    precisionNoise: num(env.CA_PRECISION_NOISE, 0.5),
    emitVerdict: env.CA_VERDICT !== 'off',
  };
}

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const CATS = ['dup', 'dead', 'lowdensity'];
const isStructural = (c) => c === 'dup' || c === 'dead';

// Per-file detection + saving accounting.
export function analyzeFile(file, opts = {}) {
  const findings = detectAll(file, opts);
  const baselineTokens = estimateTokens(file.text);
  const baselineBytes = byteLen(file.text);
  const sum = (pred, key) => findings.filter(pred).reduce((s, f) => s + f[key], 0);
  const structTokens = sum((f) => isStructural(f.category), 'removableTokens');
  const structBytes = sum((f) => isStructural(f.category), 'removableBytes');
  const grossTokens = sum(() => true, 'removableTokens');
  const grossBytes = sum(() => true, 'removableBytes');
  return {
    id: file.id,
    path: file.path,
    source: file.source,
    labeled: !!file.labeled,
    live: file.source === 'self-repo' || file.source === 'local',
    baselineTokens,
    baselineBytes,
    findings,
    counts: CATS.reduce((o, c) => ((o[c] = findings.filter((f) => f.category === c).length), o), {}),
    grossTokens,
    grossBytes,
    structuralTokens: structTokens,
    structuralBytes: structBytes,
    structuralMarginalPct: baselineTokens ? round((structTokens / baselineTokens) * 100) : 0,
  };
}

// Recall/precision against the labeled synthetic set only (stable, drift-free).
export function scoreLabeled(analyses, labels) {
  const labeled = analyses.filter((a) => a.labeled);
  const findingsOf = (path) => (labeled.find((a) => a.path === path)?.findings) || [];
  const matches = (fd, l) => fd.category === l.category && fd.spanText.includes(l.anchor);
  const per = {};
  for (const cat of CATS) {
    const catLabels = labels.filter((l) => l.category === cat);
    const caught = catLabels.filter((l) => findingsOf(l.file).some((fd) => matches(fd, l))).length;
    const flagged = labeled.flatMap((a) => a.findings.filter((f) => f.category === cat));
    const tp = flagged.filter((fd) => labels.some((l) => l.file === fd.file && matches(fd, l))).length;
    per[cat] = {
      labeled: catLabels.length,
      caught,
      recall: catLabels.length ? round(caught / catLabels.length, 3) : null,
      flagged: flagged.length,
      tp,
      precision: flagged.length ? round(tp / flagged.length, 3) : null,
    };
  }
  // structural (dup+dead) combined precision — the D2 GO leg
  const structFlagged = labeled.flatMap((a) => a.findings.filter((f) => isStructural(f.category)));
  const structTp = structFlagged.filter((fd) =>
    labels.some((l) => l.file === fd.file && matches(fd, l)),
  ).length;
  const structuralPrecision = structFlagged.length ? round(structTp / structFlagged.length, 3) : null;
  const established =
    (per.dup.recall !== null && per.dup.recall >= 0.8) ||
    (per.dead.recall !== null && per.dead.recall >= 0.8);
  return { per, structuralPrecision, structuralEstablished: established };
}

// Verdict vs D2, plus a representativeness guard (Open Q1). `m` = { medianPct,
// syntheticMedianPct, selfRepoMedianPct }. When the labeled/synthetic regime clears
// the GO bar but the dogfood-tight self-repo regime sits in the kill zone, the two
// regimes DIVERGE — no single median is representative of "injected docs in the
// wild", so the verdict is WEAK (inconclusive) pending D3 real-doc expansion, rather
// than letting an arbitrary-composition full-corpus median pick GO or NO-GO.
export function decideVerdict(m, structuralPrecision, established, t) {
  if (!t.emitVerdict) return { verdict: 'WITHHELD', reason: 'CA_VERDICT=off — numbers computed, GO/NO-GO label withheld.' };
  const regimesDiverge =
    m.syntheticMedianPct >= t.marginalGoPct && m.selfRepoMedianPct < t.marginalKillPct;
  if (regimesDiverge) {
    return {
      verdict: 'WEAK',
      reason:
        `regime divergence (Open Q1): synthetic median ${m.syntheticMedianPct}% clears GO but dogfood-tight ` +
        `self-repo median ${m.selfRepoMedianPct}% is in the kill zone — no single median is representative. ` +
        'Expand the corpus with representative less-compressed real docs (D3 local manifest) before GO.',
    };
  }
  if (
    m.medianPct >= t.marginalGoPct &&
    structuralPrecision !== null &&
    structuralPrecision >= t.precisionGo &&
    established
  ) {
    return { verdict: 'GO', reason: `marginal median ${m.medianPct}% >= ${t.marginalGoPct}% AND structural precision ${structuralPrecision} >= ${t.precisionGo}.` };
  }
  if (
    m.medianPct < t.marginalKillPct ||
    (structuralPrecision !== null && structuralPrecision < t.precisionNoise)
  ) {
    return { verdict: 'NO-GO', reason: `marginal median ${m.medianPct}% < ${t.marginalKillPct}% (mcp-shrink zone) or structural precision below noise floor.` };
  }
  return { verdict: 'WEAK', reason: `marginal median ${m.medianPct}% between kill (${t.marginalKillPct}%) and GO (${t.marginalGoPct}%).` };
}

const ANCHORS = { mcpShrinkNoGoPct: 2.6, memoryCompressFloorPct: 7.7 };

export function buildReport(env = process.env) {
  const t = thresholds(env);
  const { manifest, files } = loadCorpus();
  const labels = loadLabels();
  const analyses = files.map((f) => analyzeFile(f));
  const score = scoreLabeled(analyses, labels);

  const marginalAll = analyses.map((a) => a.structuralMarginalPct);
  const marginalSynthetic = analyses.filter((a) => a.labeled).map((a) => a.structuralMarginalPct);
  const marginalSelf = analyses.filter((a) => a.source === 'self-repo').map((a) => a.structuralMarginalPct);

  const fp = loadFloorPair(manifest);
  const floor = fp ? compressionDelta(fp.original, fp.compressed) : null;
  const floorPct = floor && floor.baseline ? round((floor.saved / floor.baseline) * 100) : null;

  const marginal = {
    medianPct: round(median(marginalAll)),
    minPct: round(Math.min(...marginalAll)),
    maxPct: round(Math.max(...marginalAll)),
    syntheticMedianPct: round(median(marginalSynthetic)),
    selfRepoMedianPct: round(median(marginalSelf)),
    note: 'structural (dup+dead) removable tokens / baseline tokens, per file. low-density excluded (memory-compress absorbs it, F1/F4). guard-passing only (F2).',
  };
  const { verdict, reason } = decideVerdict(marginal, score.structuralPrecision, score.structuralEstablished, t);

  const grossTokens = analyses.reduce((s, a) => s + a.grossTokens, 0);
  const structuralTokens = analyses.reduce((s, a) => s + a.structuralTokens, 0);

  return {
    schema: 'context-audit/report@1',
    note:
      'Phase 0 deterministic measurement. LLM=0, quota=0, bit-identical for a fixed repo state. ' +
      'This is a SNAPSHOT: self-repo rows are LIVE (drift with edits) and ARE verdict inputs ' +
      '(they feed the full-corpus marginal median + the regime-divergence guard), so the verdict ' +
      'can shift if those docs change. Drift-free/stable: the labeled scoring (recall/precision, ' +
      'synthetic only) and the floor re-measurement. Corpus-expansion range is Task 4 (LLM-dependent, separate).',
    thresholds: t,
    anchors: ANCHORS,
    verdict,
    verdictReason: reason,
    marginal,
    scoring: score,
    floor: floor
      ? { baselineTokens: floor.baseline, savedTokens: floor.saved, savingPct: floorPct, anchorPct: ANCHORS.memoryCompressFloorPct, note: fp.note }
      : null,
    gross: { removableTokens: grossTokens, structuralTokens },
    files: analyses.map((a) => ({
      id: a.id,
      path: a.path,
      source: a.source,
      labeled: a.labeled,
      live: a.live,
      baselineTokens: a.baselineTokens,
      counts: a.counts,
      grossTokens: a.grossTokens,
      structuralTokens: a.structuralTokens,
      structuralMarginalPct: a.structuralMarginalPct,
    })),
  };
}

function renderMarkdown(r) {
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);
  const rc = (v) => (v === null || v === undefined ? 'n/a' : v);
  const L = [];
  L.push('# context-audit — Phase 0 GO/NO-GO report');
  L.push('');
  L.push('<!-- Generated by run.js. Deterministic (LLM=0, quota=0). Re-run: `node benchmarks/context-audit/run.js`. -->');
  L.push('');
  L.push(`**Verdict: ${r.verdict}** — ${r.verdictReason}`);
  L.push('');
  L.push(r.note);
  L.push('');
  L.push('## Threshold (D2)');
  L.push('');
  L.push(`- GO: structural marginal median \`>= ${r.thresholds.marginalGoPct}%\` AND structural precision \`>= ${r.thresholds.precisionGo}\` AND >=1 structural category established.`);
  L.push(`- NO-GO/kill: marginal median \`< ${r.thresholds.marginalKillPct}%\` (mcp-shrink zone) OR structural precision \`< ${r.thresholds.precisionNoise}\` (noise).`);
  L.push(`- Anchors: mcp-shrink NO-GO \`${r.anchors.mcpShrinkNoGoPct}%\`, memory-compress floor \`${r.anchors.memoryCompressFloorPct}%\`.`);
  L.push('');
  L.push('## Structural marginal (dup + dead, guard-passing, low-density excluded)');
  L.push('');
  L.push('Verdict decision order: the **regime-divergence guard** (synthetic vs self-repo medians) fires FIRST; the full-corpus median is only the fallback GO/kill basis when the regimes do not diverge. All three medians below are verdict inputs.');
  L.push('');
  L.push('| population | median | min | max |');
  L.push('| ---------- | ------ | --- | --- |');
  L.push(`| full corpus (fallback GO/kill basis) | ${pct(r.marginal.medianPct)} | ${pct(r.marginal.minPct)} | ${pct(r.marginal.maxPct)} |`);
  L.push(`| synthetic only (stable; regime guard) | ${pct(r.marginal.syntheticMedianPct)} | | |`);
  L.push(`| self-repo only (live, dogfood-tight; regime guard) | ${pct(r.marginal.selfRepoMedianPct)} | | |`);
  L.push('');
  L.push('## Detection rate (labeled synthetic set)');
  L.push('');
  L.push('| category | labeled | caught | recall | flagged | tp | precision |');
  L.push('| -------- | ------- | ------ | ------ | ------- | -- | --------- |');
  for (const c of CATS) {
    const s = r.scoring.per[c];
    L.push(`| ${c} | ${s.labeled} | ${s.caught} | ${rc(s.recall)} | ${s.flagged} | ${s.tp} | ${rc(s.precision)} |`);
  }
  L.push('');
  L.push(`Structural (dup+dead) precision: \`${rc(r.scoring.structuralPrecision)}\` — the D2 GO leg. Established: \`${r.scoring.structuralEstablished}\`.`);
  L.push('');
  L.push('## Memory-compress floor re-measurement (deterministic)');
  L.push('');
  if (r.floor) {
    L.push(`- committed reference pair -> \`compressionDelta\` = **${pct(r.floor.savingPct)}** (baseline ${r.floor.baselineTokens} tok, saved ${r.floor.savedTokens} tok). Bit-identical on re-run.`);
    L.push(`- historical anchor: ${r.anchors.memoryCompressFloorPct}% (superset spec). The reference pair sits in the dogfood-tight floor regime — not a re-run of the original LLM measurement.`);
    L.push(`- corpus-expansion range (min/median/max): **LLM-dependent -> Task 4** (\`mc-range.js\`), excluded from this deterministic verdict.`);
  } else {
    L.push('- no floor pair declared in the manifest.');
  }
  L.push('');
  L.push('## Per-file');
  L.push('');
  L.push('| file | source | live | baseline(tok) | dup | dead | lowdensity | structural(tok) | marginal |');
  L.push('| ---- | ------ | ---- | ------------- | --- | ---- | ---------- | --------------- | -------- |');
  for (const f of r.files) {
    L.push(`| \`${f.path}\` | ${f.source} | ${f.live ? 'yes' : 'no'} | ${f.baselineTokens} | ${f.counts.dup} | ${f.counts.dead} | ${f.counts.lowdensity} | ${f.structuralTokens} | ${pct(f.structuralMarginalPct)} |`);
  }
  // collapse any accidental multi-blank and strip trailing blanks (writeReports
  // appends exactly one newline -> markdownlint MD012/MD047 clean).
  return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
}

export function writeReports(env = process.env) {
  const report = buildReport(env);
  const md = renderMarkdown(report);
  writeFileSync(join(HERE, 'results', 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(HERE, 'results', 'report.md'), md + '\n');
  return { report, md };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { report, md } = writeReports();
  if (process.argv.includes('--print')) console.info(md);
  else console.info(`context-audit verdict: ${report.verdict} (marginal median ${report.marginal.medianPct}%, structural precision ${report.scoring.structuralPrecision})`);
}
