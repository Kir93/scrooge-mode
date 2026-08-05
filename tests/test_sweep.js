// SessionStart sweep — the primary bound on per-session marker accumulation
// (SessionEnd is opportunistic and often never fires when a session is
// abandoned). Three rules: default-equal markers expire after 1 day, override
// markers after 14 days, and a hard 300-entry cap evicts oldest-first.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sweepStaleState } from '../hooks/scrooge-session-start.js';
import { getStatePath, getDefaultPath, writeState, readState } from '../hooks/scrooge-config.js';

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-sweep-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

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

const DEFAULT = { lang: 'ko', dial: 'full', flags: ['lean'] };
const OVERRIDE = { lang: 'en', dial: 'full', flags: [] };
const DAY = 24 * 60 * 60 * 1000;

function writeMarkerAgedDays(key, state, days, now) {
  writeState(state, getStatePath(key));
  const t = new Date(now - days * DAY);
  fs.utimesSync(getStatePath(key), t, t);
}

test('default-equal markers expire after 1 day; fresh ones survive', () => {
  withConfigDir(freshConfig(), () => {
    const now = Date.now();
    writeState(DEFAULT, getDefaultPath());
    writeMarkerAgedDays('stale', DEFAULT, 2, now); // redundant + old → swept
    writeMarkerAgedDays('fresh', DEFAULT, 0.5, now); // redundant but recent → kept
    sweepStaleState(now);
    assert.equal(readState(getStatePath('stale')), null);
    assert.deepEqual(readState(getStatePath('fresh')), DEFAULT);
  });
});

test('override markers survive 1 day but expire after 14 days', () => {
  withConfigDir(freshConfig(), () => {
    const now = Date.now();
    writeState(DEFAULT, getDefaultPath());
    writeMarkerAgedDays('recentOverride', OVERRIDE, 5, now); // differs from default → kept
    writeMarkerAgedDays('ancientOverride', OVERRIDE, 15, now); // beyond 14d → swept
    sweepStaleState(now);
    assert.deepEqual(readState(getStatePath('recentOverride')), OVERRIDE);
    assert.equal(readState(getStatePath('ancientOverride')), null);
  });
});

test('with no default saved, 1-day redundancy pruning never applies', () => {
  withConfigDir(freshConfig(), () => {
    const now = Date.now();
    writeMarkerAgedDays('lonely', DEFAULT, 5, now); // no default → treated as override
    sweepStaleState(now);
    assert.deepEqual(readState(getStatePath('lonely')), DEFAULT);
  });
});

test('hard cap: beyond 300 markers, oldest are evicted first', () => {
  withConfigDir(freshConfig(), () => {
    const now = Date.now();
    // No default saved → nothing is TTL-swept below 14d; only the cap applies.
    for (let i = 0; i < 310; i++) {
      // Ages 0..0.9 days spread across markers; marker000 oldest.
      writeMarkerAgedDays(`marker${String(i).padStart(3, '0')}`, OVERRIDE, (310 - i) / 344, now);
    }
    sweepStaleState(now);
    const dir = path.dirname(getStatePath('x'));
    const left = fs.readdirSync(dir);
    assert.equal(left.length, 300);
    assert.equal(left.includes('marker000'), false); // oldest evicted
    assert.equal(left.includes('marker309'), true); // newest kept
  });
});

test('a symlink in the sessions dir is never followed or deleted', () => {
  const cfg = freshConfig();
  withConfigDir(cfg, () => {
    const now = Date.now();
    writeState(DEFAULT, getDefaultPath());
    const secret = path.join(cfg, 'secret.txt');
    fs.writeFileSync(secret, 'keep');
    const linkPath = getStatePath('linky');
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(secret, linkPath);
    const t = new Date(now - 30 * DAY);
    fs.lutimesSync(linkPath, t, t);
    sweepStaleState(now);
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true); // untouched
    assert.equal(fs.readFileSync(secret, 'utf8'), 'keep');
  });
});
