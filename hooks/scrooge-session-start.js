#!/usr/bin/env node
// scrooge-session-start.js — SessionStart hook.
//
// When a session that already has Scrooge active starts (e.g. a resume), the
// UserPromptSubmit hook only re-injects a short reminder on the first turn. This
// hook re-injects the FULL register rule at session start so the compressed
// register survives a fresh context window. It also sweeps stale per-session
// state files so they don't accumulate over time.
//
// Inactive sessions inject nothing. Sessionless hosts (no session_id /
// transcript_path) resolve to the global state path, same as activation.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, getStatePath, deriveSessionKey } from './scrooge-config.js';
import {
  resolveRepoRoot,
  resolveRulePath,
  readRuleBody,
  buildFullInjection,
} from './scrooge-activate.js';

// Per-session state files older than this are swept on session start. The mtime
// reflects the last activation/change; a generous window avoids reaping a
// long-lived but rarely-retoggled session while still bounding accumulation.
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

// Best-effort removal of stale `.scrooge-active-<key>` files. Never touches the
// bare global `.scrooge-active` (the sessionless fallback) and never follows a
// symlink — lstat + unlink removes the link itself, not its target.
function sweepStaleState(now) {
  try {
    const dir = path.dirname(getStatePath());
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('.scrooge-active-')) continue;
      const p = path.join(dir, name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) continue;
        if (now - st.mtimeMs > STALE_MS) fs.unlinkSync(p);
      } catch (_) {
        /* best-effort per file */
      }
    }
  } catch (_) {
    /* best-effort */
  }
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    })
  );
}

function handlePayload(data) {
  try {
    sweepStaleState(Date.now());

    const sessionKey = deriveSessionKey(data);
    const state = readState(getStatePath(sessionKey));
    if (!state) return; // inactive session — inject nothing

    const root = resolveRepoRoot();
    const rulePath = resolveRulePath(root, state.lang, state.dial);
    const body = rulePath ? readRuleBody(rulePath) : null;
    if (body) emit(buildFullInjection(state.lang, state.dial, body));
  } catch (e) {
    // Silent fail — never break session start.
  }
}

function main() {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    let data;
    try {
      data = JSON.parse(input || '{}');
    } catch (e) {
      return;
    }
    handlePayload(data);
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { handlePayload, sweepStaleState };
