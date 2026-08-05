// SessionEnd hook — deletes the ending session's marker only when it carries
// nothing beyond the saved global default. The keep-on-override branch is the
// data-preserving invariant: a marker that differs from the default must
// survive so resuming that session retains its override.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handlePayload } from '../hooks/scrooge-session-end.js';
import { getStatePath, getDefaultPath, writeState, readState } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, '..', 'hooks', 'scrooge-session-end.js');

const tmpDirs = [];
function freshConfig() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-send-'));
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

test('marker equal to the default is deleted at session end', () => {
  withConfigDir(freshConfig(), () => {
    writeState(DEFAULT, getDefaultPath());
    writeState(DEFAULT, getStatePath('sessA'));
    handlePayload({ session_id: 'sessA', reason: 'exit' });
    assert.equal(readState(getStatePath('sessA')), null);
  });
});

test('marker differing from the default (override) is KEPT for resume', () => {
  withConfigDir(freshConfig(), () => {
    writeState(DEFAULT, getDefaultPath());
    writeState({ lang: 'en', dial: 'full', flags: [] }, getStatePath('sessB'));
    handlePayload({ session_id: 'sessB' });
    assert.deepEqual(readState(getStatePath('sessB')), { lang: 'en', dial: 'full', flags: [] });
  });
});

test('flags order does not defeat the equality check', () => {
  withConfigDir(freshConfig(), () => {
    // flags arrays compare order-insensitively (sameState sorts both sides).
    writeState(DEFAULT, getDefaultPath());
    writeState({ ...DEFAULT, flags: [...DEFAULT.flags].reverse() }, getStatePath('sessC'));
    handlePayload({ session_id: 'sessC' });
    assert.equal(readState(getStatePath('sessC')), null);
  });
});

test('sessionless payload never touches the global fallback file', () => {
  withConfigDir(freshConfig(), () => {
    writeState(DEFAULT, getDefaultPath());
    writeState(DEFAULT, getStatePath()); // global fallback, equal to default
    handlePayload({});
    assert.deepEqual(readState(getStatePath()), DEFAULT);
  });
});

test('no default saved → marker is treated as an override and kept', () => {
  withConfigDir(freshConfig(), () => {
    writeState(DEFAULT, getStatePath('sessD'));
    handlePayload({ session_id: 'sessD' });
    assert.deepEqual(readState(getStatePath('sessD')), DEFAULT);
  });
});

test('garbage or empty stdin exits 0 without touching state (fail-silent)', () => {
  const cfg = freshConfig();
  withConfigDir(cfg, () => {
    writeState(DEFAULT, getDefaultPath());
    writeState(DEFAULT, getStatePath('sessE'));
  });
  for (const input of ['not-json{{{', '']) {
    const r = spawnSync(process.execPath, [HOOK], {
      input,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    });
    assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  }
  withConfigDir(cfg, () => {
    assert.deepEqual(readState(getStatePath('sessE')), DEFAULT);
  });
});
