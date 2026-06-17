// G1 — state read/write security (scrooge-config.js).
//
// Asserts the hardened I/O refuses attacker-planted symlinks, oversize files,
// and non-whitelist values, so no arbitrary file content can reach the model
// context or statusline. Each helper takes an explicit path arg, so tests work
// against a temp dir without touching $CLAUDE_CONFIG_DIR.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readState,
  writeState,
  clearState,
  isValidState,
  sanitizeSessionKey,
  deriveSessionKey,
  getStatePath,
} from '../hooks/scrooge-config.js';

const tmpDirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-state-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

test('readState returns whitelisted state for a valid file', () => {
  const p = path.join(tmpDir(), 'state');
  fs.writeFileSync(p, JSON.stringify({ lang: 'ko', dial: 'lite' }));
  assert.deepEqual(readState(p), { lang: 'ko', dial: 'lite' });
});

test('readState refuses to follow a symlink (no exfil)', {
  skip: process.platform === 'win32' ? 'symlinkSync needs admin/Developer Mode on Windows' : false,
}, () => {
  const dir = tmpDir();
  const secret = path.join(dir, 'secret');
  // Even valid-looking content must not be read through a symlink.
  fs.writeFileSync(secret, JSON.stringify({ lang: 'en', dial: 'full' }));
  const link = path.join(dir, '.scrooge-active');
  fs.symlinkSync(secret, link);
  assert.equal(readState(link), null);
});

test('readState rejects an oversize file', () => {
  const p = path.join(tmpDir(), 'state');
  fs.writeFileSync(p, 'x'.repeat(300)); // > MAX_STATE_BYTES (256)
  assert.equal(readState(p), null);
});

test('readState rejects non-whitelist values', () => {
  const p = path.join(tmpDir(), 'state');
  fs.writeFileSync(p, JSON.stringify({ lang: 'fr', dial: 'full' }));
  assert.equal(readState(p), null);
});

test('readState rejects malformed JSON', () => {
  const p = path.join(tmpDir(), 'state');
  fs.writeFileSync(p, 'not json at all');
  assert.equal(readState(p), null);
});

test('readState returns null for a missing file', () => {
  assert.equal(readState(path.join(tmpDir(), 'nope')), null);
});

test('writeState round-trips a valid state', () => {
  const p = path.join(tmpDir(), 'state');
  assert.equal(writeState({ lang: 'en', dial: 'full' }, p), true);
  assert.deepEqual(readState(p), { lang: 'en', dial: 'full' });
});

test('writeState rejects an invalid state without writing', () => {
  const p = path.join(tmpDir(), 'state');
  assert.equal(writeState({ lang: 'xx', dial: 'full' }, p), false);
  assert.equal(fs.existsSync(p), false);
});

test('writeState refuses to clobber through a symlink', {
  skip: process.platform === 'win32' ? 'symlinkSync needs admin/Developer Mode on Windows' : false,
}, () => {
  const dir = tmpDir();
  const other = path.join(dir, 'other');
  fs.writeFileSync(other, 'original');
  const target = path.join(dir, 'state');
  fs.symlinkSync(other, target);
  assert.equal(writeState({ lang: 'en', dial: 'full' }, target), false);
  assert.equal(fs.readFileSync(other, 'utf8'), 'original'); // untouched
});

test('clearState removes the file and is idempotent', () => {
  const p = path.join(tmpDir(), 'state');
  writeState({ lang: 'en', dial: 'full' }, p);
  assert.equal(clearState(p), true);
  assert.equal(fs.existsSync(p), false);
  assert.equal(clearState(p), true); // ENOENT treated as success
});

test('isValidState enforces the whitelist', () => {
  assert.equal(isValidState({ lang: 'ko', dial: 'full' }), true);
  assert.equal(isValidState({ lang: 'ko', dial: 'ultra' }), false);
  assert.equal(isValidState({ lang: 'jp', dial: 'lite' }), false);
  assert.equal(isValidState(null), false);
  assert.equal(isValidState('string'), false);
});

// Session-scope (Task 5): the session key lands in a predictable filename, so it
// must never carry path separators or `..` — otherwise a hostile session_id
// could redirect the state write outside the config dir.
test('sanitizeSessionKey strips path traversal and unsafe characters', () => {
  assert.equal(sanitizeSessionKey('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeSessionKey('a/b/c'), 'abc');
  assert.equal(sanitizeSessionKey('valid-UUID_123'), 'valid-UUID_123');
  assert.equal(sanitizeSessionKey('/////'), null);
  assert.equal(sanitizeSessionKey(''), null);
  assert.equal(sanitizeSessionKey(null), null);
});

test('deriveSessionKey prefers session_id, falls back to the transcript stem', () => {
  assert.equal(deriveSessionKey({ session_id: 'sessA' }), 'sessA');
  assert.equal(deriveSessionKey({ transcript_path: '/p/abc.jsonl' }), 'abc');
  // A traversal attempt in either source is sanitized, never honored.
  assert.equal(deriveSessionKey({ session_id: '../evil' }), 'evil');
  assert.equal(deriveSessionKey({}), null);
});

test('getStatePath stays inside the config dir for any key', () => {
  assert.match(getStatePath('sessA'), /\.scrooge-active-sessA$/);
  assert.match(getStatePath(), /\.scrooge-active$/); // sessionless → global fallback
  const escaped = getStatePath(sanitizeSessionKey('../../escape'));
  assert.match(escaped, /\.scrooge-active-escape$/);
  assert.equal(escaped.includes('..'), false);
});
