// scrooge-config.js — shared state + valid-value module for Scrooge hooks.
//
// Single source of truth for:
//   - the set of valid languages / dials
//   - the {lang, dial} session-state file location
//   - symlink-safe, size-capped, whitelist-validated read/write of that state
//
// Both the activation hook (writer) and the stats/statusline hook (reader)
// import this module so they share one schema and one hardened I/O path.
//
// Security note: the state file path is predictable (~/.claude/.scrooge-active).
// A local attacker could replace it with a symlink pointing at a secret
// (e.g. ~/.ssh/id_rsa) so that every reader slurps that content and injects it
// into the model context or prints it on the statusline. We defend with
// O_NOFOLLOW, a hard size cap, and a strict value whitelist — anything
// anomalous yields null and nothing is injected.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const VALID_LANGS = ['ko', 'en'];
export const VALID_DIALS = ['lite', 'full'];
export const DEFAULT_STATE = { lang: 'en', dial: 'full' };

// Longest legitimate payload is ~30 bytes ({"lang":"ko","dial":"full"}).
// 256 leaves slack without enabling meaningful exfiltration.
const MAX_STATE_BYTES = 256;

const O_NOFOLLOW =
  typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;

export function getStatePath() {
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, '.scrooge-active');
}

export function isValidState(state) {
  return (
    !!state &&
    typeof state === 'object' &&
    VALID_LANGS.includes(state.lang) &&
    VALID_DIALS.includes(state.dial)
  );
}

// Symlink-safe, size-capped, whitelist-validated read.
// Returns { lang, dial } or null on any anomaly. Never throws.
export function readState(statePath = getStatePath()) {
  try {
    let st;
    try {
      st = fs.lstatSync(statePath);
    } catch (e) {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_STATE_BYTES) return null;

    let fd;
    let raw;
    try {
      fd = fs.openSync(statePath, fs.constants.O_RDONLY | O_NOFOLLOW);
      const buf = Buffer.alloc(MAX_STATE_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_STATE_BYTES, 0);
      raw = buf.subarray(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    const state = { lang: parsed.lang, dial: parsed.dial };
    return isValidState(state) ? state : null;
  } catch (e) {
    return null;
  }
}

// Symlink-safe atomic write (temp + rename, 0600, O_NOFOLLOW|O_EXCL).
// Validates the value before touching disk. Returns true on success.
// When the parent dir is itself a symlink (legitimate: ~/.claude symlinked to
// shared storage), resolves through and verifies ownership; refuses if the
// resolved dir is owned by another user. The state file itself must never be a
// symlink — that is the actual clobber vector.
export function writeState(state, statePath = getStatePath()) {
  if (!isValidState(state)) return false;
  const debug = process.env.SCROOGE_DEBUG === '1';
  try {
    const dir = path.dirname(statePath);
    fs.mkdirSync(dir, { recursive: true });

    let realDir;
    try {
      const lst = fs.lstatSync(dir);
      if (lst.isSymbolicLink()) {
        realDir = fs.realpathSync(dir);
        const realStat = fs.statSync(realDir);
        if (!realStat.isDirectory()) return false;
        if (typeof process.getuid === 'function') {
          if (realStat.uid !== process.getuid()) return false;
        } else {
          const home = path.resolve(os.homedir()).toLowerCase();
          const rp = path.resolve(realDir).toLowerCase();
          if (rp !== home && !rp.startsWith(home + path.sep)) return false;
        }
      } else {
        realDir = dir;
      }
    } catch (e) {
      return false;
    }

    const realPath = path.join(realDir, path.basename(statePath));
    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return false;
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }

    const tmp = path.join(realDir, `.scrooge-active.${process.pid}.${Date.now()}`);
    let fd;
    try {
      fd = fs.openSync(
        tmp,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
        0o600
      );
      fs.writeSync(fd, JSON.stringify({ lang: state.lang, dial: state.dial }));
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
    if (debug) process.stderr.write(`[scrooge] writeState failed: ${e.message}\n`);
    return false;
  }
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
