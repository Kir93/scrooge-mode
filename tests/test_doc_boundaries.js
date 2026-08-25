// Docs / prose-artifact compression boundary — presence across every dial.
//
// doc-compression spec SC4 scopes this check to the existence level: rule
// bodies are LLM instructions, not unit-testable behavior. This asserts the
// Docs/prose ## Boundaries item AND the Docs-escape ## Auto-Clarity extension
// are PRESENT in each rule file. It is a per-file test, so dropping
// the item from any single file fails only that file's test (catches an
// omission/drop). It does NOT verify the bodies carry the same MEANING across
// ko↔en / lite↔full — that semantic parity stays a review-time concern.
// Complements test_safety_escape.js, which covers the safety Auto-Clarity
// escape but not the docs-compression boundary.
//
// "Docs escape" and the en "Docs / prose artifacts" label are intentional
// verbatim English anchors — same as the English "Code, commit messages, PR
// descriptions" Boundaries bullet, which is English even in the ko files. The
// ko regex anchors the Korean marker "Docs·prose 산출물".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_LANGS, VALID_DIALS } from '../hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry.json'), 'utf8'));

// The Docs/prose Boundaries item names this marker, per language.
const DOCS_BOUNDARY = {
  en: /Docs \/ prose artifacts/,
  ko: /Docs·prose 산출물/,
  ja: /Docs·prose 生成物/,
  hi: /Docs·prose सामग्री/,
  zh: /Docs·prose 产物/,
};

// The docs-escape extension lives in Auto-Clarity for every dial (both langs
// use the literal "Docs escape" label).
const DOCS_ESCAPE = /Docs escape/;

// The Docs/prose class explicitly covers outbound drafts — text the user sends
// onward. That clause is the whole point of the class boundary (the alternative,
// a separate Outbound class, was measured and rejected), and it is stated in each
// language's own words, so it needs its own per-language anchor: the shared
// `Docs·prose` marker above matches with or without it.
const OUTBOUND_DRAFTS = {
  en: /Slack, DM, announcements, email/,
  ko: /Slack·DM·공지·메일/,
  ja: /Slack・DM・アナウンス・メール/,
  hi: /Slack·DM·घोषणा·email/,
  zh: /Slack·DM·公告·邮件/,
};

// The other half of the same contract: what is PERMANENTLY excluded. All five
// registers name the item with the same English literal (the label is English
// even in the KO/JA/HI/ZH bodies), so one pattern anchors every language.
// `tests/test_doc_parity.js` section (I) mirrors these strings into the README
// Surface row, so the row cannot outlive a change to the exclusion list.
const DOCS_EXCLUSION = /\*\*Code, commit messages, PR descriptions\*\*/;

// Every lang × dial rule file carries the docs-compression boundary + escape. The
// loop is registry-derived (VALID_LANGS) so a new language is covered automatically;
// the per-lang DOCS_BOUNDARY map is hand-maintained data, so a registry lang missing
// from it fails clearly (assert) instead of matching against `undefined`.
for (const lang of VALID_LANGS) {
  for (const dial of VALID_DIALS) {
    test(`rule ${lang}/${dial} carries the Docs/prose compression boundary + escape`, () => {
      const boundary = DOCS_BOUNDARY[lang];
      assert.ok(boundary, `no DOCS_BOUNDARY entry for '${lang}' — add its Docs/prose boundary marker`);
      const body = fs.readFileSync(path.join(REPO_ROOT, REGISTRY[lang][dial]), 'utf8');
      assert.match(body, /## Boundaries/, 'missing Boundaries heading');
      assert.match(body, boundary, 'missing Docs/prose boundary item');
      assert.match(body, DOCS_EXCLUSION, 'missing the permanently-excluded item (code / commit messages / PR descriptions)');
      const outbound = OUTBOUND_DRAFTS[lang];
      assert.ok(outbound, `no OUTBOUND_DRAFTS entry for '${lang}' — add its outbound-draft marker`);
      assert.match(body, outbound, 'Docs/prose item no longer names outbound drafts');
      assert.match(body, DOCS_ESCAPE, 'missing Docs escape (Auto-Clarity extension)');
    });
  }
}
