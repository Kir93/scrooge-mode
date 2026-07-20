// context-audit/lib.js — shared foundation for the Phase 0 measurement harness.
//
// Deterministic, zero-dep, LLM-free. Provides: corpus loader (explicit failure on
// a missing path, never a silent skip), byte/token wrappers, protected-span
// masking (a removal view where protected bytes count as 0 — honest, since the
// product guard cannot remove them), and label-schema validation.
//
// REUSES the shipped deterministic APIs — never reimplements them:
//   estimateTokens   (hooks/scrooge-stats.js)   token unit, honest-bill-aligned
//   protectedSpans   (lib/memory-compress.js)   security/code/path/URL spans
// verifyPreservation / compressionDelta (lib/memory-compress.js) are consumed by
// the detectors (Task 2) and runner (Task 3), imported there directly.

import { readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { estimateTokens } from '../../hooks/scrooge-stats.js';
import { protectedSpans } from '../../lib/memory-compress.js';

export { estimateTokens };

const HERE = dirname(fileURLToPath(import.meta.url));
// repo root is two levels up from benchmarks/context-audit/
export const REPO_ROOT = join(HERE, '..', '..');

export const byteLen = (text) =>
  Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8');

// Resolve a manifest entry's path. synthetic / floor paths are relative to this
// benchmark dir; self-repo paths are repo-root-relative; local (private
// expansion) paths are taken as absolute, with a leading ~ expanded.
function resolveEntryPath(entry) {
  const p = entry.path;
  if (entry.source === 'local') {
    const abs = p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
    return isAbsolute(abs) ? abs : join(REPO_ROOT, abs);
  }
  if (entry.source === 'self-repo') return join(REPO_ROOT, p);
  return join(HERE, p); // synthetic, floor
}

// Load every manifest file deterministically. A missing path throws (no silent
// skip) so the measurement can never quietly run on a partial corpus.
export function loadCorpus(manifestPath = join(HERE, 'corpus.json')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = [];
  for (const entry of [...(manifest.files || []), ...(manifest.local_expansion || [])]) {
    const abs = resolveEntryPath(entry);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      throw new Error(`corpus: missing file "${entry.id}" at ${abs} (no silent skip)`);
    }
    files.push({ ...entry, abs, text });
  }
  return { manifest, files };
}

// Load the floor reference (original, compressed) pair for the deterministic
// compressionDelta re-measurement. Returns null if the manifest declares none.
// The leading HTML fixture comment is stripped so the delta measures the
// memory-file BODY only (the annotation is not compressible register prose).
export function loadFloorPair(manifest) {
  const fp = manifest && manifest.floor_pair;
  if (!fp) return null;
  const stripMeta = (s) => s.replace(/^<!--[\s\S]*?-->\s*/, '');
  const read = (rel) =>
    stripMeta(readFileSync(resolveEntryPath({ source: 'floor', path: rel }), 'utf8'));
  return { original: read(fp.original), compressed: read(fp.compressed), note: fp.anchor_note || '' };
}

// Derive protected CHAR ranges by locating each protectedSpans() result string in
// the text. The shipped API returns span strings (not offsets), so we reuse it and
// locate every occurrence, then merge overlaps.
export function protectedRanges(text) {
  if (typeof text !== 'string' || !text) return [];
  const uniq = [...new Set(protectedSpans(text))];
  const ranges = [];
  for (const span of uniq) {
    if (!span) continue;
    let i = 0;
    while ((i = text.indexOf(span, i)) !== -1) {
      ranges.push([i, i + span.length]);
      i += span.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// Removable saving for a [start,end) region: bytes/tokens NOT covered by any
// protected range. Protected bytes count as 0 (honest — un-removable by the guard).
export function maskedSaving(text, start = 0, end = text.length) {
  const ranges = protectedRanges(text);
  const prot = new Uint8Array(text.length);
  for (const [s, e] of ranges) for (let i = s; i < e && i < text.length; i++) prot[i] = 1;
  let removable = '';
  for (let i = Math.max(0, start); i < Math.min(end, text.length); i++) {
    if (!prot[i]) removable += text[i];
  }
  return { bytes: byteLen(removable), tokens: estimateTokens(removable), text: removable };
}

// ---------------------------------------------------------------------------
// Label schema
// ---------------------------------------------------------------------------

export const CATEGORIES = new Set(['dup', 'dead', 'lowdensity']);

export function validateLabel(label, i = 0) {
  if (!label || typeof label !== 'object') throw new Error(`label[${i}]: not an object`);
  if (typeof label.file !== 'string' || !label.file) throw new Error(`label[${i}]: missing "file"`);
  if (!CATEGORIES.has(label.category))
    throw new Error(`label[${i}]: bad category "${label.category}" (expected dup|dead|lowdensity)`);
  if (typeof label.anchor !== 'string' || !label.anchor) throw new Error(`label[${i}]: missing "anchor"`);
  return true;
}

export function loadLabels(labelsPath = join(HERE, 'labels.jsonl')) {
  const raw = readFileSync(labelsPath, 'utf8');
  const labels = [];
  raw.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      throw new Error(`labels.jsonl:${idx + 1}: invalid JSON`);
    }
    validateLabel(obj, idx);
    labels.push(obj);
  });
  return labels;
}
