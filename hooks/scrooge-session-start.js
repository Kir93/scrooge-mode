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
import {
  VALID_FLAGS,
  resolveActiveState,
  readState,
  writeState,
  getStatePath,
  getDefaultPath,
  deriveSessionKey,
  readVersionMarker,
  writeVersionMarker,
  defaultFlags,
} from './scrooge-config.js';
import {
  resolveRepoRoot,
  assembleRuleBody,
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

// Current installed version from the package manifest at the repo root.
function readInstalledVersion(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch (e) {
    return null;
  }
}

// Detect a version change exactly once, updating the stored marker. Returns the
// previous version when it genuinely changed (a prior marker existed and differs),
// else null. A fresh install (no marker) records the current version and returns
// null — there is no prior activation to announce.
function consumeVersionChange(root) {
  const current = readInstalledVersion(root);
  if (!current) return null;
  const prev = readVersionMarker();
  if (prev === current) return null;
  writeVersionMarker(current);
  return prev ? { from: prev, to: current } : null;
}

// Evidence the user previously activated Scrooge — a global default or a legacy
// global state file on disk. A *valid* default would have seeded this session
// active (so we wouldn't reach the inactive branch); finding the file present on
// an inactive session means it exists but no longer loads (e.g. a schema-breaking
// upgrade) — exactly the "your activation was reset" case worth announcing. A user
// who installed Scrooge but never ran `/scrooge` has neither file, so an upgrade
// stays silent for them instead of nagging a non-user.
function hasActivationArtifact() {
  try {
    return fs.existsSync(getDefaultPath()) || fs.existsSync(getStatePath());
  } catch (e) {
    return false;
  }
}

// One-time re-activation hint. A version bump can reset activation (e.g. the
// session-scope state-model migration silently deactivated prior users), so tell
// them how to turn Scrooge back on.
function buildUpgradeNotice({ from, to }) {
  return (
    `Scrooge was updated (v${from} → v${to}) and is not active in this session — ` +
    'a version change can reset activation. Tell the user, in their language, how ' +
    'to re-activate: run `/scrooge ko full` (pick lang ko/en/ja + dial lite/full). ' +
    'Re-activating now saves a global default, so every new session stays active ' +
    'until `/scrooge off`.'
  );
}

// On a version upgrade, fold any newly-default-on flags (defaultFlags(), env-aware)
// into both the session state and the saved global default, so an existing user
// picks up new defaults (e.g. lean) automatically — re-running `/scrooge ko` would
// NOT, since it preserves the saved flags. Gated on the version bump (once), so a
// prior explicit opt-out is re-applied at most once. SCROOGE_DEFAULT_FLAGS=''
// (global opt-out) → defaultFlags() empty → no-op. Returns the newly-added flags.
function applyNewDefaultFlags(statePath, state) {
  const added = defaultFlags().filter((f) => !state.flags.includes(f));
  if (!added.length) return null;
  state.flags = VALID_FLAGS.filter((f) => state.flags.includes(f) || added.includes(f));
  writeState(state, statePath);
  const def = readState(getDefaultPath());
  if (def) writeState({ ...def, flags: state.flags }, getDefaultPath());
  return added;
}

// FYI note after auto-applying new default flags — tells the user their default
// behavior changed (and how to opt back out), without asking them to re-run.
function buildAppliedNotice({ from, to }, added) {
  const v = added.length > 1 ? 'are' : 'is';
  return (
    `Scrooge update (v${from} → v${to}): ${added.join(', ')} ${v} now ON by default and ` +
    `applied to this session. Briefly tell the user, in their language, that this is now ` +
    `active (opt out with \`/scrooge no${added[0]}\` if unwanted).`
  );
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
    const root = resolveRepoRoot();

    const sessionKey = deriveSessionKey(data);
    // Per-session state, or — for a brand-new session — seed from the global
    // default so activation persists across sessions ("type once → on everywhere").
    const state = resolveActiveState(getStatePath(sessionKey));

    // Detect a version upgrade once (records the marker regardless of state).
    const upgraded = consumeVersionChange(root);

    if (!state) {
      // Inactive session: announce re-activation only on a version upgrade AND
      // when prior-activation evidence exists that the upgrade may have stranded —
      // never to a user who installed Scrooge but never activated it.
      if (upgraded && hasActivationArtifact()) emit(buildUpgradeNotice(upgraded));
      return;
    }

    // On a version bump, auto-apply any newly-default-on flags to this active
    // session + the saved default (B), so existing users pick them up without
    // re-running. Must run before assembleRuleBody so the new fragment is injected.
    const applied = upgraded ? applyNewDefaultFlags(getStatePath(sessionKey), state) : null;

    // Re-inject base rule + active flag fragments, matching the activation turn
    // so a resumed session restores the same register (flags included).
    const body = assembleRuleBody(root, state.lang, state.dial, state.flags);
    if (!body) return;
    let ctx = buildFullInjection(state.lang, state.dial, body, state.flags);
    if (applied) ctx += '\n\n' + buildAppliedNotice(upgraded, applied);
    emit(ctx);
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
