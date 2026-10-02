// ledger.js — lifetime savings ledger + the honest-bill delta contract.
//
// Accumulates per-session savings into ~/.claude/.scrooge/history.jsonl so the
// miser sees a lifetime total, not just the current session. Each session is ONE
// entry, upserted by session id: re-running /scrooge-stats in the same session
// OVERWRITES that session's entry instead of appending, so the lifetime total
// never double-counts (the same dedup discipline Task 1 applied within a session,
// now at the ledger layer). The history path is as predictable as the state file,
// so reads/writes go through scrooge-config's symlink-safe, size-capped I/O.
//
// One honest bill: a session entry carries the output-side savings (savedTokens),
// the static self-injection overhead, and an uncompressed reasoning line.
// aggregateLedger nets output − overhead; reasoning is reported apart and never
// counted as a saving. Input-side savings were removed in v0.23.0 along with
// memory-compress: its Phase 0 measured a 7.7% floor, context-audit put the
// realizable live median at ~3–4%, and compressing a prompt-cached prefix is worth
// close to nothing once cache reads are priced at 0.1x input.
//
// This module is pure: callers pass `ts`/`since` (no Date.now() here), so the
// aggregation is deterministic and testable like the rest of lib/.

import {
  safeReadFile,
  safeWriteFile,
  isRegularFile,
  getHistoryPath,
} from '../hooks/scrooge-config.js';

// Re-exported so existing consumers/tests keep one import site for the path.
export { getHistoryPath };

// The read cap. A file over this reads as null — so the write side must never
// produce one, or the next session would see "empty" and overwrite a lifetime of
// entries. writeEntries therefore trims in THIS unit (bytes), not in sessions.
const MAX_HISTORY_BYTES = 256 * 1024;
// Coarse upper bound on retained sessions, applied before the byte trim. It is no
// longer the binding cap: at the measured worst-case entry size (a Codex 64-char
// session key) 1000 sessions would be past the read cap, which is exactly the
// mismatch that used to collapse the file.
const MAX_SESSIONS = 1000;

// Approximate prices (USD per million tokens), by model family. Hardcoded and
// labelled "(est)" everywhere — provider prices drift, so this is a rough receipt,
// not an invoice. Unknown models contribute no currency figure.
//
// Output and input are separate rates because the bill nets two different things:
// savedTokens is OUTPUT the register did not emit, while inputOverheadTokens is
// INPUT the register did inject. Through v0.22.1 one table priced both, and its
// values were an older generation's INPUT prices mislabelled as output — so the
// savings were monetized ~40% low and the overhead subtracted at ~3x its real
// cost. Both errors understated the net, which is the safe direction, but neither
// was correct. The injected register is billed as input and is usually inside the
// prompt-cached prefix (cache reads are ~0.1x input), so charging it at the full
// input rate remains deliberately conservative.
const OUTPUT_USD_PER_MTOK = { opus: 25, sonnet: 15, haiku: 5 };
const INPUT_USD_PER_MTOK = { opus: 5, sonnet: 3, haiku: 1 };

function familyOf(model) {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return null;
}

export function priceForModel(model) {
  const family = familyOf(model);
  return family ? OUTPUT_USD_PER_MTOK[family] : null;
}

export function inputPriceForModel(model) {
  const family = familyOf(model);
  return family ? INPUT_USD_PER_MTOK[family] : null;
}

// Parse the history file into { byId, unreadable }. byId is Map<sessionId, entry>,
// last-wins per id so even a hand-appended duplicate collapses on read. Never
// throws. `unreadable` is true when the file was there before the read yet the
// read still yielded nothing — the entries exist but could not be loaded (past
// the size cap being the expected cause), so a writer must refuse rather than
// treat the empty map as "no history yet". Statting before reading keeps that
// decision fail-closed if the file changes underneath.
function readEntries(historyPath) {
  const existed = isRegularFile(historyPath);
  const raw = safeReadFile(historyPath, MAX_HISTORY_BYTES);
  const byId = new Map();
  if (raw === null) return { byId, unreadable: existed };
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
  return { byId, unreadable: false };
}

// An unreadable history is a data-loss risk the user can act on (trim or move the
// file), so it is never silent — this warning is not debug-gated.
function warnUnreadable(historyPath) {
  process.stderr.write(
    `[scrooge] history file exists but could not be read (likely over the ` +
      `${MAX_HISTORY_BYTES} byte cap) — refusing to overwrite ${historyPath}. ` +
      `Lifetime totals are paused until it is trimmed or moved.\n`
  );
}

