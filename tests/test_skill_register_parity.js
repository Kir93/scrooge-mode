// Register item parity between `rules/**` and the skill-only surface.
//
// Two shipping surfaces carry the register, and only one was ever tested. Hook
// hosts (Claude Code, Codex) get `rules/{lang}/full.md`; skill-only hosts (Cursor,
// Windsurf, Cline, Continue, Gemini CLI) get `skills/scrooge/SKILL.md` and nothing
// else — `bin/install.js` copies hooks/rules/lib on the Codex path, and
// `.claude-plugin/plugin.json` declares hooks with no skills key. So SKILL.md is
// the whole register for those hosts, and four rule items were missing from it
// while `npm test` stayed green.
//
// The contract is ITEM PRESENCE, not identical wording: SKILL.md is a deliberate
// abridgement (its Boundaries section is 502B against 845-863B in rules) and
// already differs in six substantive ways. Requiring identical text would drag
// unrelated prose into alignment and undo that abridgement.
//
// Item declarations come from the same fixture `test_register_parity.js` reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES, tokenFor } from './fixtures/register-rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = fs.readFileSync(
  path.join(HERE, '..', 'skills', 'scrooge', 'SKILL.md'),
  'utf8'
);

// Which string anchors the item in SKILL.md, or null when the entry is exempt.
const skillTokenFor = (rule) => {
  // `skill: true` reuses the rules token — a shared string, or the `en` entry of a
  // per-language map. No fallback to the raw map: returning the object would be
  // truthy and turn a missing declaration into a search for "[object Object]".
  if (rule.skill === true) {
    const token = tokenFor(rule, 'en');
    return typeof token === 'string' ? token : null;
  }
  if (rule.skill && typeof rule.skill.token === 'string') return rule.skill.token;
  return null;
};

for (const rule of RULES) {
  test(`SKILL.md carries register rule "${rule.id}"`, () => {
    if (rule.skill && typeof rule.skill.exempt === 'string') {
      // Same discipline as a `langs` subset: narrowing coverage requires writing
      // down why, so an exemption cannot be added as a bare opt-out.
      assert.ok(
        rule.skill.exempt.length > 20,
        `${rule.id}: a SKILL.md exemption needs a written reason, not a bare flag`
      );
      return;
    }
    const token = skillTokenFor(rule);
    assert.ok(token, `${rule.id}: no SKILL.md anchor declared (set skill: true / { token } / { exempt })`);
    assert.ok(
      SKILL.includes(token),
      `${rule.id} missing from skills/scrooge/SKILL.md — ${rule.what} (looked for: ${token})`
    );
  });
}

test('an exemption still holds — the rules token has not since landed in SKILL.md', () => {
  // The inverse direction, mirroring `test_register_parity.js`. An exemption is
  // written against SKILL.md as it is; once the item actually appears there the
  // reason on file is stale and the entry should become `skill: true`, not stay
  // opted out. A missing `skill` field is already caught by the per-rule test
  // above (skillTokenFor → null), so this covers what that one cannot see.
  for (const rule of RULES) {
    if (!rule.skill || typeof rule.skill.exempt !== 'string') continue;
    const token = typeof rule.token === 'string' ? rule.token : rule.token.en;
    if (!token) continue;
    assert.ok(
      !SKILL.includes(token),
      `${rule.id} is exempt from SKILL.md but "${token}" now appears there.\nReason on file: ${rule.skill.exempt}`
    );
  }
});
