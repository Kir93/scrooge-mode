// Repo meta-invariants — the ways a change can pass every other check and
// still ship broken (integrity-sweep Task 12).
//
//   (a) `scripts.test` is an explicit file list, not a glob. A new tests/*.js that
//       is never registered runs green forever because it never runs at all — the
//       failure mode is silent and permanent.
//   (b) `.claude-plugin/plugin.json` wires three hooks by hardcoded path string.
//       A rename or move produces a plugin that installs cleanly and then does
//       nothing: the host just fails to spawn a missing file.
//   (c) The markdownlint version is pinned in two workflows and named again in the
//       contributor docs. `npx` runs whatever it is told, so a doc that names a
//       different version — or none at all — sends a contributor to a linter the
//       gates never run. That is how this repo broke: the workflows pinned a
//       release that OOMs on Node 24, six docs carried no version, CLAUDE.md
//       carried a stale one, and every check stayed green.
//   (d) The tag-push gate duplicates the PR gate's commands by hand. Either copy
//       can be edited alone, and the release job's divergence only shows on a tag
//       push — after the release object would already have been made.
//   (e) The tarball link guard only catches a notation its extractor recognizes.
//       A reference-style definition or a single-quoted attribute renders the same
//       link, resolves the same on GitHub, and dies the same inside the package —
//       so a syntax the regex misses is a hole that stays green forever. Its
//       absolute-URL arm has the mirror failure: a `/blob/` where the target is a
//       directory, or a path that does not exist, is the dead reference the
//       rewrite was supposed to remove.
//
// All five are string-level facts about the repo, so they are asserted directly
// rather than inferred from behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { checkRepoUrl, extractLinks, repoBases, resolves } from '../.github/scripts/pack-links.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

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

