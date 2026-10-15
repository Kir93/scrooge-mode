// Injection size guard — the largest context a hook ever injects must fit
// Claude Code's additionalContext cap.
//
// Claude Code caps hook additionalContext at 10,000 characters; anything longer is
// replaced by a 2,000-character preview plus a path to the full text on disk
// (code.claude.com/docs/en/hooks). For Scrooge that is a silent failure: the model
// would see a truncated register with most of its rules and the safety clauses
// missing, and nothing in the session says so. Rule files only grow, one clause
// at a time, so the margin erodes without any single edit looking large.
//
// Worst case, per registry language: the `full` register with EVERY valid flag's
// fragment appended (the activation turn injects exactly this), plus the longest
// SessionStart tail — the re-injected rule followed by both the "now ON by
// default" note and the "update available" notice. The notices are not exported,
// so their size is measured from the real hook rather than copied here, where a
// longer notice would go unnoticed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleRuleBody, buildFullInjection } from '../plugin/hooks/scrooge-activate.js';
import {
  VALID_LANGS,
  VALID_FLAGS,
  DEFAULT_ON_FLAGS,
  writeState,
  writeUpdateCache,
  writeVersionMarker,
} from '../plugin/hooks/scrooge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugin');
const SS_HOOK = path.join(PLUGIN_ROOT, 'hooks', 'scrooge-session-start.js');

// Claude Code hook additionalContext limit, in characters. Over it, the host
// substitutes a 2,000-char preview + file path (code.claude.com/docs/en/hooks).
const ADDITIONAL_CONTEXT_CAP = 10000;

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function injection(lang, flags) {
  const body = assembleRuleBody(PLUGIN_ROOT, lang, 'full', flags);
  assert.ok(body, `${lang}/full: assembleRuleBody returned nothing — registry or rule file missing`);
  return buildFullInjection(lang, 'full', body, flags);
}

// Drive the real SessionStart hook into its longest output: an active session
// upgraded from a pre-default-flag release (so the default flags are auto-applied
// with their FYI note) and behind a newer release (so the update notice fires).
function longestSessionStart(lang) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrooge-inj-'));
  tmpDirs.push(dir);
  const sid = 'inj';
  writeState({ lang, dial: 'full', flags: [] }, path.join(dir, '.scrooge', 'sessions', sid));
  writeVersionMarker('0.0.0', path.join(dir, '.scrooge', 'version'));
  // Fresh checkedAt: the once-a-day background refresh is skipped, so no network.
  writeUpdateCache(
    { latest: '999.999.999', checkedAt: Date.now(), behind: true, notifiedVersion: null },
    path.join(dir, '.scrooge', 'update')
  );
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  delete env.CI;
  delete env.SCROOGE_NO_UPDATE_CHECK;
  delete env.SCROOGE_DEFAULT_FLAGS;
  delete env.SCROOGE_AGENT;
  const r = spawnSync(process.execPath, [SS_HOOK], {
    input: JSON.stringify({ session_id: sid, source: 'startup' }),
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  assert.ok(r.stdout.trim(), `${lang}: SessionStart emitted nothing for an active session`);
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

test('registry languages are present to measure', () => {
  // An empty roster would pass every per-language check below by never running one.
  assert.ok(VALID_LANGS.length >= 5, `expected the 5 shipped languages, got ${VALID_LANGS.join(',')}`);
  assert.ok(VALID_FLAGS.length >= 1, 'VALID_FLAGS is empty — the all-flags case would measure the bare register');
});

for (const lang of VALID_LANGS) {
  test(`${lang}: largest injection stays under the ${ADDITIONAL_CONTEXT_CAP}-char additionalContext cap`, () => {
    const ctx = longestSessionStart(lang);
    // Both notices must actually be in the measured output; if a gate stops one
    // from firing here, the overhead below silently drops to zero.
    assert.match(ctx, /now ON by default/, `${lang}: auto-applied flag note did not fire`);
    assert.match(ctx, /newer Scrooge is available/, `${lang}: update notice did not fire`);

    const defaultInjection = injection(lang, DEFAULT_ON_FLAGS);
    assert.ok(ctx.startsWith(defaultInjection), `${lang}: SessionStart output does not start with the rule injection`);
    const noticeOverhead = ctx.length - defaultInjection.length;

    const worst = injection(lang, VALID_FLAGS).length + noticeOverhead;
    assert.ok(
      worst < ADDITIONAL_CONTEXT_CAP,
      `${lang}: worst-case injection is ${worst} chars (all flags + SessionStart notices), ` +
        `over the ${ADDITIONAL_CONTEXT_CAP}-char cap — Claude Code would inject a 2,000-char preview instead`
    );
  });
}
