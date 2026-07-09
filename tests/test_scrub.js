// scrub gate — canary.
//
// Covers benchmarks/scrub.js: host-context leak scanning (host-rule echo,
// /Users/ home paths), structural row checks (output_text must be gone, D2;
// session_file must be a bare filename), the publish-ready transform, and the
// file-level scan that drives the CLI exit code. Zero-dep, no model calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanText, scanRow, toPublishRow, scanFile } from '../benchmarks/scrub.js';

test('scanText flags a host CLAUDE.md rule echoed into the answer', () => {
  const leaks = scanText('먼저 react-best-practices 와 web-interface-guidelines 를 읽었고…');
  assert.ok(leaks.some((l) => l === 'host-rule:react-best-practices'));
  assert.ok(leaks.some((l) => l === 'host-rule:web-interface-guidelines'));
});

test('scanText flags the RULES CHECK marker case-insensitively', () => {
  assert.ok(scanText('rules check: UI/React/Next.js').some((l) => l === 'host-rule:RULES CHECK'));
});

test('scanText flags a /Users/ home path', () => {
  const leaks = scanText('session at /Users/crhan/Documents/toy/x.jsonl');
  assert.ok(leaks.some((l) => l.startsWith('home-path:/Users/crhan')));
});

test('scanText is clean on ordinary bench prose', () => {
  assert.deepEqual(scanText('컴포넌트 매 render 재실행됨. Fix: `useMemo`.'), []);
});

test('scanRow flags a row that still holds output_text (D2 full removal)', () => {
  assert.ok(scanRow({ output_tokens: 972, output_text: 'anything' }).includes('output_text-present'));
});

test('scanRow flags a session_file that carries a path', () => {
  const leaks = scanRow({ session_file: '/Users/crhan/x/abc.jsonl' });
  assert.ok(leaks.some((l) => l.startsWith('session-path:')));
});

test('scanRow is clean on a bare-basename session_file with no output_text', () => {
  assert.deepEqual(scanRow({ output_tokens: 972, session_file: '9c34c40d.jsonl' }), []);
});

test('toPublishRow drops output_text and basenames session_file', () => {
  const row = toPublishRow({
    output_tokens: 972,
    output_text: 'long echoed prose',
    session_file: '/Users/crhan/x/abc.jsonl',
  });
  assert.equal('output_text' in row, false);
  assert.equal(row.session_file, 'abc.jsonl');
  assert.equal(row.output_tokens, 972);
});

test('toPublishRow leaves a bare-basename session_file unchanged', () => {
  assert.equal(toPublishRow({ session_file: 'abc.jsonl' }).session_file, 'abc.jsonl');
});

test('scanFile flags a leak-containing JSONL (drives nonzero exit)', () => {
  const line = JSON.stringify({ output_tokens: 5, output_text: 'read react-best-practices' });
  assert.ok(scanFile('bad.jsonl', line).length > 0);
});

test('scanFile is clean on a scrubbed JSONL (drives exit 0)', () => {
  const line = JSON.stringify({ output_tokens: 972, session_file: 'abc.jsonl', model: 'claude-opus-4-8' });
  assert.deepEqual(scanFile('good.jsonl', line), []);
});

test('scanFile flags invalid JSON in a JSONL line', () => {
  assert.ok(scanFile('x.jsonl', '{not json}').some((e) => e.leak === 'invalid-json'));
});

test('scanFile scans markdown whole-file for a leaked path (derived docs in scope)', () => {
  const md = '# Provenance\n\nRun at /Users/crhan/Documents/toy/scrooge-mode.\n';
  assert.ok(scanFile('manifest.md', md).some((e) => e.leak.startsWith('home-path:')));
});
