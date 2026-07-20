// context-audit/detectors.js — three deterministic detectors (Phase 0 throwaway
// measurement prototypes, NOT product code). Each detection is
//   { file, category, spanText, start, end, removableBytes, removableTokens, ... }
// with protected-span masking applied, so we never count as saving what the
// product guard cannot remove.
//
// Categories:
//   dup         duplicate blocks (exact / normalized paragraph hash)
//   dead        dead-letter rules (broken path refs + stale markers)
//   lowdensity  low-density prose (filler dictionary + density heuristic)
//
// Only the DETERMINISTIC subset of each category is measured — semantic
// dead-letter judgment is a Non-goal (needs an LLM). Recall is honestly scoped to
// that subset. Zero-dep; reuses estimateTokens / protectedSpans / verifyPreservation.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { verifyPreservation } from '../../lib/memory-compress.js';
import { maskedSaving, byteLen, estimateTokens, REPO_ROOT } from './lib.js';

// ---------------------------------------------------------------------------
// Shared line/block helpers (deterministic, offset-tracking)
// ---------------------------------------------------------------------------

function lineOffsets(text) {
  const lines = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    lines.push({ text: raw, start, end: start + raw.length });
    start += raw.length + 1; // + '\n'
  }
  return lines;
}

function lineAt(lines, index) {
  for (const ln of lines) if (index >= ln.start && index <= ln.end) return ln;
  return lines[lines.length - 1];
}

// Split into paragraph blocks (blank-line separated), tracking trimmed offsets.
function splitBlocks(text) {
  const blocks = [];
  const sep = /\n[ \t]*\n/g;
  let last = 0;
  let m;
  const push = (s0, e0) => {
    const raw = text.slice(s0, e0);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const s = s0 + lead;
    const e = e0 - trail;
    if (e > s) blocks.push({ text: text.slice(s, e), start: s, end: e });
  };
  while ((m = sep.exec(text)) !== null) {
    push(last, m.index);
    last = sep.lastIndex;
  }
  push(last, text.length);
  return blocks;
}

// ---------------------------------------------------------------------------
// (i) Duplicate blocks — F2 guard-modeled removable
// ---------------------------------------------------------------------------

const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Removable for one duplicate block occurrence, modeling the product guard (F2):
// simulate removing this block and keep the saving ONLY if verifyPreservation still
// passes. A block whose removal drops a protected span's count (N->N-1) is REJECTed
// -> the whole block (prose included) counts 0.
function dupRemovable(text, block) {
  const candidate = text.slice(0, block.start) + text.slice(block.end);
  if (!verifyPreservation(text, candidate).ok) return { bytes: 0, tokens: 0, guardRejected: true };
  const masked = maskedSaving(text, block.start, block.end);
  return { bytes: masked.bytes, tokens: masked.tokens, guardRejected: false };
}

