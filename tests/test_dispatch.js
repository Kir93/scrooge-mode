// test_dispatch.js — N-ary dispatch generality guard.
//
// The activation refactor turned five ko/en/ja branches (NL cue, reminder,
// countermand, FLAG_HINT, statusline lang) into language-agnostic, table-driven
// dispatch — LANG_META rows + a registry-derived VALID_LANGS. This test pins the
// payoff the refactor exists for: a brand-new language added as ONE LANG_META row
// (plus the registry-derive seam) flows through every surface — NL parse, reminder,
// countermand, statusline lang extraction, and the stats label — with no branch
// edit; and a language with NO table row degrades to a safe fallback, never a crash.
//
// Injection seam (Codex #3): the fake `xx` language is injected into the exported
// LANG_META object and exercised through the pure deriveValidLangs(registryObj)
// export. node:test runs each file in its own process, so the mutation is local to
// this file and the tracked registry.json is never touched — the seam tests the real
// dispatch path without a fake registry on disk.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LANG_META,
  buildReminder,
  buildCountermand,
  metaLangs,
} from '../hooks/lang-meta.js';
import { parseNaturalActivation } from '../hooks/nl-activation.js';
import { deriveValidLangs } from '../hooks/scrooge-config.js';
import { deriveEstimate, formatStats, suffixFor } from '../hooks/scrooge-stats.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const STATUSLINE = path.join(REPO_ROOT, 'hooks', 'scrooge-statusline.sh');

// A fake language defined entirely as one LANG_META row — the exact unit a real new
// language adds. Cue tokens are distinctive ("zzlang") so they never collide with the
// ko/en/ja fixtures and the row sits last (lowest NL priority).
const XX = {
  reminder: {
    head: 'SCROOGE xx',
    modeClose: '. ',
    lite: 'xx-lite-body. ',
    full: 'xx-full-body. ',
    suffix: 'xx-suffix.',
    flag: { prefix: ' flag: ', sep: '·', suffix: ' on.' },
  },
  countermand: 'SCROOGE OFF — xx countermand.',
  flagHint: { lean: 'lean(xx)' },
  nlCue: {
    name: /zzlang/i,
    activate: /zzlang on/i,
    off: /zzlang off/i,
    negate: /zznope/i,
    meta: /zzmeta/i,
    strong: /zzlang on/i,
  },
};

LANG_META.xx = XX;

