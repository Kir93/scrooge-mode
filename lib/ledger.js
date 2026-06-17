// ledger.js — lifetime savings ledger.
//
// Accumulates per-session savings into ~/.claude/.scrooge-history.jsonl so the
// miser sees a lifetime total, not just the current session. Each session is ONE
// entry, upserted by session id: re-running /scrooge-stats in the same session
// OVERWRITES that session's entry instead of appending, so the lifetime total
// never double-counts (the same dedup discipline Task 1 applied within a session,
// now at the ledger layer). The history path is as predictable as the state file,
// so reads/writes go through scrooge-config's symlink-safe, size-capped I/O.
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

function normalizeEntry(entry) {
  return {
    sessionId: entry.sessionId,
    model: typeof entry.model === 'string' ? entry.model : null,
    proseOutputTokens: Number(entry.proseOutputTokens) || 0,
    savedTokens: Number(entry.savedTokens) || 0,
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
export function upsertSession(entry, historyPath = getHistoryPath()) {
  if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) return false;
  const byId = readEntries(historyPath);
  byId.set(entry.sessionId, normalizeEntry(entry));

  let entries = [...byId.values()];
  if (entries.length > MAX_SESSIONS) {
    entries = entries.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_SESSIONS);
  }
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  return safeWriteFile(historyPath, body);
}

// Aggregate lifetime (or windowed) totals. `since` is an inclusive ms-epoch lower
// bound; when set, entries without a ts (or older) are excluded. Currency sums
// each session's saved tokens at its own model's rate; sessions on an unknown
// model contribute tokens but no USD.
export function aggregateLedger({ since = null } = {}, historyPath = getHistoryPath()) {
  const byId = readEntries(historyPath);
  let savedTokens = 0;
  let proseOutputTokens = 0;
  let savedUsd = 0;
  let sessions = 0;
  for (const raw of byId.values()) {
    const e = normalizeEntry(raw);
    if (since != null && (!e.ts || e.ts < since)) continue;
    savedTokens += e.savedTokens;
    proseOutputTokens += e.proseOutputTokens;
    const price = priceForModel(e.model);
    if (price != null) savedUsd += (e.savedTokens / 1e6) * price;
    sessions++;
  }
  return { savedTokens, proseOutputTokens, savedUsd, sessions };
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
