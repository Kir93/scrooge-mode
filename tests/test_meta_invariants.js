// Repo meta-invariants — the two ways a change can pass every other check and
// still ship broken (integrity-sweep Task 12).
//
//   (a) `scripts.test` is an explicit file list, not a glob. A new tests/*.js that
//       is never registered runs green forever because it never runs at all — the
//       failure mode is silent and permanent.
//   (b) `.claude-plugin/plugin.json` wires three hooks by hardcoded path string.
//       A rename or move produces a plugin that installs cleanly and then does
//       nothing: the host just fails to spawn a missing file.
//
// Both are string-level facts about the repo, so they are asserted directly
// rather than inferred from behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

test('every tests/*.js file is registered in package.json scripts.test', () => {
  // Self-referential on purpose: this file only runs if it is itself registered,
  // and once it runs it fails on any sibling that is not.
  const script = readJson('package.json').scripts?.test ?? '';
  const registered = new Set(script.match(/tests\/[\w./-]+\.js/g) ?? []);
  // Recursive: `tests/fixtures/` holds shared non-test modules, and a test file
  // dropped into any subdirectory would otherwise be invisible here — the same
  // silent-permanent failure this test exists to catch. Only `test_*.js` needs
  // registering; a fixture module has no tests to run.
  const walk = (dir, prefix) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name), `${prefix}${e.name}/`)
        : e.name.startsWith('test_') && e.name.endsWith('.js')
          ? [`${prefix}${e.name}`]
          : []
    );
  const onDisk = walk(path.join(REPO_ROOT, 'tests'), 'tests/');

  const unregistered = onDisk.filter((f) => !registered.has(f));
  assert.deepEqual(
    unregistered,
    [],
    `test files never run — add them to package.json "scripts.test":\n  ${unregistered.join('\n  ')}`
  );

  const missingOnDisk = [...registered].filter((f) => !onDisk.includes(f));
  assert.deepEqual(
    missingOnDisk,
    [],
    `scripts.test lists files that do not exist:\n  ${missingOnDisk.join('\n  ')}`
  );
});

test('every plugin.json hook command points at a file that exists', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const commands = [];
  for (const [event, entries] of Object.entries(plugin.hooks ?? {})) {
    for (const entry of entries ?? []) {
      for (const hook of entry.hooks ?? []) {
        if (typeof hook.command === 'string') commands.push([event, hook.command]);
      }
    }
  }
  assert.ok(commands.length > 0, 'plugin.json declares no hook commands — did the schema change?');

  for (const [event, command] of commands) {
    // `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.js"` → hooks/x.js
    const m = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/);
    assert.ok(m, `${event}: hook command has no \${CLAUDE_PLUGIN_ROOT} path: ${command}`);
    const rel = m[1];
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, rel)),
      `${event}: hook command points at a missing file: ${rel}`
    );
  }
});

test('plugin.json hook files are inside the packaged file list', () => {
  // A hook that exists in the repo but is not in package.json "files" is missing
  // for anyone who installs from the package rather than a clone.
  const plugin = readJson('.claude-plugin/plugin.json');
  const files = readJson('package.json').files ?? [];
  const roots = files.map((f) => (f.endsWith('/') ? f : `${f}`));
  for (const entries of Object.values(plugin.hooks ?? {})) {
    for (const entry of entries ?? []) {
      for (const hook of entry.hooks ?? []) {
        const m = String(hook.command ?? '').match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/);
        if (!m) continue;
        const rel = m[1];
        assert.ok(
          roots.some((r) => (r.endsWith('/') ? rel.startsWith(r) : rel === r)),
          `hook ${rel} is not covered by package.json "files": ${roots.join(', ')}`
        );
      }
    }
  }
});
