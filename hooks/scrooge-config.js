// scrooge-config.js — shared state + valid-value module for Scrooge hooks.
//
// Single source of truth for:
//   - the set of valid languages / dials
//   - the {lang, dial} session-state file location + the statusline suffix file
//   - symlink-safe, size-capped, whitelist/sanitized read/write of both
//
// The activation hook (writer), the stats hook (reader + suffix writer), and
// the statusline both go through this module so they share one schema and one
// hardened I/O path.
//
// Security note: these file paths are predictable (~/.claude/.scrooge-*).
// A local attacker could replace one with a symlink pointing at a secret
// (e.g. ~/.ssh/id_rsa) so that every reader slurps that content and injects it
// into the model context or renders it on the statusline. We defend with
// O_NOFOLLOW, a hard size cap, and value validation/sanitization — anything
// anomalous yields null (or empty) and nothing is injected.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const VALID_LANGS = ['ko', 'en', 'ja'];
export const VALID_DIALS = ['lite', 'full'];
// Behavior/input flags, orthogonal to dial. Whitelist-only: any token outside
// this set is dropped (never persisted, never injected). `lean` is the lone flag.
export const VALID_FLAGS = ['lean'];
// `lean` is ON by default — measured ~21% output reduction by cutting bloat
// (over-engineering, alternative-narration), never correctness (its fragment pins
// the safety floor). Opt out with `nolean` / SCROOGE_DEFAULT_FLAGS.
export const DEFAULT_ON_FLAGS = ['lean'];
export const DEFAULT_STATE = { lang: 'en', dial: 'full', flags: [...DEFAULT_ON_FLAGS] };

// Parse a comma-separated flag list (e.g. SCROOGE_DEFAULT_FLAGS) into a
// whitelisted, deduped array in VALID_FLAGS order. Unknown tokens are dropped so
// a typo or an injected value never reaches the state file.
export function parseFlagList(raw) {
  if (typeof raw !== 'string') return [];
  const present = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return VALID_FLAGS.filter((f) => present.has(f));
}

// Activation-default flags. SCROOGE_DEFAULT_FLAGS overrides when SET — including
// an empty value, which disables all flags. When UNSET, flags default ON
// (DEFAULT_ON_FLAGS) so a bare `/scrooge` already delivers maximal reduction.
export function defaultFlags() {
  const raw = process.env.SCROOGE_DEFAULT_FLAGS;
  if (raw === undefined) return [...DEFAULT_ON_FLAGS];
  return parseFlagList(raw);
}

// Longest legitimate state payload is ~45 bytes
// ({"lang":"ko","dial":"full","flags":["lean"]}). The suffix is a short
// pre-rendered badge string ("⛏ ~12.3k saved (est)"). 256 keeps ample headroom
// for the flags array without widening the symlink-clobber read window.
const MAX_STATE_BYTES = 256;
const MAX_SUFFIX_BYTES = 128;
// Version marker is a short semver-ish string ("0.9.0", "1.0.0-rc.1").
const MAX_VERSION_BYTES = 32;

const O_NOFOLLOW =
  typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Filesystem-safe session key. The key lands in a predictable filename
// (`.scrooge-active-<key>`), so an attacker-controlled session_id must never
// carry path separators or `..`. Strip everything outside [A-Za-z0-9_-] (drops
// `/`, `.`, whitespace), cap the length, and return null when nothing remains —
// callers then fall back to the global (sessionless) path.
export function sanitizeSessionKey(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}

// Canonical session key shared by every surface (activate, SessionStart,
// statusline, stats). Claude Code names the transcript `<session_id>.jsonl`, so
// session_id and the transcript stem are the same value — either source yields
// the same key, keeping all surfaces pointed at one state file. Returns null on
// a sessionless host (skill-only), which selects the global fallback path.
export function deriveSessionKey(payload = {}) {
  const fromId = sanitizeSessionKey(payload.session_id);
  if (fromId) return fromId;
  if (typeof payload.transcript_path === 'string') {
    return sanitizeSessionKey(path.basename(payload.transcript_path, '.jsonl'));
  }
  return null;
}