test('every markdownlint-cli2 reference matches the workflow pin', () => {
  // Baseline is read from the CI lint step, never hardcoded: a constant here would
  // make this guard a fourth place to edit on the next bump, which is the drift it
  // exists to stop.
  const ciYml = read('.github/workflows/ci.yml');
  const baseline = ciYml.match(/^\s*run:\s*npx\s+(?:-{1,2}[\w-]+\s+)*markdownlint-cli2@(\S+)\s/m);
  assert.ok(
    baseline,
    '.github/workflows/ci.yml has no `run: npx --yes markdownlint-cli2@<version>` step — ' +
      'the pin baseline is gone, so this guard has nothing left to compare against'
  );
  const PIN = baseline[1];

  // Scope comes from git's own tracked-file list, so `.gitignore` decides what
  // counts as repo content — the same call `.markdownlint-cli2.jsonc` makes with
  // `gitignore: true`, and for the same reason: a gitignored local capture
  // (`benchmarks/results-*.md`) or a personal symlink at the repo root must never
  // make this guard disagree with CI. No git, no verdict — the spawn throws rather
  // than degrading to a scan of whatever happens to be on disk.
  const tracked = (...globs) =>
    execFileSync('git', ['ls-files', '-z', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      // A path in the index but absent from the working tree is a mid-rename state
      // (`rm` without `git rm`), not a pin fact — skip it rather than dying on ENOENT.
      .filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
  // `docs/*-qa-checklist.md` is excluded as a file class. The lint command inside
  // its `## Sample N` output fences is frozen golden-corpus text — a record of what
  // the compression register produced (tests/test_golden_corpus.js), not an
  // instruction a contributor follows. Hand-pinning it would stop it being that
  // record. The class form (not a per-path allowlist) also covers the en counterpart
  // when it gains the same sample.
  const isFrozenCorpus = (rel) => /^docs\/[a-z]{2}-qa-checklist\.md$/.test(rel);

  const scan = (files) => {
    const hits = [];
    let seen = 0;
    for (const rel of files) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          // Any pin-bearing mention, not just an `npx` invocation: prose that names
          // the version (CONTRIBUTING's node-floor bullet) drifts the same way. The
          // capture takes everything up to the closing quote/backtick rather than a
          // version-shaped token, so a range spec (`@^0.23.2`) reads as a mismatch
          // instead of matching neither regex and passing silently.
          for (const m of line.matchAll(/markdownlint-cli2@([^\s`"']+)/g)) {
            seen += 1;
            if (m[1] !== PIN) hits.push(`${rel}:${i + 1} — names @${m[1]}, workflow pin is @${PIN}`);
          }
          // Any flag spelling (`-y`, `--yes`, `--quiet`, none). A version-less
          // invocation is the original defect: `npx` then resolves whatever latest
          // happens to be, so a contributor lints with a build the gates never ran.
          // The trailing boundary keeps sibling packages (`markdownlint-cli2-formatter-*`)
          // out.
          for (const _ of line.matchAll(/npx\s+(?:-{1,2}[\w-]+\s+)*markdownlint-cli2(?![\w@-])/g)) {
            seen += 1;
            hits.push(`${rel}:${i + 1} — invokes markdownlint-cli2 with no version, workflow pin is @${PIN}`);
          }
        });
    }
    return { hits, seen };
  };

  const inDocs = scan(tracked('*.md').filter((rel) => !isFrozenCorpus(rel)));
  const inWorkflows = scan(tracked('.github/workflows/*.yml', '.github/workflows/*.yaml'));

  // Counted per side on purpose: one combined counter is satisfied by the workflow
  // side alone, so the doc scan could collapse to nothing while this test stayed
  // green — the silent pass this whole file exists to prevent. Both asserts can
  // fire: `tracked()` reads the git index while the baseline above reads the file
  // system, so a pathspec that stops matching empties either side without the
  // baseline noticing.
  assert.ok(
    inDocs.seen > 0,
    'no markdownlint-cli2 reference found in any tracked .md — the doc scan scope drifted'
  );
  assert.ok(
    inWorkflows.seen > 0,
    'no markdownlint-cli2 reference found under .github/workflows — the workflow scan scope drifted'
  );

  const mismatches = [...inDocs.hits, ...inWorkflows.hits];
  assert.deepEqual(
    mismatches,
    [],
    `markdownlint references drifted from the workflow pin @${PIN}:\n  ${mismatches.join('\n  ')}`
  );
});

test('both workflow gates run the same lint and benchmark commands', () => {
  // A tag push is the last chance to stop a bad release, so a release gate that
  // lints with a different build — or runs a different benchmark suite — is not
  // the gate the PR proved green. Compared as whole `run:` lines, since the flags
  // and the glob are as load-bearing as the command name.
  const ciYml = read('.github/workflows/ci.yml');
  const releaseYml = read('.github/workflows/release.yml');
  const runLine = (body, re) => body.split('\n').find((l) => /^\s*run:/.test(l) && re.test(l))?.trim();
  for (const [what, re] of [
    ['markdownlint', /markdownlint-cli2/],
    ['benchmark statistics', /unittest/],
  ]) {
    const ciLine = runLine(ciYml, re);
    assert.ok(ciLine, `ci.yml has no ${what} run step — the comparison baseline is gone`);
    assert.equal(
      runLine(releaseYml, re),
      ciLine,
      `release.yml ${what} step differs from ci.yml — both gates must run the same command`
    );
  }
});

test('the tarball link guard recognizes every link notation that renders', () => {
  // One fixture per notation. A regex that drops an arm keeps the other counts
  // intact, so each target is asserted by value rather than by total.
  const body = [
    '[inline](./benchmarks/a.md)',
    "<img src='assets/b.svg'>",
    '<a href="INSTALL.md">x</a>',
    '[refdef]: ./benchmarks/c.jsonl',
    '[rooted](/rules/en/full.md)',
    '[anchor](#section) [mail](mailto:x@y.z)',
    '[abs](https://github.com/Kir93/scrooge-mode/blob/main/README.md)',
    // Not links: a data attribute and a mismatched quote pair. A blocking gate
    // that matches these fails an innocent PR.
    '<div data-src="not-a-link.md" xlink:href="nope.md"></div>',
    '<img src="mismatched.md\'>',
  ].join('\n');

  const { relative, repoUrls, seen } = extractLinks(body);
  assert.deepEqual(
    relative.map((r) => r.target),
    ['./benchmarks/a.md', 'assets/b.svg', 'INSTALL.md', './benchmarks/c.jsonl', '/rules/en/full.md'],
    'a link notation stopped being extracted — the guard would pass a dead reference written that way'
  );
  assert.deepEqual(repoUrls, ['https://github.com/Kir93/scrooge-mode/blob/main/README.md']);
  assert.equal(seen, 8);

  // Root-relative renders against the repo root on GitHub and is a filesystem
  // absolute path inside the tarball, so it never resolves there.
  const packed = new Set(['rules/en/full.md', 'README.md']);
  assert.equal(resolves(packed, 'README.md', '/rules/en/full.md'), false);
  assert.equal(resolves(packed, 'README.md', 'rules/en/full.md'), true);
});

test('the tarball link guard rejects absolute repo URLs that point at nothing', () => {
  const bases = repoBases(readJson('package.json').repository?.url);
  assert.ok(bases, 'package.json repository.url no longer yields a github.com base');
  const check = (url) => checkRepoUrl(url, bases, REPO_ROOT);

  for (const good of [
    `${bases.blob}/blob/main/README.md`,
    `${bases.blob}/tree/main/benchmarks`,
    `${bases.raw}/main/assets/benchmark.svg`,
  ]) {
    const { target, fault } = check(good);
    assert.ok(target, `${good} should be recognized as repo content`);
    assert.equal(fault, null, `${good} should check out`);
  }

  // Not this guard's business: a badge, an issue link, another host. `target`
  // stays null so the caller does not count them as checked.
  for (const url of [`${bases.blob}/stargazers`, 'https://example.com/whatever']) {
    assert.equal(check(url).target, null);
  }

  for (const bad of [
    `${bases.blob}/blob/main/no/such/file.md`,
    `${bases.blob}/blob/main/benchmarks`,
    `${bases.blob}/tree/main/README.md`,
    `${bases.raw}/main/assets/no-such.svg`,
    `${bases.blob}/blob/main/a%zz.md`,
    // The failure mode the scope assertion alone cannot catch: an owner rename
    // leaves every existing URL pointing at the old repository, and treating
    // those as "not repo content" would turn the whole check off silently.
    'https://github.com/someone-else/scrooge-mode/blob/main/README.md',
  ]) {
    const { target, fault } = check(bad);
    assert.ok(target, `${bad} should still be recognized as repo content`);
    assert.ok(fault, `expected a fault for ${bad} — it would ship a dead reference silently`);
  }
});
