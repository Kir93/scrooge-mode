// Register rule-item declarations — the single source both parity tests read.
//
// `test_register_parity.js` asserts each item across the five `rules/{lang}/full.md`
// files; `test_skill_register_parity.js` asserts the same items across the ONE
// register skill-only hosts receive (`skills/scrooge/SKILL.md`). Duplicating the
// list would let the two contracts drift apart, which is the exact regression the
// skill test exists to catch — four items were missing from SKILL.md while CI
// stayed green.
//
// It lives under `tests/fixtures/` rather than beside the tests because
// `node --test` re-registers the top-level `test()` calls of any test file that is
// imported (v24.19.0): importing `test_register_parity.js` would run its 11 tests
// twice in one `npm test`. A fixture module has no tests to re-register, and
// `test_meta_invariants.js` reads only the top level of `tests/`, so it is not
// mistaken for an unregistered test file.
//
// token: a string every language shares, or { lang: string } when each language
//   states the rule in its own words.
// langs: 'all', or { list: [...], reason: '...' } — a subset MUST carry a reason.
// skill: how the item is anchored in SKILL.md —
//   true             → reuse `token` (or `token.en` on a per-language map),
//   { token: '...' } → a SKILL-specific anchor (the rules token does not appear there),
//   { exempt: '...' }→ out of scope for SKILL.md, reason required.

import { VALID_LANGS } from '../../hooks/scrooge-config.js';

export const RULES = [
  {
    id: 'ultra-tactics-floor',
    what: 'the "do not compress into ultra tactics" floor',
    dials: ['full'],
    token: 'ultra tactics',
    langs: 'all',
    skill: true,
  },
  {
    id: 'non-actionable-guard',
    what: 'never shorten into a non-actionable answer',
    dials: ['full'],
    token: 'non-actionable',
    langs: 'all',
    skill: true,
  },
  {
    id: 'auto-clarity-anti-abuse',
    what: 'Auto-Clarity must not become a general escape to lengthen answers',
    dials: ['full'],
    token: { en: 'general escape', ko: '남용', ja: '濫用', zh: '滥用', hi: 'दुरुपयोग' },
    langs: 'all',
    skill: true,
  },
  {
    id: 'docs-escape',
    what: 'the Docs-escape clause (formal full version on explicit request)',
    dials: ['full'],
    token: 'Docs escape',
    langs: 'all',
    skill: true,
  },
  {
    id: 'pro-drop',
    what: 'subject pro-drop where unambiguous',
    dials: ['full'],
    token: 'pro-drop',
    langs: 'all',
    skill: true,
  },
  {
    id: 'particle-hazard',
    what: 'a warning that dropping a case particle can flip argument roles',
    dials: ['full'],
    token: { ko: '논항 역할이 뒤집힐', ja: '項の役割が逆転', hi: 'अर्थ बदलने का जोखिम', zh: '过删改变义' },
    langs: {
      list: ['ko', 'ja', 'hi', 'zh'],
      reason:
        'English has no case particles to drop, so the hazard does not exist there. ' +
        'The other four all mark arguments with particles/postpositions.',
    },
    // SKILL.md is written in English and states the hazard language-neutrally, so
    // there is no per-language token to reuse (`token` carries no `en` key).
    skill: { token: 'would create ambiguity' },
  },
  {
    id: 'hangul-only',
    what: 'the Han-character block (write Sino-Korean in Hangul)',
    dials: ['full'],
    // The exact rule phrasing, not the bare word "Hangul": ja/full
    // legitimately NAME this rule while stating its inverse ("KO の Hangul-only
    // 規則とは逆方向"), and a looser token would read that mention as the rule.
    token: 'Hangul script only',
    langs: {
      list: ['ko'],
      reason:
        'Korean-specific and deliberately inverted elsewhere: Japanese kanji are correct ' +
        'orthography, and Chinese is written in Han characters by definition. Porting this ' +
        'rule would corrupt ja/zh output.',
    },
    skill: {
      exempt:
        'SKILL.md names the rule only inside the JA orthography contrast ("unlike KO\'s ' +
        'Hangul-only rule"), which is a mention, not the rule itself. Anchoring on it would ' +
        'let the mention satisfy the check; stating the KO-only rule in an English summary ' +
        'aimed at all five languages would misread as a global one.',
    },
  },
  {
    id: 'em-dash-sub-clause',
    what: 'the em-dash sub-clause restriction in Scope discipline',
    dials: ['full'],
    token: 'em-dash',
    langs: {
      list: ['en'],
      reason:
        'Known drift, kept as a documented exception rather than ported blind: the rule ' +
        'targets an English punctuation habit. Porting it needs a per-language judgement ' +
        'about whether the same padding pattern exists — not a translation.',
    },
    skill: true,
  },
];

export const langsFor = (rule) => (rule.langs === 'all' ? [...VALID_LANGS] : rule.langs.list);
export const tokenFor = (rule, lang) =>
  typeof rule.token === 'string' ? rule.token : rule.token[lang];
