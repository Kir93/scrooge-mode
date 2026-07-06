#!/usr/bin/env node
// scrooge-update-check.js — detached background update probe.
//
// Spawned (detached, stdio ignored, unref'd) by the SessionStart hook at most
// once a day. It fetches the latest published release from GitHub, compares it
// to the installed version, and writes the result to the `.scrooge/update`
// cache. The hook and the statusline only ever READ that cache — never fetch
// inline — so a slow or offline network can never stall a session.
//
// This process writes NOTHING to stdout/stderr and swallows every error: a probe
// that fails must be invisible. Its only side effect is the cache file.
//
// GitHub source is the single source of truth across all channels (the npm/curl
// installer, the Claude plugin marketplace, and the skills CLIs all track the
// `Kir93/scrooge-mode` repo), so one releases/latest lookup serves every host.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isUpdateCheckDisabled,
  readInstalledVersion,
  readUpdateCache,
  writeUpdateCache,
  semverGt,
} from './scrooge-config.js';
import { resolveRepoRoot } from './scrooge-activate.js';

const RELEASES_URL = 'https://api.github.com/repos/Kir93/scrooge-mode/releases/latest';
const FETCH_TIMEOUT_MS = 4000;

// Fetch the latest release tag ("v0.19.0" → "0.19.0"). Unauthenticated GitHub
// API is rate-limited to 60/hr per IP — a once-a-day probe stays well within it.
// A User-Agent header is mandatory (GitHub rejects UA-less requests with 403).
async function fetchLatest() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { 'User-Agent': 'scrooge-mode', Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tag = typeof data.tag_name === 'string' ? data.tag_name : null;
    return tag ? tag.replace(/^v/, '') : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (isUpdateCheckDisabled()) return;
  const root = resolveRepoRoot();
  const installed = root ? readInstalledVersion(root) : null;
  if (!installed) return;
  const latest = await fetchLatest();
  if (!latest) return;
  // Preserve notifiedVersion so the SessionStart hook keeps its once-per-version
  // gate: this probe owns latest/checkedAt/behind, the hook owns notifiedVersion.
  const prev = readUpdateCache();
  writeUpdateCache({
    latest,
    checkedAt: Date.now(),
    behind: semverGt(latest, installed),
    notifiedVersion: prev ? prev.notifiedVersion : null,
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(() => {}); // never surface — silent best-effort probe

export { fetchLatest };
