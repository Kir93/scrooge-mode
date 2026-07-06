// memory-compress (#4): byte-exact preservation guard + honest-bill input delta.
//
// The model produces the compressed prose; the correctness-critical pieces are
// deterministic and tested here: (1) protectedSpans / verifyPreservation catch a
// dropped code block, URL, or path before an irreversible overwrite; (2) the CLI
// exits non-zero on corruption so a caller can gate the write on it; (3) `record`
// books the saving on the shared ledger under bySource['memory-compress'] and
// refuses to book anything for a corrupting compress (no over-report).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  protectedSpans,
  verifyPreservation,
  compressionDelta,
} from '../lib/memory-compress.js';
import { aggregateLedger } from '../lib/ledger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const CLI = path.join(REPO_ROOT, 'hooks', 'scrooge-memory.js');

const tmpDirs = [];
function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-mem-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const ORIGINAL = [
  '# Project notes',
  '',
  'Basically, you should really just run the build like this:',
  '',
  '```bash',
  'npm run build && node ./scripts/deploy.js',
  '```',
  '',
  'See the docs at https://example.com/guide for more detail. The config lives at',
  'src/config/settings.json and the helper is `parseInput()`.',
  '',
  'Read [the runbook](docs/runbook.md) before deploying to production.',
].join('\n');

// ── protectedSpans / verifyPreservation ─────────────────────────────────────

test('protectedSpans captures code, URL, link target, and paths', () => {
  const spans = protectedSpans(ORIGINAL);
  assert.ok(spans.some((s) => s.includes('npm run build')), 'fenced code missing');
  assert.ok(spans.some((s) => s === '`parseInput()`'), 'inline code missing');
  assert.ok(spans.some((s) => s === 'https://example.com/guide'), 'URL missing');
  assert.ok(spans.some((s) => s === 'docs/runbook.md'), 'link target missing');
  assert.ok(spans.some((s) => s === 'src/config/settings.json'), 'bare path missing');
});

test('prose with incidental slashes is not over-protected (no false paths)', () => {
  // "and/or", "I/O", "TCP/IP" are terms, not paths — they must not become spans.
  const spans = protectedSpans('Handle I/O and/or TCP/IP gracefully.');
  assert.deepEqual(spans, []);
});

test('verifyPreservation passes when every protected span survives', () => {
  const compressed = [
    '# Project notes',
    '',
    'Build:',
    '',
    '```bash',
    'npm run build && node ./scripts/deploy.js',
    '```',
    '',
    'Docs: https://example.com/guide. Config: src/config/settings.json, helper `parseInput()`.',
    '',
    'Read [the runbook](docs/runbook.md) before production deploys.',
  ].join('\n');
  const { ok, missing } = verifyPreservation(ORIGINAL, compressed);
  assert.equal(ok, true, `unexpected missing: ${JSON.stringify(missing)}`);
});

test('verifyPreservation flags a dropped URL / code block as corruption', () => {
  const corrupted = '# Project notes\n\nBuild it, deploy it. Config in settings.';
  const { ok, missing } = verifyPreservation(ORIGINAL, corrupted);
  assert.equal(ok, false);
  assert.ok(missing.includes('https://example.com/guide'));
  assert.ok(missing.some((s) => s.includes('npm run build')));
});

test('compressionDelta never reports a negative saving', () => {
  assert.deepEqual(compressionDelta('aaaa', 'aaaa aaaa'), {
    baseline: 1,
    saved: 0,
  });
  const d = compressionDelta('x'.repeat(400), 'x'.repeat(100));
  assert.equal(d.baseline, 100);
  assert.equal(d.saved, 75);
});

// ── CLI: verify exit codes ──────────────────────────────────────────────────

function writePair(dir, original, candidate) {
  const o = path.join(dir, 'orig.md');
  const c = path.join(dir, 'cand.md');
  fs.writeFileSync(o, original);
  fs.writeFileSync(c, candidate);
  return { o, c };
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI verify exits 0 and reports a saving on a clean compress', () => {
  const dir = freshDir();
  const { o, c } = writePair(dir, ORIGINAL, ORIGINAL.replace('Basically, you should really just run', 'Run'));
  const r = runCli(['verify', o, c]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.ok(out.saved > 0);
});

