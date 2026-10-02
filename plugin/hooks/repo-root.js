// repo-root.js — shared repo-root candidate resolution.
//
// Two surfaces need the same search order to locate the repo root that holds
// registry.json + rules/: scrooge-activate's resolveRepoRoot (returns the root dir)
// and scrooge-config's loadRegistryForLangs (reads registry.json to derive
// VALID_LANGS). They previously duplicated the candidate-path array literally, so a
// future change to one search path could silently desync the other — one surface
// finding the registry while another misses it (partial activation). Centralized here
// so the search order has one definition. A leaf module (imports only node:path, no
// scrooge modules), so both importers stay cycle-free.

import path from 'node:path';

// Directories to probe for the repo root, in priority order: CLAUDE_PLUGIN_ROOT (set
// by the plugin host) first, then walk up from the importing file's own directory.
export function repoRootCandidates(fromDir) {
  const candidates = [];
  if (process.env.CLAUDE_PLUGIN_ROOT) candidates.push(process.env.CLAUDE_PLUGIN_ROOT);
  for (const rel of ['..', '../..', '../../..']) candidates.push(path.join(fromDir, rel));
  return candidates;
}
