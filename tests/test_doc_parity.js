// Doc language-roster parity guard (release pre-flight — runs under `npm test`).
//
// When a new language ships (registry + LANG_META + rule files) it must also be
// reflected in the user-facing docs. Two gap classes slipped through when `hi`
// shipped, and this guards both so `/my-release`'s `npm test` pre-flight (and CI)
// catches them before publish:
//   (A) a registry language missing from a README language roster, and
//   (B) a stale brand count word ("trilingual (KO/EN/JA)") after the count changed.
// It also checks the savings headline reflects every *benchmarked* language, the
// SKILL register table has a row per language, and no stale two-language phrasing
// survives. It asserts presence, not exact wording — low false-positive, and it
// fires the moment a language is added without its doc updates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_LANGS } from '../hooks/scrooge-config.js';
import { deriveEstimate } from '../hooks/scrooge-stats.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const lineMatching = (body, re) => body.split('\n').find((l) => re.test(l));

// Languages that carry a measured savings ratio — probed through the public stats
// estimator instead of importing the private SAVINGS_RATIO constant. These MUST
// appear in the savings headline; an unbenchmarked language (in VALID_LANGS but
// with no ratio → "estimate pending") is intentionally NOT required there.
const benchmarkedLangs = VALID_LANGS.filter((l) => deriveEstimate(1000, l, 'full') != null);

// English count word for a roster of n languages; past the common ladder a brand
// may fall back to the count-agnostic "multilingual", which the check also accepts.
const LINGUAL = { 1: 'monolingual', 2: 'bilingual', 3: 'trilingual', 4: 'quadrilingual', 5: 'pentalingual', 6: 'hexalingual' };

// (A) Every registry language appears in each README's register-axis roster.
for (const f of ['README.md', 'README.ko.md']) {
  test(`${f} axis roster lists every registry language`, () => {
    const axis = lineMatching(read(f), /`lite`\/`full`/);
    assert.ok(axis, `${f}: register axis line (…× \`lite\`/\`full\`) not found`);
    for (const lang of VALID_LANGS) {
      assert.ok(
        axis.includes(`\`${lang}\``),
        `${f}: axis roster missing \`${lang}\` — add it to the "two axes" line`
      );
    }
  });
}

// (B) The savings headline lists every benchmarked language (uppercase code).
for (const f of ['README.md', 'README.ko.md']) {
  test(`${f} savings headline lists every benchmarked language`, () => {
    const headline = lineMatching(read(f), /~\d+% KO/);
    assert.ok(headline, `${f}: savings headline line (~NN% KO …) not found`);
    for (const lang of benchmarkedLangs) {
      assert.ok(
        headline.includes(lang.toUpperCase()),
        `${f}: headline missing ${lang.toUpperCase()} — SAVINGS_RATIO.${lang} is set but the headline omits it`
      );
    }
  });
}

// (C) The SKILL register table carries a lite + full row for every language.
test('skills/scrooge/SKILL.md register table covers every language × dial', () => {
  const body = read('skills/scrooge/SKILL.md');
  for (const lang of VALID_LANGS) {
    for (const dial of ['lite', 'full']) {
      const re = new RegExp('\\|\\s*' + lang.toUpperCase() + '\\s*·\\s*' + dial + '\\s*\\|');
      assert.match(body, re, `SKILL.md Registers table missing a "${lang.toUpperCase()} · ${dial}" row`);
    }
  }
});

// (D) The brand count word matches the language count (catches a stale
// "trilingual (KO/EN/JA)" after a 4th language shipped). README.ko.md uses the
// count-agnostic "다중언어", so only the English brand surfaces are checked.
const expectedLingual = LINGUAL[VALID_LANGS.length];
for (const f of ['README.md', 'README.ja.md']) {
  test(`${f} brand count word matches ${VALID_LANGS.length} languages`, () => {
    const body = read(f);
    const ok =
      (expectedLingual && new RegExp(`\\b${expectedLingual}\\b`, 'i').test(body)) ||
      /\bmultilingual\b/i.test(body);
    assert.ok(
      ok,
      `${f}: brand should say "${expectedLingual || 'multilingual'}" for ${VALID_LANGS.length} languages (or "multilingual")`
    );
  });
}

// (E) No stale two-language phrasing survives a multi-language product.
test('READMEs carry no stale "two languages" phrasing', () => {
  const stale = [
    ['README.md', /both languages/i],
    ['README.ko.md', /양\s*언어/],
  ];
  for (const [f, re] of stale) {
    assert.ok(
      !re.test(read(f)),
      `${f}: stale two-language phrase ${re} — use language-agnostic wording (covers ${VALID_LANGS.join('/')})`
    );
  }
});
