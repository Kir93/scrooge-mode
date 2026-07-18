// Version-source consistency guard (release-pipeline-maturity Task 1).
//
// A release sets one version in four places; they must stay in lockstep. The
// release workflow (.github/workflows/release.yml) checks these four against the
// pushed tag, but that check only runs at tag time. This test runs on every
// `npm test` (CI push/PR), so a bump that moves fewer than all four sources is
// caught before a tag is ever pushed. Sources mirror release.yml's read/compare
// shape (readFileSync + JSON.parse).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

test('all four version sources are identical', () => {
  const pkg = readJson('package.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const plugin = readJson('.claude-plugin/plugin.json');

  const sources = {
    'package.json version': pkg.version,
    'marketplace metadata.version': marketplace.metadata?.version,
    'marketplace plugins[0].version': marketplace.plugins?.[0]?.version,
    'plugin.json version': plugin.version,
  };

  // Every source must be a non-empty string (a missing field reads as undefined,
  // which would otherwise trivially "match" another missing field).
  for (const [label, value] of Object.entries(sources)) {
    assert.equal(typeof value, 'string', `${label} is not a string: ${value}`);
    assert.ok(value.length > 0, `${label} is empty`);
  }

  const versions = Object.values(sources);
  const expected = versions[0];
  const mismatches = Object.entries(sources)
    .filter(([, value]) => value !== expected)
    .map(([label, value]) => `${label}: ${value} !== ${expected} (package.json version)`);

  assert.equal(mismatches.length, 0, `version sources drift:\n${mismatches.join('\n')}`);
});
