// SessionEnd hook: drop the ended session's per-session state marker when it
// carries no information beyond the saved global default.
//
// A fresh (or resumed) session with no per-session state re-seeds from
// `.scrooge-default`, so a marker that equals the default is pure redundancy
// once the session ends. Deleting it here caps `.scrooge-active-*`
// accumulation at "sessions holding an explicit override + crashed sessions"
// — the latter remain bounded by the SessionStart 14-day sweep. Markers that
// DIFFER from the default (session-local off, other lang/dial/flags) are kept
// so resuming that session retains its override.
//
// Best-effort and fail-silent: session teardown must never break on hygiene.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveSessionKey, getStatePath, getDefaultPath, readState } from './scrooge-config.js';

function sameState(a, b) {
  if (!a || !b) return false;
  if (a.lang !== b.lang || a.dial !== b.dial) return false;
  const fa = [...(a.flags || [])].sort();
  const fb = [...(b.flags || [])].sort();
  return fa.length === fb.length && fa.every((f, i) => f === fb[i]);
}

export function handlePayload(payload) {
  const key = deriveSessionKey(payload);
  if (!key) return; // sessionless host — never touch the global fallback file
  const statePath = getStatePath(key);
  const state = readState(statePath);
  if (!state) return;
  const def = readState(getDefaultPath());
  if (!sameState(state, def)) return; // explicit override — keep for resume
  try {
    fs.unlinkSync(statePath); // does not follow symlinks
  } catch (_) {
    /* best-effort */
  }
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    process.exit(0);
  }
  try {
    handlePayload(JSON.parse(raw));
  } catch (_) {
    /* fail-silent */
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