// Legacy `inputDeltas` / `baseline` keys on an existing entry are simply not read
// — a ledger written before v0.23.0 stays readable and needs no migration; the
// fields are ignored on read and dropped on the next upsert of that session.
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
// Serialize the entry map back to the history file, keeping only what fits under
// BOTH caps: at most MAX_SESSIONS entries and at most MAX_HISTORY_BYTES of file.
// The byte trim is what keeps the written file readable by the next session
// regardless of how large individual entries grow.
//
// `keepId` is the session this call is writing. It is placed first so the trim can
// never drop the very entry being recorded — the rest are ordered newest-first and
// the oldest fall off the end. Without the pin, a caller that records no timestamp
// (its entry sorts as ts 0) would silently lose its write on a near-full file and
// still be told it succeeded.
function writeEntries(byId, historyPath, keepId) {
  const rest = [...byId.values()]
    .filter((e) => e.sessionId !== keepId)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const pinned = byId.get(keepId);
  const entries = pinned ? [pinned, ...rest] : rest;

  const lines = [];
  let bytes = 1; // trailing newline
  for (const e of entries) {
    if (lines.length >= MAX_SESSIONS) break;
    const line = JSON.stringify(e);
    const add = Buffer.byteLength(line, 'utf8') + (lines.length ? 1 : 0);
    if (bytes + add > MAX_HISTORY_BYTES) break;
    lines.push(line);
    bytes += add;
  }
  // A single entry larger than the whole cap would produce a file the next read
  // rejects, permanently freezing every later write. Refuse instead.
  if (lines.length === 0) {
    warnUnreadable(historyPath);
    return false;
  }
  return safeWriteFile(historyPath, lines.join('\n') + '\n');
}

export function upsertSession(entry, historyPath = getHistoryPath()) {
  if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) return false;
  const { byId, unreadable } = readEntries(historyPath);
  if (unreadable) {
    warnUnreadable(historyPath);
    return false;
  }
  byId.set(entry.sessionId, normalizeEntry(entry));
  return writeEntries(byId, historyPath, entry.sessionId);
}

// Aggregate lifetime (or windowed) totals. `since` is an inclusive ms-epoch lower
// bound; when set, entries without a ts (or older) are excluded. Currency sums
// each session's saved tokens at its own model's rate; sessions on an unknown
// model contribute tokens but no USD.
export function aggregateLedger({ since = null } = {}, historyPath = getHistoryPath()) {
  const { byId, unreadable } = readEntries(historyPath);
  let savedTokens = 0; // output-side (register) savings
  let proseOutputTokens = 0;
  let inputOverheadTokens = 0; // Scrooge's own injected register cost
  let reasoningTokens = 0; // uncompressed, reported separately (never netted)
  let savedUsd = 0;
  let sessions = 0;
  for (const raw of byId.values()) {
    const e = normalizeEntry(raw);
    if (since != null && (!e.ts || e.ts < since)) continue;
    savedTokens += e.savedTokens;
    proseOutputTokens += e.proseOutputTokens;
    reasoningTokens += e.reasoningTokens;
    inputOverheadTokens += e.inputOverheadTokens;
    // Each side is monetized at its own rate: savedTokens is output the register
    // did not emit, inputOverheadTokens is input it did inject. Netting the two
    // token counts first and pricing the remainder once would value an input token
    // at the output rate — the bug this replaced. Reasoning is excluded entirely:
    // it is a cost, not a saving.
    const outPrice = priceForModel(e.model);
    const inPrice = inputPriceForModel(e.model);
    if (outPrice != null && inPrice != null) {
      savedUsd += (e.savedTokens / 1e6) * outPrice - (e.inputOverheadTokens / 1e6) * inPrice;
    }
    sessions++;
  }
  const netSavedTokens = savedTokens - inputOverheadTokens;
  return {
    savedTokens,
    inputOverheadTokens,
    reasoningTokens,
    netSavedTokens,
    proseOutputTokens,
    savedUsd,
    sessions,
    // True when the history file exists but could not be read: the totals above
    // are zeros because nothing could be loaded, NOT because nothing was ever
    // recorded. A stats surface should say so rather than report 0.
    unreadable,
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
