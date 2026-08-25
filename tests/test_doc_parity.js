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

import { VALID_LANGS, VALID_DIALS } from '../hooks/scrooge-config.js';
import { deriveEstimate } from '../hooks/scrooge-stats.js';
import { savingsMeta } from '../hooks/lang-meta.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const lineMatching = (body, re) => body.split('\n').find((l) => re.test(l));

// Languages that carry a measured savings ratio — probed through the public stats
// estimator instead of importing the private SAVINGS_RATIO constant. These MUST
// appear in the savings headline; an unbenchmarked language (in VALID_LANGS but
// with no ratio, which now says so explicitly) is intentionally NOT required there.
const benchmarkedLangs = VALID_LANGS.filter((l) => deriveEstimate(1000, l, 'full') != null);

// English count word for a roster of n languages; past the common ladder a brand
// may fall back to the count-agnostic "multilingual", which the check also accepts.
const LINGUAL = { 1: 'monolingual', 2: 'bilingual', 3: 'trilingual', 4: 'quadrilingual', 5: 'pentalingual', 6: 'hexalingual' };

// (A) Every registry language appears in each README's register-axis roster.
for (const f of ['README.md', 'README.ko.md']) {
  test(`${f} axis roster lists every registry language`, () => {
    const axis = lineMatching(read(f), /`\/scrooge \[lang\] \[dial\]`/);
    assert.ok(axis, `${f}: register axis line (\`/scrooge [lang] [dial]\` row) not found`);
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

// (C) The SKILL register table carries a row for every language × shipped dial.
test('skills/scrooge/SKILL.md register table covers every language × dial', () => {
  const body = read('skills/scrooge/SKILL.md');
  for (const lang of VALID_LANGS) {
    for (const dial of VALID_DIALS) {
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

// (F) No "measurement pending" claim survives for a language that already carries a
// measured section. The ZH self-contradiction (a "measurement is pending" sentence
// sitting above ZH's own measured fidelity/savings table) is the exact pattern this
// catches. Scoped to benchmarked languages (a set SAVINGS_RATIO membership defines),
// so a dial that publishes no ratio (lite — measured, NO-GO) never trips it.
const pendingPattern = {
  'README.md': (lang) => new RegExp(lang.toUpperCase() + '[^.\\n]*measurement is pending', 'i'),
  'README.ko.md': (lang) => new RegExp(lang.toUpperCase() + '[^.\\n]*측정[^.\\n]{0,6}대기'),
};
for (const [f, mk] of Object.entries(pendingPattern)) {
  test(`${f} carries no "measurement pending" for a benchmarked language`, () => {
    const body = read(f);
    for (const lang of benchmarkedLangs) {
      assert.ok(
        !mk(lang).test(body),
        `${f}: "${lang.toUpperCase()} … measurement pending" contradicts its measured section — remove the stale pending sentence`
      );
    }
  });
}

// (G) Every benchmarked (lang, full) carries complete savings provenance in
// LANG_META — ratio + results + n + model — so each headline ratio is traceable to
// its backing benchmark (results file(s), sample size, model). Presence-only, per
// field: `results` may be a multi-file array and `n` a per-file count, so no single
// fabricated n is ever required to pass. This is the G4 traceability guard: a ratio
// present but missing its provenance fails.
test('every benchmarked savings ratio carries results + n + model provenance', () => {
  for (const lang of benchmarkedLangs) {
    const meta = savingsMeta(lang, 'full');
    assert.ok(meta, `${lang}/full: benchmarked but no LANG_META savings entry`);
    assert.equal(typeof meta.ratio, 'number', `${lang}/full: ratio must be a number`);
    const results = meta.results;
    assert.ok(
      (Array.isArray(results) && results.length > 0) ||
        (typeof results === 'string' && results.length > 0),
      `${lang}/full: results provenance missing (backing benchmark file trail)`
    );
    assert.ok(meta.n != null, `${lang}/full: n (sample size) provenance missing`);
    assert.ok(
      typeof meta.model === 'string' && meta.model.length > 0,
      `${lang}/full: model provenance missing`
    );
  }
});

// (H) The LANG_META ratio a user sees in /scrooge-stats and the README table a
// reader recomputes from published rows must be the SAME measurement. They are two
// hand-maintained surfaces over one dataset, so they drift silently: before this
// guard ko carried an opus-4-7 ratio against an opus-4-8 table (2.5pp off) and the
// hi/zh ratios were transposed (3pp each, in opposite directions).
//
// Derivation, matching how the published tables are computed:
//   ratio = 1 − median(scrooge) / median(normal), rounded to 2 decimals.
// The README medians are the assertion's input, so a table edit that changes a
// number without updating LANG_META fails here rather than shipping.
function readmeMedians(body, lang) {
  // Number-only cells, in order. A savings cell like `~64% (per-prompt 69.6%)`
  // is not number-only, so it never masquerades as a median.
  const numbers = (line) =>
    line
      .replace(/\*\*/g, '')
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
      .filter((c) => /^\d[\d,]*$/.test(c))
      .map((c) => Number(c.replace(/,/g, '')));

  const lines = body.split('\n');
  const armIdx = lines.findIndex((l) => l.includes(`\`scrooge:${lang}/full\``) && l.trim().startsWith('|'));
  if (armIdx === -1) return null;
  const armNums = numbers(lines[armIdx]);

  // Two README table shapes carry the same measurement:
  //   per-language — one median per row, with a `normal` row above in the table
  //   combined     — `| arm | normal | scrooge | savings | fidelity |` on one row
  if (armNums.length >= 2) return { normal: armNums[0], scrooge: armNums[1] };
  for (let i = armIdx; i >= 0 && lines[i].trim().startsWith('|'); i--) {
    if (/\|\s*`normal`\s*\|/.test(lines[i])) {
      const n = numbers(lines[i])[0];
      return n && armNums[0] ? { normal: n, scrooge: armNums[0] } : null;
    }
  }
  return null;
}

// (J) A register-drift note's version must stop being provisional once the release
// it names has actually shipped. RELEASE.md §1a requires the note to NAME a version,
// but the version is unknowable while the bump is still undecided — /my-release picks
// the level from Conventional Commit types, so the note is written with a provisional
// value and corrected in the release commit. Nothing forced that correction: a stale
// `(provisional` marker reads exactly like a real disposition to the next reader, and
// §1's pre-flight is human-run prose. This is the same shape as the "measurement
// pending" doc-truth guard above — the moment the version sources reach the version
// the note names, the marker is a lie and `npm test` says so.
test('a shipped register-drift note is no longer marked provisional', () => {
  const body = read('benchmarks/published/README.md');
  const current = JSON.parse(read('package.json')).version;
  const lines = body.split('\n').filter((l) => /\(provisional/i.test(l));
  for (const line of lines) {
    const m = line.match(/v(\d+\.\d+\.\d+)/);
    assert.ok(
      m,
      `drift note marked provisional but names no version — RELEASE.md §1a requires one:\n  ${line.trim()}`
    );
    assert.notEqual(
      m[1],
      current,
      `drift note still says "(provisional" for v${m[1]}, which is the shipped version ` +
        `in package.json — drop the provisional marker (or fix the version) before releasing`
    );
  }
});

test('LANG_META ratios match the README tables they are derived from', () => {
  const body = read('README.md');
  for (const lang of benchmarkedLangs) {
    const medians = readmeMedians(body, lang);
    assert.ok(medians, `README.md: no benchmark table row found for scrooge:${lang}/full`);
    const derived = Number((1 - medians.scrooge / medians.normal).toFixed(2));
    assert.equal(
      savingsMeta(lang, 'full').ratio,
      derived,
      `${lang}/full: LANG_META ratio disagrees with README (normal ${medians.normal} → scrooge ${medians.scrooge} = ${derived})`
    );
  }
});

// (I) The compression-scope contract (`## Boundaries` in the rules) is exposed in
// the product README. Without a row here an installer reads the whole README and
// still cannot tell whether their commit messages get compressed — the contract
// lived only in the rule bodies and `SKILL.md`. Both halves must be on the row:
// the permanent exclusion AND the docs-are-compressed side; stating one alone is
// the doc/behavior mismatch this spec exists to remove.
//
// The row label is the English literal `| Boundaries |` in BOTH READMEs (the KO
// table already labels a row `Safety auto-clarity`), so one anchor finds it in
// each. Scope is the KO/EN canonical pair; `README.ja.md`/`README.zh.md` are
// lightweight landings with no Surface table at all.
//
// Marker provenance differs per language, and only the EN side is a shared string:
// `tests/test_doc_boundaries.js` pins `Docs / prose artifacts` and the English
// exclusion label in all five rule bodies, so the EN row cannot describe a
// boundary the rules do not state. The KO markers are that same contract in
// Korean — `rules/ko/full.md` writes the exclusion label in English, so there is
// no Korean string in the rules to share. They are pinned here alone, which is
// what the row-correspondence check below exists to cover.
const BOUNDARIES_MARKERS = {
  'README.md': {
    heading: '## Surface',
    markers: ['commit messages', 'PR descriptions', 'Docs / prose artifacts'],
  },
  'README.ko.md': {
    heading: '## 표면',
    markers: ['커밋 메시지', 'PR 설명', 'Docs·prose 산출물'],
  },
};

// The lines of one `## ` section's first markdown table, header and separator
// dropped. Bounded by the next `## ` heading so a vanished table fails loudly
// instead of silently measuring whatever table comes next.
function surfaceRows(f, heading) {
  const lines = read(f).split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  assert.ok(start !== -1, `${f}: "${heading}" section not found`);
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) {
      if (rows.length > 0) break; // table ended
      continue; // not reached it yet
    }
    if (/^\|[\s|:-]+\|$/.test(line)) continue; // separator
    rows.push(line);
  }
  assert.ok(rows.length > 0, `${f}: no table found under "${heading}"`);
  return rows.slice(1); // drop the header row
}

for (const [f, { heading, markers }] of Object.entries(BOUNDARIES_MARKERS)) {
  test(`${f} Surface table carries the Boundaries row`, () => {
    // Searched inside the section, not the whole file: a row that migrated out of
    // the Surface table would otherwise keep this test green.
    const rows = surfaceRows(f, heading).filter((l) => /^\|\s*Boundaries\s*\|/.test(l));
    // Exactly one: a duplicated row passes a presence check AND the row-count
    // check below when both READMEs duplicate it, so neither would catch it.
    assert.equal(rows.length, 1, `${f}: expected exactly one \`| Boundaries |\` row in ${heading}, found ${rows.length}`);
    const [row] = rows;
    for (const marker of markers) {
      assert.ok(
        row.includes(marker),
        `${f}: Boundaries row does not mention "${marker}" — state both halves of the contract`
      );
    }
  });
}

test('both README Surface tables have the same number of rows', () => {
  // A row added to one README only is the drift class this catches: the two
  // tables are hand-maintained mirrors, and a missing row reads as a contract
  // that does not apply to that language's readers.
  assert.equal(
    surfaceRows('README.md', '## Surface').length,
    surfaceRows('README.ko.md', '## 표면').length,
    'README.md and README.ko.md Surface tables disagree on row count'
  );
});