test('CLI verify exits 1 when a protected span is dropped', () => {
  const dir = freshDir();
  const { o, c } = writePair(dir, ORIGINAL, '# notes\n\nshort.');
  const r = runCli(['verify', o, c]);
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
});

// ── CLI: record feeds the one honest bill ───────────────────────────────────

test('CLI record books the saving under bySource[memory-compress]', () => {
  const dir = freshDir();
  const cfg = freshDir();
  const { o, c } = writePair(dir, 'x'.repeat(400), 'x'.repeat(100));
  const r = runCli(['record', o, c, '--session', 'sess-mem'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).recorded, true);

  const ledger = aggregateLedger({}, path.join(cfg, '.scrooge', 'history.jsonl'));
  assert.equal(ledger.bySource['memory-compress'], 75);
  assert.equal(ledger.inputSavedTokens, 75);
});

test('CLI record refuses (exit 1, books nothing) on a corrupting compress', () => {
  const dir = freshDir();
  const cfg = freshDir();
  const { o, c } = writePair(dir, ORIGINAL, '# notes\n\nshort.');
  const r = runCli(['record', o, c, '--session', 'sess-bad'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).recorded, false);
  const histExists = fs.existsSync(path.join(cfg, '.scrooge', 'history.jsonl'));
  assert.equal(histExists, false, 'ledger was written despite corruption');
});

// ── corruption-escape regressions (review C1/C2/W1/I1 + codex findings) ──────

test('count-based verify catches a dropped DUPLICATE span (C1)', () => {
  const o = 'Step A: `rm -rf build` then\nStep B: again `rm -rf build`.';
  assert.equal(verifyPreservation(o, 'Once: `rm -rf build`.').ok, false);
});

test('count-based verify catches a span surviving only inside a corrupted token (C2)', () => {
  // `lib/auth.js` reworded to a DIFFERENT path; presence-includes would miss it.
  assert.equal(verifyPreservation('from lib/auth.js here', 'from src/lib/auth.js.backup here').ok, false);
});

test('path verify catches a dropped ?query / #anchor tail (W1)', () => {
  assert.equal(verifyPreservation('see ./docs/page.js?cachebust=9f3a2 ok', 'see ./docs/page.js ok').ok, false);
});

test('URL trailing-period is not a false corruption (I1)', () => {
  assert.equal(verifyPreservation('Visit https://x.com/page. Then go.', 'Visit https://x.com/page then go.').ok, true);
});

test('balanced parentheses in a URL are protected; stray ones are trimmed (codex r4)', () => {
  // Wikipedia-style URL: dropping the closing ) is corruption…
  const o = 'Docs: https://en.wikipedia.org/wiki/Foo_(bar)';
  assert.equal(verifyPreservation(o, 'Docs: https://en.wikipedia.org/wiki/Foo_(bar').ok, false);
  // …but a sentence-wrapping paren is not part of the URL (reflow must pass).
  assert.equal(verifyPreservation('(see https://x.com/a)', 'see https://x.com/a now').ok, true);
});

test('fence-length matching protects a 4-backtick block body (codex)', () => {
  const o = 'x\n````\n```js\nrm -rf /\n```\n````\ny';
  const c = 'x\n````\n```js\nrm -rf /tmp\n```\n````\ny';
  assert.equal(verifyPreservation(o, c).ok, false);
});

test('angle-bracket link targets with spaces are fully protected (codex)', () => {
  assert.equal(verifyPreservation('[r](<docs/My File.md>)', '[r](<docs/My Other.md>)').ok, false);
});

test('markdown link targets with inner parentheses are fully protected (codex r7)', () => {
  const o = 'Read [Foo](docs/Foo_(bar).md) before edit.';
  assert.equal(verifyPreservation(o, 'Read [Foo](docs/Foo_(bar).md.old) before edit.').ok, false);
  assert.ok(protectedSpans('[Foo](docs/Foo_(bar).md)').includes('docs/Foo_(bar).md'));
});