// State file path. With a sessionKey it is per-session
// (`.scrooge-active-<key>`, glob-cleanable as `.scrooge-active-*`); without one
// it is the legacy global `.scrooge-active`, kept as the sessionless fallback.
//
// Migration of the pre-session-scope global state is "ignore" (per spec
// "무시/정리"): a session that was active before the upgrade resolves to its
// (absent) per-session file and is treated as inactive for one turn — the user
// re-issues `/scrooge` once. We deliberately do NOT promote the global value into
// sessions, because this same path doubles as the live sessionless fallback, so
// promoting would leak one session's state into every fresh session — the exact
// isolation bug this task fixes. Per-session files are bounded by the SessionStart
// TTL sweep; the shared global is left for sessionless hosts.
export function getStatePath(sessionKey) {
  const base = sessionKey ? `.scrooge-active-${sessionKey}` : '.scrooge-active';
  return path.join(claudeDir(), base);
}

// Global activation default (`~/.claude/.scrooge-default`). Same {lang,dial,flags}
// schema as the session state, read/written through the same hardened path.
// Activation writes it, a fresh session with no per-session state seeds from it
// (auto-activate everywhere), and `/scrooge off` clears it (global off). NOT
// session-scoped — one shared default seeds every new session, while live sessions
// keep their own per-session state (so an off in one session never clobbers a peer).
export function getDefaultPath() {
  return path.join(claudeDir(), '.scrooge-default');
}

// Last-seen installed version marker (`~/.claude/.scrooge-version`). The
// SessionStart hook compares it against the package version to detect an upgrade
// and remind a now-inactive prior user how to re-activate.
export function getVersionPath() {
  return path.join(claudeDir(), '.scrooge-version');
}

export function getSuffixPath() {
  return path.join(claudeDir(), '.scrooge-statusline-suffix');
}

export function isValidState(state) {
  if (!state || typeof state !== 'object') return false;
  if (!VALID_LANGS.includes(state.lang) || !VALID_DIALS.includes(state.dial)) {
    return false;
  }
  // flags is optional for backward compat: a legacy {lang,dial} file (no flags)
  // validates and is normalized to [] by readState. When present it must be an
  // array of whitelisted tokens — a non-array or any unknown token (e.g. an
  // injected ['xss']) marks tampering and fails the whole state closed.
  if (state.flags === undefined) return true;
  return (
    Array.isArray(state.flags) && state.flags.every((f) => VALID_FLAGS.includes(f))
  );
}

// Resolve a directory to its real path, refusing attacker-planted symlinks.
// When the dir is itself a symlink (legitimate: ~/.claude symlinked to shared
// storage), resolve through and verify ownership; refuse if the resolved dir is
// owned by another user (Unix) or lives outside the home tree (Windows).
// Returns the safe real dir, or null if it must be refused.
function resolveSafeDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const lst = fs.lstatSync(dir);
    if (!lst.isSymbolicLink()) return dir;
    const real = fs.realpathSync(dir);
    const realStat = fs.statSync(real);
    if (!realStat.isDirectory()) return null;
    if (typeof process.getuid === 'function') {
      return realStat.uid === process.getuid() ? real : null;
    }
    const home = path.resolve(os.homedir()).toLowerCase();
    const rp = path.resolve(real).toLowerCase();
    return rp === home || rp.startsWith(home + path.sep) ? real : null;
  } catch (e) {
    return null;
  }
}

// Symlink-safe atomic write (temp + rename, 0600, O_NOFOLLOW|O_EXCL).
// The target file must never be a symlink — that is the clobber vector.
// Exported so the lifetime ledger (lib/ledger.js) writes its history file through
// the same hardened path as the state/suffix files (same predictable-path risk).
export function safeWriteFile(targetPath, content) {
  const debug = process.env.SCROOGE_DEBUG === '1';
  try {
    const realDir = resolveSafeDir(path.dirname(targetPath));
    if (!realDir) return false;
    const realPath = path.join(realDir, path.basename(targetPath));

    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return false;
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }

    const tmp = path.join(realDir, `.scrooge.tmp.${process.pid}.${Date.now()}`);
    let created = false;
    try {
      let fd;
      try {
        // O_EXCL: fail rather than open a pre-existing file. created flips only
        // after we own the temp, so the cleanup below never unlinks another
        // process's file.
        fd = fs.openSync(
          tmp,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
          0o600
        );
        created = true;
        fs.writeSync(fd, String(content));
        try {
          fs.fchmodSync(fd, 0o600);
        } catch (e) {
          /* best-effort on Windows */
        }
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      fs.renameSync(tmp, realPath);
      return true;
    } catch (e) {
      // Clean up our temp file on any write/rename failure so we don't leak
      // .scrooge.tmp.* in the config dir. Only unlink what we created.
      if (created) {
        try {
          fs.unlinkSync(tmp);
        } catch (_) {
          /* best-effort */
        }
      }
      throw e;
    }
  } catch (e) {
    if (debug) process.stderr.write(`[scrooge] safeWriteFile failed: ${e.message}\n`);
    return false;
  }
}

