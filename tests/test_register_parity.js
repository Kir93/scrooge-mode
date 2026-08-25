// Register rule-item parity across languages and dials (integrity-sweep Task 12).
//
// The gap this fills: `test_safety_escape.js` and `test_doc_boundaries.js` check
// that a heading and a couple of tokens exist per (lang, dial), and
// `test_golden_corpus.js` is a frozen-fixture tripwire that by design does not
// move when rule text changes. So a rule item could live in one language and be
// missing from the other four indefinitely — which is exactly what happened: the
// Auto-Clarity anti-abuse sentence existed only in `en/full`, every other file
// shipped with zero safety guards, and a Korean word (`개조식`) sat inside the
// Chinese register.
//
// This test asserts per rule item, not per file. Each RULES entry declares where
// the item must appear; an item that legitimately belongs to a subset of
// languages declares that subset WITH a reason, so narrowing coverage requires
// writing down why. `langs: 'all'` is the default and the strictest form.
//
// Matching is per-language token-based (a Korean rule is written in Korean), so
// each entry carries either one shared token or a per-language token map.
//
// The declarations live in `fixtures/register-rules.js` so `test_skill_register_parity.js`
// checks the SAME item list against `skills/scrooge/SKILL.md` — two copies would drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_LANGS, VALID_DIALS } from '../hooks/scrooge-config.js';
import { RULES, langsFor, tokenFor } from './fixtures/register-rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const body = (lang, dial) =>
  fs.readFileSync(path.join(REPO_ROOT, 'rules', lang, `${dial}.md`), 'utf8');


for (const rule of RULES) {
  test(`register rule "${rule.id}" is present everywhere it should be`, () => {
    const expected = langsFor(rule);
    if (rule.langs !== 'all') {
      assert.ok(
        typeof rule.langs.reason === 'string' && rule.langs.reason.length > 20,
        `${rule.id}: a subset of languages needs a written reason, not a bare list`
      );
    }
    for (const lang of expected) {
      const token = tokenFor(rule, lang);
      assert.ok(token, `${rule.id}: no token defined for ${lang}`);
      for (const dial of rule.dials) {
        assert.ok(
          body(lang, dial).includes(token),
          `${rule.id} missing from ${lang}/${dial} — ${rule.what} (looked for: ${token})`
        );
      }
    }
  });
}

test('a language-specific rule has not silently spread to languages it would break', () => {
  // The inverse direction. Without it, "exception" degrades into "wherever it
  // happened to land": the hangul-only rule appearing in ja/zh would be an active
  // bug, not extra coverage.
  for (const rule of RULES) {
    if (rule.langs === 'all') continue;
    const expected = new Set(rule.langs.list);
    for (const lang of VALID_LANGS) {
      if (expected.has(lang)) continue;
      const token = tokenFor(rule, lang) ?? (typeof rule.token === 'string' ? rule.token : null);
      if (!token) continue;
      for (const dial of rule.dials) {
        assert.ok(
          !body(lang, dial).includes(token),
          `${rule.id} appeared in ${lang}/${dial}, which the exception excludes.\nReason on file: ${rule.langs.reason}`
        );
      }
    }
  }
});

// Structural drift the item checks above cannot see: a register that quietly
// loses half its demonstration pairs or its rule bullets still passes every
// token check. These are floors, not exact counts — adding examples is fine.
const FLOORS = { full: { notPairs: 4, bullets: 25 } };

for (const dial of VALID_DIALS) {
  test(`every ${dial} register keeps its demonstration pairs and rule bullets`, () => {
    for (const lang of VALID_LANGS) {
      const text = body(lang, dial);
      const notPairs = (text.match(/^Not:/gm) ?? []).length;
      const yesPairs = (text.match(/^Yes:/gm) ?? []).length;
      const bullets = (text.match(/^- /gm) ?? []).length;
      assert.ok(
        notPairs >= FLOORS[dial].notPairs,
        `${lang}/${dial}: ${notPairs} Not: examples, floor is ${FLOORS[dial].notPairs}`
      );
      assert.equal(notPairs, yesPairs, `${lang}/${dial}: ${notPairs} Not: vs ${yesPairs} Yes: — every counter-example needs its fix`);
      assert.ok(
        bullets >= FLOORS[dial].bullets,
        `${lang}/${dial}: ${bullets} rule bullets, floor is ${FLOORS[dial].bullets}`
      );
    }
  });
}

test('no Korean text leaks into a non-Korean register body', () => {
  // `개조식` sat inside rules/zh/full.md for five releases. Hangul syllables have
  // no business in ja/en/hi/zh rule bodies; the hook injects the body verbatim.
  const HANGUL = /[가-힣]/;
  for (const lang of VALID_LANGS) {
    if (lang === 'ko') continue;
    for (const dial of VALID_DIALS) {
      const hits = body(lang, dial)
        .split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => HANGUL.test(line));
      assert.deepEqual(
        hits.map(([n, line]) => `${lang}/${dial}:${n} ${line.trim().slice(0, 60)}`),
        [],
        'Korean text in a non-Korean register'
      );
    }
  }
});