test('reference-style link definitions are protected against retargeting (codex r8)', () => {
  assert.equal(verifyPreservation('[runbook]:docs/runbook.md\nUse it.', '[runbook]:docs/incident.md\nUse it.').ok, false);
  assert.equal(verifyPreservation('[rb]: docs/runbook.md\nx', '[rb]: docs/incident.md\nx').ok, false);
  assert.ok(protectedSpans('[runbook]:docs/runbook.md').includes('docs/runbook.md'));
});

test('glob path patterns are protected, but markdown/math wildcards are not (codex r12)', () => {
  // Lint/scope globs must be caught when retargeted…
  assert.equal(verifyPreservation('Lint packages/*/src/**/*.ts here', 'Lint packages/*/src/**/*.js here').ok, false);
  assert.equal(verifyPreservation('ignore *.ts files', 'ignore *.js files').ok, false);
  assert.ok(protectedSpans('Lint packages/*/src/**/*.ts').includes('packages/*/src/**/*.ts'));
  // …while bold/emphasis/multiplication/bullets are not protected (no FP).
  assert.equal(protectedSpans('this is **bold**, a *word*, 5 * 3, and\n* a bullet').length, 0);
});

test('config dotfiles (.env variants) are protected against retargeting (codex r11)', () => {
  assert.equal(verifyPreservation('Load .env.local before running.', 'Load .env.production before running.').ok, false);
  assert.equal(verifyPreservation('copy .env to start', 'copy .env.bak to start').ok, false);
  assert.ok(protectedSpans('Load .env.local now').includes('.env.local'));
  // sentence-final dots / abbreviations are not dotfiles (no FP).
  assert.equal(protectedSpans('This is fine. Next thing. e.g. ok').length, 0);
});

test('bare config/doc filenames are protected, but prose abbreviations are not (codex r9)', () => {
  // Common bare-filename references (no slash) must be caught when retargeted…
  assert.equal(
    verifyPreservation('Load AGENTS.md first, check package.json.', 'Load README.md first, check package-lock.json.').ok,
    false
  );
  // …while prose abbreviations / decimals / versions stay compressible (no FP).
  assert.equal(protectedSpans('e.g. this, i.e. that').length, 0);
  assert.equal(protectedSpans('pi is 3.14 and v2.0 ships, U.S. only').length, 0);
  assert.equal(verifyPreservation('Check package.json carefully for scripts.', 'Check package.json for scripts.').ok, true);
});

test('a deleted destructive-action warning is corruption (codex / invariant ②)', () => {
  assert.equal(verifyPreservation('intro\nNever use --force on prod.\nmore', 'intro\nmore').ok, false);
  assert.equal(verifyPreservation('a\nRun rm -rf only with care.\nb', 'a\nb').ok, false);
});

test('rewording a safety line while keeping the command token is NOT a false rejection', () => {
  // The whole-line guard rejected this; the destructive-token guard must allow it.
  assert.equal(verifyPreservation('Never run rm -rf on prod.', 'Do not run rm -rf in production.').ok, true);
  // Common safety words (token / 삭제 / permission) must not lock a line verbatim.
  assert.equal(verifyPreservation('삭제하기 전에 사용자 확인을 받아야 합니다.', '삭제 전 사용자 확인 필수.').ok, true);
});

test('converting a link between plain and angle-bracket form is not a false rejection', () => {
  // Overlapping path+link matches must de-dup by range so one link counts once.
  assert.equal(verifyPreservation('[d](path/to/doc.md)', '[d](<path/to/doc.md>)').ok, true);
});

test('paths after assignment/colon delimiters are protected against retargeting (codex r10)', () => {
  // A path boundary is now a negative lookbehind, so KEY=path and key: path forms…
  assert.equal(verifyPreservation('CONFIG_PATH=src/auth/session.ts', 'CONFIG_PATH=lib/auth/session.ts').ok, false);
  assert.equal(verifyPreservation('config: src/a/b.ts here', 'config: src/c/b.ts here').ok, false);
  assert.ok(protectedSpans('CONFIG_PATH=src/auth/session.ts').includes('src/auth/session.ts'));
  // …without spuriously matching a URL sub-path or a mid-token segment.
  assert.equal(protectedSpans('https://x.com/a/b').filter((s) => s === '/a/b' || s === 'x.com/a/b').length, 0);
});

