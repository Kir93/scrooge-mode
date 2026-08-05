// migrateLegacyState — one-time move of the legacy root-level `.scrooge-*`
// dotfiles into the `.scrooge/` subdirectory. Covers: preserved renames,
// per-session marker relocation, new-path-wins races, symlink/tmp-litter
// disposal, idempotency, and the end-to-end seed-from-migrated-default path.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  migrateLegacyState,
  readState,
  resolveActiveState,
  getStatePath,
  getDefaultPath,
  getVersionPath,
  getSuffixPath,
  getHistoryPath,
} from '../hooks/scrooge-config.js';

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-mig-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// The config helpers read CLAUDE_CONFIG_DIR at call time, so each test pins it
// to a temp dir and restores it afterwards (node:test runs a file serially).
function withConfigDir(cfg, fn) {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
}

const KO_FULL = JSON.stringify({ lang: 'ko', dial: 'full', flags: ['lean'] });
const EN_FULL = JSON.stringify({ lang: 'en', dial: 'full', flags: [] });

test('moves every legacy file kind to its subdir home, content intact', () => {
  const cfg = freshConfig();
  fs.writeFileSync(path.join(cfg, '.scrooge-active'), KO_FULL);
  fs.writeFileSync(path.join(cfg, '.scrooge-active-sessA'), EN_FULL);
  fs.writeFileSync(path.join(cfg, '.scrooge-default'), KO_FULL);
  fs.writeFileSync(path.join(cfg, '.scrooge-version'), '0.17.0');
  fs.writeFileSync(path.join(cfg, '.scrooge-statusline-suffix'), 'sessA:~1k saved');
  fs.writeFileSync(path.join(cfg, '.scrooge-history.jsonl'), '{"sessionId":"a"}\n');
  withConfigDir(cfg, () => {
    migrateLegacyState();
    assert.deepEqual(readState(getStatePath()), { lang: 'ko', dial: 'full', flags: ['lean'] });
    assert.deepEqual(readState(getStatePath('sessA')), { lang: 'en', dial: 'full', flags: [] });
    assert.deepEqual(readState(getDefaultPath()), { lang: 'ko', dial: 'full', flags: ['lean'] });
    assert.equal(fs.readFileSync(getVersionPath(), 'utf8'), '0.17.0');
    assert.equal(fs.readFileSync(getSuffixPath(), 'utf8'), 'sessA:~1k saved');
    assert.equal(fs.readFileSync(getHistoryPath(), 'utf8'), '{"sessionId":"a"}\n');
  });
  // Nothing scrooge-owned left loose at the root.
  const loose = fs.readdirSync(cfg).filter((n) => n.startsWith('.scrooge-'));
  assert.deepEqual(loose, []);
});

test('new path wins when both generations exist; legacy copy is dropped', () => {
  const cfg = freshConfig();
  fs.mkdirSync(path.join(cfg, '.scrooge'), { recursive: true });
  fs.writeFileSync(path.join(cfg, '.scrooge', 'default'), EN_FULL); // already migrated/written
  fs.writeFileSync(path.join(cfg, '.scrooge-default'), KO_FULL); // stale straggler
  withConfigDir(cfg, () => {
    migrateLegacyState();
    assert.deepEqual(readState(getDefaultPath()), { lang: 'en', dial: 'full', flags: [] });
  });
  assert.equal(fs.existsSync(path.join(cfg, '.scrooge-default')), false);
});

test('a symlink squatting on a legacy path is unlinked, its target untouched', () => {
  const cfg = freshConfig();
  const secret = path.join(cfg, 'secret.txt');
  fs.writeFileSync(secret, 'do-not-move');
  fs.symlinkSync(secret, path.join(cfg, '.scrooge-default'));
  withConfigDir(cfg, () => {
    migrateLegacyState();
    assert.equal(fs.existsSync(path.join(cfg, '.scrooge-default')), false); // link removed
    assert.equal(readState(getDefaultPath()), null); // nothing migrated
  });
  assert.equal(fs.readFileSync(secret, 'utf8'), 'do-not-move'); // target intact
});

test('crash litter and unsanitizable marker names are deleted, unknowns kept', () => {
  const cfg = freshConfig();
  fs.writeFileSync(path.join(cfg, '.scrooge.tmp.123.456'), 'partial');
  // sanitizeSessionKey strips every char of this suffix → unsanitizable
  fs.writeFileSync(path.join(cfg, '.scrooge-active-###'), KO_FULL);
  fs.writeFileSync(path.join(cfg, '.scrooge-unknown-thing'), 'not ours');
  withConfigDir(cfg, () => migrateLegacyState());
  assert.equal(fs.existsSync(path.join(cfg, '.scrooge.tmp.123.456')), false);
  assert.equal(fs.existsSync(path.join(cfg, '.scrooge-active-###')), false);
  assert.equal(fs.readFileSync(path.join(cfg, '.scrooge-unknown-thing'), 'utf8'), 'not ours');
});

test('idempotent: a second run with nothing legacy left is a no-op', () => {
  const cfg = freshConfig();
  fs.writeFileSync(path.join(cfg, '.scrooge-default'), KO_FULL);
  withConfigDir(cfg, () => {
    migrateLegacyState();
    const first = fs.statSync(getDefaultPath()).mtimeMs;
    migrateLegacyState();
    assert.equal(fs.statSync(getDefaultPath()).mtimeMs, first);
    assert.deepEqual(readState(getDefaultPath()), { lang: 'ko', dial: 'full', flags: ['lean'] });
  });
});

test('end-to-end: a fresh session seeds from the migrated default', () => {
  const cfg = freshConfig();
  fs.writeFileSync(path.join(cfg, '.scrooge-default'), KO_FULL); // pre-upgrade user preference
  withConfigDir(cfg, () => {
    migrateLegacyState();
    // The exact read path SessionStart/activate use for a brand-new session.
    const state = resolveActiveState(getStatePath('freshSession'));
    assert.deepEqual(state, { lang: 'ko', dial: 'full', flags: ['lean'] });
  });
});
