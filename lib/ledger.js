// ledger.js — lifetime savings ledger + the honest-bill delta contract.
//
// Accumulates per-session savings into ~/.claude/.scrooge-history.jsonl so the
// miser sees a lifetime total, not just the current session. Each session is ONE
// entry, upserted by session id: re-running /scrooge-stats in the same session
// OVERWRITES that session's entry instead of appending, so the lifetime total
// never double-counts (the same dedup discipline Task 1 applied within a session,
// now at the ledger layer). The history path is as predictable as the state file,
// so reads/writes go through scrooge-config's symlink-safe, size-capped I/O.
//
// One honest bill: a session entry carries the output-side savings (savedTokens,
// owned by upsertSession), the static self-injection overhead, an uncompressed
// reasoning line, and per-source INPUT-side savings under the shared delta
// contract (recordInputDelta — the single schema any input-side surface feeds;
// memory-compress is the current contributor). aggregateLedger nets them: output
// + input − overhead; reasoning is reported apart and never counted as a saving.
//
// This module is pure: callers pass `ts`/`since` (no Date.now() here), so the
// aggregation is deterministic and testable like the rest of lib/.

import path from 'node:path';
import os from 'node:os';
import { safeReadFile, safeWriteFile } from '../hooks/scrooge-config.js';

// ~150 bytes/line × MAX_SESSIONS stays well under this; an oversized file (the
// size-cap anomaly) reads as empty, same defensive posture as the state file.
const MAX_HISTORY_BYTES = 256 * 1024;
// Keep only the most recent N sessions so the file cannot grow without bound.
const MAX_SESSIONS = 1000;

// Approximate output-token prices (USD per million), by model family. Hardcoded
// and labelled "(est)" everywhere — provider prices drift, so this is a rough
// receipt, not an invoice. Unknown models contribute no currency figure.
const OUTPUT_USD_PER_MTOK = { opus: 15, sonnet: 3, haiku: 0.8 };

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function getHistoryPath() {
  return path.join(claudeDir(), '.scrooge-history.jsonl');
}

export function priceForModel(model) {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.includes('opus')) return OUTPUT_USD_PER_MTOK.opus;
  if (m.includes('sonnet')) return OUTPUT_USD_PER_MTOK.sonnet;
  if (m.includes('haiku')) return OUTPUT_USD_PER_MTOK.haiku;
  return null;
}

// Parse the history file into Map<sessionId, entry>, last-wins per id so even a
// hand-appended duplicate collapses on read. Never throws.
function readEntries(historyPath) {
  const raw = safeReadFile(historyPath, MAX_HISTORY_BYTES);
  const byId = new Map();
  if (raw === null) return byId;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (e && typeof e.sessionId === 'string' && e.sessionId) byId.set(e.sessionId, e);
  }
  return byId;
}

// Validate the per-source input-delta map: { [source]: { baseline, saved } }.
// Each source key is a non-empty string; baseline/saved coerce to finite >= 0.
// Anything malformed (non-object, negative, NaN) is dropped so a tampered or
// partial line can never poison the aggregate sum.
function normalizeDeltas(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [source, d] of Object.entries(raw)) {
    if (!source || !d || typeof d !== 'object') continue;
    const baseline = Number(d.baseline) || 0;
    const saved = Number(d.saved) || 0;
    if (baseline < 0 || saved < 0) continue;
    out[source] = { baseline, saved };
  }
  return out;
}

function normalizeEntry(entry) {
  return {
    sessionId: entry.sessionId,
    model: typeof entry.model === 'string' ? entry.model : null,
    proseOutputTokens: Number(entry.proseOutputTokens) || 0,
    savedTokens: Number(entry.savedTokens) || 0,
    // Reasoning is an uncompressed cost reported on its own honest-bill line —
    // never folded into the savings base. Self overhead is the static token cost
    // of the register Scrooge injects (a negative contribution to the net bill).
    reasoningTokens: Number(entry.reasoningTokens) || 0,
    inputOverheadTokens: Number(entry.inputOverheadTokens) || 0,
    // Per-source input-side savings (e.g. memory-compress) under the shared delta
    // contract — see recordInputDelta.
    inputDeltas: normalizeDeltas(entry.inputDeltas),
    ts: Number(entry.ts) || 0,
  };
}

// Idempotent upsert: set this session's entry to its CURRENT totals (absolute,
// not a delta) and rewrite the file. Running N times for one session yields one
// entry. Returns false on invalid input or a refused (symlinked) write.
//
// The spec mandates upsert (not append) so a lifetime total never double-counts a
// session re-running /scrooge-stats — that is the primary correctness goal and is
// fully met (absolute totals → same-session reruns are idempotent). The read-
// merge-write is NOT atomic, so two DIFFERENT sessions running /scrooge-stats in
// the same microsecond window could lose-update (the later rewrite drops the
// other's just-written entry). This is an accepted trade-off: the trigger is
// vanishingly narrow for an interactive command, the effect is a one-line
// under-count (never corruption or double-count), and it self-heals — the
// affected session re-upserts its entry on its next stats run.
// Serialize the entry map back to the history file, capping to the most recent
// MAX_SESSIONS. Shared by the output-side upsert and the input-delta recorder.
function writeEntries(byId, historyPath) {
  let entries = [...byId.values()];
  if (entries.length > MAX_SESSIONS) {
    entries = entries.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_SESSIONS);
  }
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  return safeWriteFile(historyPath, body);
}

