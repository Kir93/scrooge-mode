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
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  VALID_FLAGS,
  VALID_LANGS,
  resolveActiveState,
  readState,
  writeState,
  getStatePath,
  getSessionsDir,
  getDefaultPath,
  deriveSessionKey,
  readVersionMarker,
  writeVersionMarker,
  readInstalledVersion,
  semverGt,
  readUpdateCache,
  writeUpdateCache,
  isUpdateCheckDisabled,
  defaultFlags,
  sameState,
  migrateLegacyState,
} from './scrooge-config.js';
import {
  resolveRepoRoot,
  assembleRuleBody,
  buildFullInjection,
} from './scrooge-activate.js';

// Sweep thresholds. SessionEnd cleanup is opportunistic — it does not fire when
// a session is abandoned (VS Code "new conversation", documented unreliability:
// anthropics/claude-code#6428/#17885/#14760) — so this startup sweep is the
// primary bound, the same clean-exit + sweep-backstop split Claude Code itself
// uses for shell-snapshots. Three rules, mirroring the SessionEnd semantics:
//   - a marker equal to the saved default is pure redundancy (resume re-seeds
//     from the default), so it only needs to outlive an active session: 1 day;
//   - a marker that DIFFERS from the default carries a session override worth
//     keeping for resume: 14 days;
//   - a hard count cap evicts oldest-first as a burst backstop (claude-hud's
//     TTL + cap pattern).
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const REDUNDANT_MS = 24 * 60 * 60 * 1000;
const MAX_MARKERS = 300;

// Best-effort removal of stale per-session markers in `.scrooge/sessions/`.
// Never touches the global sessionless fallback (it lives outside sessions/)
// and never follows a symlink — lstat + unlink removes the link itself.
function sweepStaleState(now) {
  try {
    const dir = getSessionsDir();
    const def = readState(getDefaultPath());
    const kept = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink() || !st.isFile()) continue;
        const age = now - st.mtimeMs;
        if (age > STALE_MS) {
          fs.unlinkSync(p);
          continue;
        }
        if (age > REDUNDANT_MS && sameState(readState(p), def)) {
          fs.unlinkSync(p);
          continue;
        }
        kept.push({ p, mtimeMs: st.mtimeMs });
      } catch (_) {
        /* best-effort per file */
      }
    }
    if (kept.length > MAX_MARKERS) {
      kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const { p } of kept.slice(0, kept.length - MAX_MARKERS)) {
        try {
          fs.unlinkSync(p);
        } catch (_) {
          /* best-effort per file */
        }
      }
    }
  } catch (_) {
    /* best-effort */
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
  // The lang options are listed dynamically from VALID_LANGS (registry-derived), so a
  // newly-added language appears in the re-activation hint with no edit here.
  const langs = VALID_LANGS.join('/');
  const example = VALID_LANGS[0] || 'ko';
  return (
    `Scrooge was updated (v${from} → v${to}) and is not active in this session — ` +
    'a version change can reset activation. Tell the user, in their language, how ' +
    `to re-activate: run \`/scrooge ${example} full\` (pick lang ${langs} + dial lite/full). ` +
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

// Detached update probe runs at most once a day; the hook only reads its cache.
const UPDATE_REFRESH_MS = 24 * 60 * 60 * 1000;

// One-line "update available" notice. The update path is uniform across every
// install channel (npm/curl, Claude plugin, skills), so a single instruction —
// re-run the installer — covers all of them.
function buildUpdateNotice(latest) {
  return (
    `A newer Scrooge is available (v${latest}). Tell the user, in their language, to ` +
    'update by re-running the installer: `npx -y github:Kir93/scrooge-mode` ' +
    '(it updates every detected host in place). Mention it once, briefly.'
  );
}

// Decide whether to surface an update notice this session. Gated to: real users
// (an active session, or prior-activation evidence — never a never-activated
// install), session startup only (not resume/clear/compact), opt-out/CI honored,
// and once per published version (notifiedVersion). Re-verifies the cached latest
// against the currently-installed version so a just-completed update goes silent.
function maybeUpdateNotice(root, source, eligible) {
  if (source !== 'startup' || !eligible || isUpdateCheckDisabled()) return null;
  const cache = readUpdateCache();
  if (!cache || !cache.behind || !cache.latest) return null;
  const installed = readInstalledVersion(root);
  if (!installed || !semverGt(cache.latest, installed)) return null;
  if (cache.notifiedVersion === cache.latest) return null;
  writeUpdateCache({ ...cache, notifiedVersion: cache.latest });
  return buildUpdateNotice(cache.latest);
}

// Refresh the update cache in a detached background process, throttled to once a
// day. Never blocks: the child is unref'd with stdio ignored, so session start
// returns immediately regardless of network speed. A missing cache refreshes now
// and the notice appears next session — an acceptable one-session delay that
// keeps the hook itself network-free.
function scheduleUpdateRefresh(source) {
  try {
    if (source !== 'startup' || isUpdateCheckDisabled()) return;
    const cache = readUpdateCache();
    if (cache && Date.now() - cache.checkedAt < UPDATE_REFRESH_MS) return;
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scrooge-update-check.js');
    spawn(process.execPath, [script], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    /* best-effort — a failed refresh must never break session start */
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
    migrateLegacyState(); // before any state read — the default may still be at its legacy path
    sweepStaleState(Date.now());
    const root = resolveRepoRoot();

    const source = typeof data.source === 'string' ? data.source : '';
    const sessionKey = deriveSessionKey(data);
    // Per-session state, or — for a brand-new session — seed from the global
    // default so activation persists across sessions ("type once → on everywhere").
    const state = resolveActiveState(getStatePath(sessionKey));

    // Detect a version upgrade once (records the marker regardless of state).
    const upgraded = consumeVersionChange(root);

    // Update-available notice for real users; refresh the cache in the background
    // (both no-ops off session startup / under opt-out / in CI).
    const eligible = !!state || hasActivationArtifact();
    const updateNotice = maybeUpdateNotice(root, source, eligible);
    scheduleUpdateRefresh(source);

    if (!state) {
      // Inactive session: announce re-activation only on a version upgrade AND
      // when prior-activation evidence exists that the upgrade may have stranded —
      // never to a user who installed Scrooge but never activated it. An update
      // notice piggybacks here for a stranded prior user.
      const parts = [];
      if (upgraded && hasActivationArtifact()) parts.push(buildUpgradeNotice(upgraded));
      if (updateNotice) parts.push(updateNotice);
      if (parts.length) emit(parts.join('\n\n'));
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
    if (updateNotice) ctx += '\n\n' + updateNotice;
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