const tmpDirs = [];
after(() => {
  delete LANG_META.xx;
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── byte-identical regression guard (spec acceptance criterion #1) ──────────────
// The pre-refactor hook hardcoded each language's reminder/countermand strings; the
// existing fixtures only partial-match the reminder HEADER (e.g. test_activate.js's
// `/SCROOGE 활성 \(ko\/full\)/`), leaving the body + suffix (and ja's distinct
// trailing-space placement) and the full countermand unpinned. These frozen golden
// strings are the verbatim pre-refactor output for every ko/en/ja × lite/full × flags
// combination; a 1-byte drift in any LANG_META string fails here — the regression
// the refactor's "move verbatim, don't rewrite" prime directive rides on.
const GOLDEN_REMINDER = {
  'ko|lite|-': 'SCROOGE 활성 (ko/lite). 다듬은 존댓말, filler·빈 인사·hedging 드롭, 완전문. code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose.',
  'ko|lite|lean': 'SCROOGE 활성 (ko/lite). 다듬은 존댓말, filler·빈 인사·hedging 드롭, 완전문. code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose. flag: lean(최소 코드) 활성.',
  'ko|full|-': 'SCROOGE 활성 (ko/full). 개조식·음슴체(~함/~됨), 의미 명확 시 조사 드롭, 존대 제거. code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose.',
  'ko|full|lean': 'SCROOGE 활성 (ko/full). 개조식·음슴체(~함/~됨), 의미 명확 시 조사 드롭, 존대 제거. code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose. flag: lean(최소 코드) 활성.',
  'en|lite|-': 'SCROOGE active (en/lite). Drop filler/pleasantry/hedging, keep grammar + articles. Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.',
  'en|lite|lean': 'SCROOGE active (en/lite). Drop filler/pleasantry/hedging, keep grammar + articles. Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose. Flags: lean (minimal code) active.',
  'en|full|-': 'SCROOGE active (en/full). Drop articles/filler/pleasantries, fragments OK, short synonyms. Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.',
  'en|full|lean': 'SCROOGE active (en/full). Drop articles/filler/pleasantries, fragments OK, short synonyms. Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose. Flags: lean (minimal code) active.',
  'ja|lite|-': 'SCROOGE 活性 (ja/lite)。 整えた丁寧体、filler・空のあいさつ・hedging ドロップ、完全文。 code block・error・技術用語は原文。セキュリティ／取り消せない操作は normal prose。',
  'ja|lite|lean': 'SCROOGE 活性 (ja/lite)。 整えた丁寧体、filler・空のあいさつ・hedging ドロップ、完全文。 code block・error・技術用語は原文。セキュリティ／取り消せない操作は normal prose。 flag: lean（最小コード） 活性。',
  'ja|full|-': 'SCROOGE 活性 (ja/full)。 体言止め・常体、意味明確時は助詞ドロップ、敬語除去。 code block・error・技術用語は原文。セキュリティ／取り消せない操作は normal prose。',
  'ja|full|lean': 'SCROOGE 活性 (ja/full)。 体言止め・常体、意味明確時は助詞ドロップ、敬語除去。 code block・error・技術用語は原文。セキュリティ／取り消せない操作は normal prose。 flag: lean（最小コード） 活性。',
};
const GOLDEN_COUNTERMAND = {
  ko: 'SCROOGE OFF — 압축 모드 해제. 이번 턴부터 평소 register(일반 문체)로 복귀.',
  en: 'SCROOGE OFF — compression mode deactivated. Return to your normal register from this turn on.',
  ja: 'SCROOGE OFF — 圧縮モード解除。今ターンから通常の register（通常文体）に復帰。',
};

test('ko/en/ja reminder + countermand are byte-identical to the pre-refactor output', () => {
  for (const lang of ['ko', 'en', 'ja']) {
    for (const dial of ['lite', 'full']) {
      for (const flags of [[], ['lean']]) {
        const key = `${lang}|${dial}|${flags.join('+') || '-'}`;
        assert.equal(buildReminder(lang, dial, flags), GOLDEN_REMINDER[key], key);
      }
    }
    assert.equal(buildCountermand(lang), GOLDEN_COUNTERMAND[lang], `countermand ${lang}`);
  }
});

// ── registry-derive seam: a new registry lang is recognized with no array edit ──

test('deriveValidLangs picks up a new registry lang (no hardcoded array)', () => {
  // The slash parser's lang scan and every VALID_LANGS consumer derive from this, so
  // a registry key is the only edit needed for recognition. `fragments` is excluded.
  assert.deepEqual(
    deriveValidLangs({ ko: {}, en: {}, ja: {}, xx: {}, fragments: {} }),
    ['ko', 'en', 'ja', 'xx']
  );
});

// ── one LANG_META row joins every dispatch surface ──────────────────────────────

test('metaLangs appends the new row in table order (lowest priority)', () => {
  assert.deepEqual(metaLangs(), ['ko', 'en', 'ja', 'xx']);
});

test('NL parse dispatches to the new lang from its cue row, without disturbing ko/en/ja', () => {
  assert.deepEqual(parseNaturalActivation('zzlang on'), { action: 'set', lang: 'xx', dial: 'full' });
  assert.deepEqual(parseNaturalActivation('zzlang off'), { action: 'off' });
  // The appended row must not perturb the existing ko→en→ja precedence.
  assert.equal(parseNaturalActivation('스크루지처럼').lang, 'ko');
  assert.equal(parseNaturalActivation('scrooge mode').lang, 'en');
  assert.equal(parseNaturalActivation('スクルージみたいに').lang, 'ja');
});

test('reminder + countermand dispatch from the new table row (no branch edit)', () => {
  assert.equal(
    buildReminder('xx', 'full', ['lean']),
    'SCROOGE xx (xx/full). xx-full-body. xx-suffix. flag: lean(xx) on.'
  );
  assert.equal(buildReminder('xx', 'lite', []), 'SCROOGE xx (xx/lite). xx-lite-body. xx-suffix.');
  assert.equal(buildCountermand('xx'), 'SCROOGE OFF — xx countermand.');
});

test('statusline extracts the new lang code with no edit (generic charset)', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-disp-'));
  tmpDirs.push(cfg);
  fs.writeFileSync(
    path.join(cfg, '.scrooge-active'),
    JSON.stringify({ lang: 'xx', dial: 'full', flags: [] })
  );
  const r = spawnSync('bash', [STATUSLINE], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, SCROOGE_STATUSLINE_SAVINGS: '0' },
  });
  assert.equal(r.status, 0, `statusline exited ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /\[SCROOGE:xx\/full\]/);
});

test('stats label dispatches generically; an un-benchmarked lang degrades gracefully', () => {
  const state = { lang: 'xx', dial: 'full', flags: [] };
  assert.equal(deriveEstimate(1000, 'xx', 'full'), null); // no ratio → no fabricated savings
  const out = formatStats({
    turns: 2,
    outputTokens: 500,
    proseOutputTokens: 400,
    cacheReadTokens: 0,
    state,
  });
  assert.match(out, /Mode:\s+xx\/full/);
  assert.match(out, /Savings estimate pending — no benchmark ratio for 'xx\/full'/);
  assert.match(suffixFor({ outputTokens: 500, turns: 2, state }), /tok/); // raw tokens, not a fake est
});

// ── missing table row → safe fallback (no crash) ────────────────────────────────

test('a lang with NO table row falls back to the en register (matches the legacy fallthrough)', () => {
  assert.ok(!LANG_META.zz, 'precondition: zz must not be defined');
  // Unknown lang → full en reminder, en header label and all (byte-identical to the
  // original hook's en fallthrough, which hardcoded "en" in the header). Unreachable
  // for a real registry lang — test_registry_parity fails before this could ship.
  assert.equal(
    buildReminder('zz', 'full', ['lean']),
    'SCROOGE active (en/full). Drop articles/filler/pleasantries, fragments OK, short synonyms. ' +
      'Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.' +
      ' Flags: lean (minimal code) active.'
  );
  assert.equal(
    buildCountermand('zz'),
    'SCROOGE OFF — compression mode deactivated. Return to your normal register from this turn on.'
  );
  // An undefined lang simply isn't NL-detected (no row, no cues) — never a throw.
  assert.equal(parseNaturalActivation('a plain prompt with no cue'), null);
});