test('quoted / emphasized file paths are protected against retargeting (codex r6)', () => {
  // Quoted (prose / YAML) and *emphasized* extension paths must be caught…
  assert.equal(verifyPreservation('Edit "src/auth/session.ts" now.', 'Edit "src/auth/token.ts" now.').ok, false);
  assert.equal(verifyPreservation('file: "src/auth/session.ts"', 'file: "src/auth/token.ts"').ok, false);
  assert.equal(verifyPreservation('use *src/a/b.ts* here', 'use *src/a/c.ts* here').ok, false);
  // …the captured span excludes the delimiter, and a reword keeping the path passes.
  assert.ok(protectedSpans('Edit "src/auth/session.ts" now').includes('src/auth/session.ts'));
  assert.equal(verifyPreservation('Edit "src/auth/session.ts" carefully.', 'Edit "src/auth/session.ts".').ok, true);
});

test('@/ alias paths are protected against retargeting (codex r5)', () => {
  // Common Next/TS memory rule form (@/ -> src/); retargeting must be caught…
  assert.equal(verifyPreservation('Use @/components/Button.tsx for CTAs.', 'Use @/components/Card.tsx for CTAs.').ok, false);
  assert.equal(verifyPreservation('import @app/lib/db.ts here', 'import @app/lib/other.ts here').ok, false);
  // …without false-firing on a bare @mention (no slash) or rejecting a reword.
  assert.equal(protectedSpans('ping @alice for review').length, 0);
  assert.equal(verifyPreservation('Edit @/components/Button.tsx now.', 'Edit @/components/Button.tsx.').ok, true);
});

test('tilde-home and $VAR paths are protected against retargeting (codex r3)', () => {
  assert.equal(verifyPreservation('Load ~/Documents/scrooge/AGENTS.md', 'Load /tmp/scrooge/AGENTS.md').ok, false);
  assert.equal(verifyPreservation('cd $HOME/work/repo here', 'cd $HOME/other/repo here').ok, false);
  // …without a trailing-punctuation false positive, and `$5/month` is not a path.
  assert.equal(verifyPreservation('Edit ~/.claude/CLAUDE.md carefully.', 'Edit ~/.claude/CLAUDE.md.').ok, true);
  assert.equal(protectedSpans('costs $5/month total').length, 0);
});

test('destructive-token guard does not over-fire on prose / longer flags', () => {
  // Prose words and longer flags must NOT be protected (false-positive friction)…
  assert.equal(verifyPreservation('Truncate the old notes here.', 'Trim old notes.').ok, true);
  assert.equal(verifyPreservation('delete from the backlog mentally.', 'drop stale backlog.').ok, true);
  assert.equal(verifyPreservation('Use git push --force-with-lease here.', 'Prefer --force-with-lease.').ok, true);
  // …but real destructive statements/flags are still count-protected.
  assert.equal(verifyPreservation('a\nNever DELETE FROM orders\nb', 'a\nb').ok, false);
  assert.equal(verifyPreservation('a\nnever --force push\nb', 'a\nb').ok, false);
});

test('a non-empty original compressed to empty fails closed (codex)', () => {
  assert.equal(verifyPreservation('real policy content here', '').ok, false);
});

test('CLI record refuses (exit 2) when the candidate arg is absorbed by a flag (W2)', () => {
  const dir = freshDir();
  const { o } = writePair(dir, 'intro `keep` and prose', 'intro `keep`');
  const r = runCli(['record', o, '--session', 'k']); // candidate omitted
  assert.equal(r.status, 2);
});

test('CLI refuses a binary file (NUL byte) instead of utf8-mangling it (W3)', () => {
  const dir = freshDir();
  const o = path.join(dir, 'bin.md');
  const c = path.join(dir, 'cand.md');
  fs.writeFileSync(o, Buffer.from([0x61, 0x00, 0x62]));
  fs.writeFileSync(c, 'text');
  const r = runCli(['verify', o, c]);
  assert.equal(r.status, 2);
});
