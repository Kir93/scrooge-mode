// Docs / prose-artifact compression boundary — presence across every dial.
//
// doc-compression spec SC4 scopes this check to the existence level: rule
// bodies are LLM instructions, not unit-testable behavior. This asserts the
// Docs/prose ## Boundaries item AND the Docs-escape ## Auto-Clarity extension
// are PRESENT in each of the 4 rule files. It is a per-file test, so dropping
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry.json'), 'utf8'));

// The Docs/prose Boundaries item names this marker, per language.
const DOCS_BOUNDARY = {
  en: /Docs \/ prose artifacts/,
  ko: /Docs·prose 산출물/,
  ja: /Docs·prose 生成物/,
  hi: /Docs·prose सामग्री/,
};

// The docs-escape extension lives in Auto-Clarity for every dial (both langs
// use the literal "Docs escape" label).
const DOCS_ESCAPE = /Docs escape/;

// Every lang × dial rule file carries the docs-compression boundary + escape.
for (const lang of ['ko', 'en', 'ja', 'hi']) {
  for (const dial of ['lite', 'full']) {
    test(`rule ${lang}/${dial} carries the Docs/prose compression boundary + escape`, () => {
      const body = fs.readFileSync(path.join(REPO_ROOT, REGISTRY[lang][dial]), 'utf8');
      assert.match(body, /## Boundaries/, 'missing Boundaries heading');
      assert.match(body, DOCS_BOUNDARY[lang], 'missing Docs/prose boundary item');
      assert.match(body, DOCS_ESCAPE, 'missing Docs escape (Auto-Clarity extension)');
    });
  }
}