// Symlink-safe, size-capped read. Returns the raw string or null on any anomaly.
// Exported for the lifetime ledger (lib/ledger.js); callers pass their own cap.
export function safeReadFile(targetPath, maxBytes) {
  try {
    let st;
    try {
      st = fs.lstatSync(targetPath);
    } catch (e) {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > maxBytes) return null;

    let fd;
    try {
      fd = fs.openSync(targetPath, fs.constants.O_RDONLY | O_NOFOLLOW);
      const buf = Buffer.alloc(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
}

export function readState(statePath = getStatePath()) {
  const raw = safeReadFile(statePath, MAX_STATE_BYTES);
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  // Preserve flags; a legacy file without them normalizes to []. isValidState
  // rejects a present-but-invalid flags value (non-array / unknown token), so a
  // tampered flags field fails closed to null instead of being silently dropped.
  const state = {
    lang: parsed.lang,
    dial: parsed.dial,
    flags: parsed.flags === undefined ? [] : parsed.flags,
  };
  return isValidState(state) ? state : null;
}

export function writeState(state, statePath = getStatePath()) {
  if (!isValidState(state)) return false;
  return safeWriteFile(
    statePath,
    JSON.stringify({
      lang: state.lang,
      dial: state.dial,
      flags: Array.isArray(state.flags) ? state.flags : [],
    })
  );
}

// Remove the state file (deactivate). unlinkSync does not follow symlinks — it
// removes the link itself — so this is safe even if the path was tampered with.
// ENOENT (already absent) is treated as success.
export function clearState(statePath = getStatePath()) {
  try {
    fs.unlinkSync(statePath);
    return true;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

// Resolve the active state for a session path: the session's own per-session
// state, or — when absent — the global default (getDefaultPath), seeded into the
// session file so per-turn reinjection and `/scrooge off` operate on a real
// per-session file thereafter. Returns null when neither exists (inactive).
// Per-session state always wins over the global default.
export function resolveActiveState(statePath = getStatePath(), defaultPath = getDefaultPath()) {
  const own = readState(statePath);
  if (own) return own;
  const def = readState(defaultPath);
  if (!def) return null;
  writeState(def, statePath); // seed so the session is self-contained hereafter
  return def;
}

// Strip control bytes (terminal-escape / OSC injection) and cap the byte length.
// Keeps printable UTF-8 (including the miser glyph) intact.
function sanitizeSuffix(text) {
  // eslint-disable-next-line no-control-regex
  const stripped = String(text).replace(/[\x00-\x1f\x7f]/g, '');
  return Buffer.from(stripped, 'utf8').subarray(0, MAX_SUFFIX_BYTES).toString('utf8').trim();
}

// Pre-rendered statusline suffix written by the stats hook and read by the
// statusline. Same clobber surface as the state file, so same hardening.
export function writeSuffix(text, suffixPath = getSuffixPath()) {
  return safeWriteFile(suffixPath, sanitizeSuffix(text));
}

export function readSuffix(suffixPath = getSuffixPath()) {
  const raw = safeReadFile(suffixPath, MAX_SUFFIX_BYTES);
  return raw === null ? '' : sanitizeSuffix(raw);
}

// Keep only semver-safe characters so a tampered marker can never carry an
// injection payload into the upgrade notice. Empty → null.
function sanitizeVersion(raw) {
  const v = String(raw).replace(/[^0-9A-Za-z.\-+]/g, '').slice(0, MAX_VERSION_BYTES);
  return v.length > 0 ? v : null;
}

export function readVersionMarker(versionPath = getVersionPath()) {
  const raw = safeReadFile(versionPath, MAX_VERSION_BYTES);
  return raw === null ? null : sanitizeVersion(raw);
}

export function writeVersionMarker(version, versionPath = getVersionPath()) {
  const v = sanitizeVersion(version);
  return v === null ? false : safeWriteFile(versionPath, v);
}