export function detectDuplicates(file, opts = {}) {
  const minLen = opts.minBlockLen ?? 40;
  const mode = opts.dupMode ?? 'exact'; // 'exact' | 'normalized'
  const blocks = splitBlocks(file.text).filter((b) => b.text.length >= minLen);
  const seen = new Set();
  const findings = [];
  for (const b of blocks) {
    const key = mode === 'normalized' ? normalize(b.text) : b.text;
    if (seen.has(key)) {
      const r = dupRemovable(file.text, b);
      findings.push({
        file: file.path,
        category: 'dup',
        kind: `dup-${mode}`,
        spanText: b.text,
        start: b.start,
        end: b.end,
        removableBytes: r.bytes,
        removableTokens: r.tokens,
        guardRejected: r.guardRejected,
      });
    } else {
      seen.add(key);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// (ii) Dead-letter rules — broken path refs + stale markers (deterministic subset)
// ---------------------------------------------------------------------------

// Stale markers: placeholder tokens TBD/TODO/FIXME/XXX and "until X lands/ships".
// Standalone "pending" is intentionally NOT matched — it is too loose on real prose
// ("pending review"), and the genuine stale case ("pending until X lands") is caught
// by the until-lands arm anyway. A TBD/TODO/etc. that is META-discussion of markers
// ("TBD markers are scaffolding") is excluded per the `markers?` look-ahead below.
const MARKER_RE = /\b(?:TBD|TODO|FIXME|XXX)\b|\buntil\b[^\n.]*?\blands?\b|\buntil\b[^\n.]*?\bships?\b/gi;

// A placeholder-token match is meta-discussion (not a real dead-letter) when the
// word "marker(s)" follows it closely — e.g. `"TBD — Task N" markers are scaffolding`.
function isMarkerMetaMention(match, index, text) {
  if (/^until/i.test(match)) return false;
  return /\bmarkers?\b/i.test(text.slice(index, index + 40));
}

// A repo-relative path candidate: has a slash, a trailing extension, no whitespace,
// and no template/glob/quote noise. Excludes URLs, ~, @alias, $VAR, absolute paths.
function isRepoRelPath(v) {
  if (!v || /[\s*?{}[\]<>"'|,`]/.test(v)) return false;
  if (/^(?:https?:|www\.|~|@|\$|\/)/.test(v)) return false;
  if (!v.includes('/')) return false;
  return /\.\w{1,6}$/.test(v);
}

function pathCandidates(text) {
  const out = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const v = m[1].trim();
    if (isRepoRelPath(v)) out.push({ value: v, index: m.index });
  }
  for (const m of text.matchAll(/(?<![\w./@~$`-])((?:\.{0,2}\/)?[\w.\-]+(?:\/[\w.\-]+)+\.\w+)/g)) {
    if (isRepoRelPath(m[1])) out.push({ value: m[1], index: m.index });
  }
  return out;
}

function pathResolves(rel, fileAbs) {
  if (existsSync(join(REPO_ROOT, rel))) return true;
  if (fileAbs && existsSync(join(dirname(fileAbs), rel))) return true;
  return false;
}

export function detectDeadLetter(file, opts = {}) {
  void opts;
  const text = file.text;
  const lines = lineOffsets(text);
  const findings = [];
  const seenRanges = new Set();
  const add = (index, kind, extra) => {
    const ln = lineAt(lines, index);
    const rangeKey = `${ln.start}:${ln.end}:${kind}`;
    if (seenRanges.has(rangeKey)) return;
    seenRanges.add(rangeKey);
    const m = maskedSaving(text, ln.start, ln.end);
    findings.push({
      file: file.path,
      category: 'dead',
      kind,
      spanText: ln.text,
      start: ln.start,
      end: ln.end,
      removableBytes: m.bytes,
      removableTokens: m.tokens,
      ...extra,
    });
  };
  for (const p of pathCandidates(text)) {
    if (!pathResolves(p.value, file.abs)) add(p.index, 'broken-path', { ref: p.value });
  }
  for (const mk of text.matchAll(MARKER_RE)) {
    if (isMarkerMetaMention(mk[0], mk.index, text)) continue;
    add(mk.index, 'stale-marker', { marker: mk[0] });
  }
  return findings.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// (iii) Low-density prose — filler dictionary + density heuristic
// ---------------------------------------------------------------------------

const FILLER = [
  // EN
  'basically', 'simply', 'just', 'really', 'actually', 'very', 'quite', 'pretty much',
  'in order to', 'at some point', 'somewhat', 'a bit', 'kind of', 'sort of',
  'probably', 'maybe', 'perhaps', 'honestly',
  // KO
  '사실', '그냥', '진짜', '기본적으로', '단순히', '다소', '어느 정도', '좀',
  '것 같', '로 보인', '수도 있',
];

function fillerRegex(f) {
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /[A-Za-z]/.test(f)
    ? new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`, 'gi')
    : new RegExp(esc, 'g');
}
const FILLER_RES = FILLER.map(fillerRegex);

function fillerHits(line) {
  const hits = [];
  for (const re of FILLER_RES) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) hits.push({ value: m[0], index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Operates per paragraph BLOCK (the unit memory-compress would rewrite), not per
// wrapped line — so a filler sentence spanning soft-wrapped lines is one finding.
export function detectLowDensity(file, opts = {}) {
  const minFiller = opts.minFiller ?? 2;
  const text = file.text;
  const findings = [];
  for (const block of splitBlocks(text)) {
    const t = block.text.trim();
    if (!t || t.startsWith('#') || t.startsWith('<!--') || t.startsWith('|')) continue;
    const hits = fillerHits(block.text);
    if (hits.length < minFiller) continue;
    let bytes = 0;
    let tokens = 0;
    for (const h of hits) {
      const s = block.start + h.index;
      const m = maskedSaving(text, s, s + h.value.length);
      bytes += m.bytes;
      tokens += m.tokens;
    }
    findings.push({
      file: file.path,
      category: 'lowdensity',
      kind: 'filler',
      spanText: block.text,
      start: block.start,
      end: block.end,
      removableBytes: bytes,
      removableTokens: tokens,
      fillerCount: hits.length,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

// Run all three detectors on one corpus file. `dupModes` controls which duplicate
// hash modes to report (both exact + normalized by default, thresholds exposed).
export function detectAll(file, opts = {}) {
  const dupModes = opts.dupModes ?? ['exact', 'normalized'];
  const dup = [];
  const seenDup = new Set();
  for (const mode of dupModes) {
    for (const f of detectDuplicates(file, { ...opts, dupMode: mode })) {
      // de-dup across modes by block range (normalized is a superset of exact)
      const key = `${f.start}:${f.end}`;
      if (seenDup.has(key)) continue;
      seenDup.add(key);
      dup.push(f);
    }
  }
  return [...dup, ...detectDeadLetter(file, opts), ...detectLowDensity(file, opts)];
}

export const _internals = { splitBlocks, lineOffsets, isRepoRelPath, pathCandidates, FILLER };
export { byteLen, estimateTokens };