export function upsertSession(entry, historyPath = getHistoryPath()) {
  if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) return false;
  const byId = readEntries(historyPath);
  const next = normalizeEntry(entry);
  // upsertSession owns the output-side fields (savedTokens/reasoning/overhead);
  // recordInputDelta owns inputDeltas. Preserve any input-side deltas a surface
  // already recorded this session unless the caller explicitly carries them, so a
  // /scrooge-stats run does not wipe #4~#6 contributions (and vice versa).
  if (entry.inputDeltas === undefined) {
    const prior = byId.get(entry.sessionId);
    if (prior) next.inputDeltas = normalizeDeltas(prior.inputDeltas);
  }
  byId.set(entry.sessionId, next);
  return writeEntries(byId, historyPath);
}

// Shared input-savings delta contract. The single schema every input-side
// absorption surface uses to contribute its savings to the one honest bill —
// instead of each keeping ad hoc per-feature accounting (which double- or
// under-counts). A delta is { sessionKey, source, baseline, saved }:
//   sessionKey — canonical session id (the same key every surface shares),
//   source     — contributing surface ('memory-compress' | ...),
//   baseline   — uncompressed input tokens for that surface this session,
//   saved      — tokens removed (baseline − compressed), >= 0.
// Idempotent on (sessionKey, source): re-recording a source OVERWRITES its delta
// (absolute, not additive), so a surface that re-runs in one session never
// double-counts — the same upsert discipline the output ledger uses per session.
// Preserves the session's output-side fields (owned by upsertSession). Returns
// false on invalid input or a refused (symlinked) write.
export function recordInputDelta(delta, historyPath = getHistoryPath()) {
  if (!delta || typeof delta.sessionKey !== 'string' || !delta.sessionKey) return false;
  if (typeof delta.source !== 'string' || !delta.source) return false;
  const baseline = Number(delta.baseline) || 0;
  const saved = Number(delta.saved) || 0;
  if (baseline < 0 || saved < 0) return false;

  const byId = readEntries(historyPath);
  const prior = byId.get(delta.sessionKey);
  const entry = prior
    ? normalizeEntry(prior)
    : normalizeEntry({ sessionId: delta.sessionKey, ts: Number(delta.ts) || 0 });
  if (!prior && typeof delta.model === 'string') entry.model = delta.model;
  entry.inputDeltas[delta.source] = { baseline, saved };
  byId.set(delta.sessionKey, entry);
  return writeEntries(byId, historyPath);
}

// Aggregate lifetime (or windowed) totals. `since` is an inclusive ms-epoch lower
// bound; when set, entries without a ts (or older) are excluded. Currency sums
// each session's saved tokens at its own model's rate; sessions on an unknown
// model contribute tokens but no USD.
export function aggregateLedger({ since = null } = {}, historyPath = getHistoryPath()) {
  const byId = readEntries(historyPath);
  let savedTokens = 0; // output-side (register) savings
  let proseOutputTokens = 0;
  let inputSavedTokens = 0; // sum of #4~#6 input-side deltas
  let inputOverheadTokens = 0; // Scrooge's own injected register cost
  let reasoningTokens = 0; // uncompressed, reported separately (never netted)
  const bySource = {}; // input savings broken down by contributing surface
  let savedUsd = 0;
  let sessions = 0;
  for (const raw of byId.values()) {
    const e = normalizeEntry(raw);
    if (since != null && (!e.ts || e.ts < since)) continue;
    savedTokens += e.savedTokens;
    proseOutputTokens += e.proseOutputTokens;
    reasoningTokens += e.reasoningTokens;
    inputOverheadTokens += e.inputOverheadTokens;
    let sessionInputSaved = 0;
    for (const [source, d] of Object.entries(e.inputDeltas)) {
      inputSavedTokens += d.saved;
      sessionInputSaved += d.saved;
      bySource[source] = (bySource[source] || 0) + d.saved;
    }
    // Monetize the NET token figure (output saved + input saved − self overhead)
    // at this session's model rate. Reasoning is excluded — it is not a saving.
    const price = priceForModel(e.model);
    if (price != null) {
      savedUsd += ((e.savedTokens + sessionInputSaved - e.inputOverheadTokens) / 1e6) * price;
    }
    sessions++;
  }
  const netSavedTokens = savedTokens + inputSavedTokens - inputOverheadTokens;
  return {
    savedTokens,
    inputSavedTokens,
    inputOverheadTokens,
    reasoningTokens,
    netSavedTokens,
    bySource,
    proseOutputTokens,
    savedUsd,
    sessions,
  };
}

// Parse a `--since` window like "7d" / "24h" / "30d" into an inclusive ms-epoch
// lower bound relative to `now`. Returns null for an empty/invalid window (→ the
// caller treats it as all-time). `now` is injected so the parse stays pure.
export function sinceToEpoch(window, now) {
  if (typeof window !== 'string') return null;
  const m = /^(\d+)\s*([dh])$/.exec(window.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  const unitMs = m[2] === 'd' ? 86400000 : 3600000;
  return now - n * unitMs;
}
