// repo-root.js search-order contract (integrity-sweep Task 12).
//
// Two surfaces resolve the repo root through this one helper — scrooge-activate's
// resolveRepoRoot (finds rules/) and scrooge-config's loadRegistryForLangs (reads
// registry.json for VALID_LANGS). They were centralized here precisely so the
// order cannot desync; nothing was pinning the order itself, so a reordering
// would still pass every existing test while changing which root each surface
// finds. Partial activation — one surface locating the registry, another not —
// is the failure this pins shut.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { repoRootCandidates } from '../hooks/repo-root.js';

const FROM = '/tmp/scrooge-fake/hooks';

test('candidates walk up from the importing directory, nearest first', () => {
  delete process.env.CLAUDE_PLUGIN_ROOT;
  assert.deepEqual(repoRootCandidates(FROM), [
    path.join(FROM, '..'),
    path.join(FROM, '../..'),
    path.join(FROM, '../../..'),
  ]);
});

test('CLAUDE_PLUGIN_ROOT wins — the plugin host knows better than a path walk', () => {
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = '/opt/scrooge';
  try {
    const got = repoRootCandidates(FROM);
    assert.equal(got[0], '/opt/scrooge', 'plugin root must be probed before the walk');
    assert.equal(got.length, 4, 'plugin root is prepended, it does not replace the walk');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
  }
});

test('an empty CLAUDE_PLUGIN_ROOT is ignored rather than probed as ""', () => {
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = '';
  try {
    assert.equal(repoRootCandidates(FROM).length, 3);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
  }
});

test('the walk stops at three levels — an unbounded walk could escape into $HOME', () => {
  delete process.env.CLAUDE_PLUGIN_ROOT;
  const got = repoRootCandidates(FROM);
  assert.equal(got.length, 3, 'a deeper walk would eventually probe $HOME and /');
  // Third level up from <root>/hooks is already outside the repo; a fourth would
  // start matching unrelated directories that happen to hold a registry.json.
  assert.equal(got[got.length - 1], path.join(FROM, '../../..'));
});
