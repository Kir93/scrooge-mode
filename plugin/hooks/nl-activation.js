// nl-activation.js — natural-language activation parser for Scrooge.
//
// Companion to the slash parser (parseCommand in scrooge-activate.js). Where
// parseCommand handles explicit `/scrooge ...` invocations, this reads a plain
// prompt for natural-language intent to turn the mode on or off.
//
// Design constraints — the three reasons core v1 deferred NL activation to the
// growth slice, and how this module answers each:
//   - false-positive risk: a conservative trigger list (the "scrooge" name plus
//     an explicit action cue, or a small set of well-known phrases) combined
//     with a negation guard keeps stray mentions ("스크루지 영화 봤어") from
//     activating.
//   - lang × dial 2-axis difficulty: NL infers only the LANGUAGE axis (from the
//     matched phrase) and always uses dial=full. Precise lite/full tuning stays
//     on the slash path.
//   - G9 deterministic-test contract: this is a pure function — same prompt in,
//     same result out, no I/O and no state — so fixtures cover it exactly like
//     the slash parser.
//
// Return shape is isomorphic to parseCommand's, so the hook can feed it into the
// same set/off branches:
//   { action: 'set', lang, dial: 'full' } | { action: 'off' } | null
// null = no natural-language intent this turn (leave state untouched).
//
// The lean flag is slash-only — NL never sets it. An NL activation therefore
// keeps the session's existing flags, or seeds SCROOGE_DEFAULT_FLAGS on
// a fresh session, via the set-merge default path in scrooge-activate.js.
//
// The cues themselves (activate / off / negate / meta / strong, per language) live
// in LANG_META[lang].nlCue (hooks/lang-meta.js). This parser is now language-agnostic:
// it ORs each cue across every metaLangs() entry, so a new language is detected the
// moment it has a table row — no branch edit here. Splitting the original combined
// regexes per-language is behavior-identical (alternation `A|B` tested as one equals
// `A.test || B.test`; the `/i` flag only ever mattered for the English alternatives).

import { LANG_META, metaLangs } from './lang-meta.js';

// Parse natural-language activation intent from a plain prompt.
export function parseNaturalActivation(prompt) {
  const text = String(prompt || '');
  if (!text) return null;

  const langs = metaLangs();
  const anyCue = (sel) => langs.some((l) => LANG_META[l].nlCue[sel].test(text));

  // Meta-question guard: a prompt that asks ABOUT scrooge mode — its logic, a bug,
  // how it works — names scrooge alongside a question cue but is not a command.
  // Unambiguous style directives (strong) stay activations even with a meta cue.
  if (anyCue('name') && anyCue('meta') && !anyCue('strong')) {
    return null;
  }

  // Negation guard: a negation anywhere in a short prompt cancels an activation or
  // deactivation request. Conservative — when negation is present, prefer a no-op.
  const negated = anyCue('negate');

  // Explicit deactivation — unless negated ("스크루지 끄지 마" / "don't turn off
  // scrooge" / "スクルージやめないで"), where the user wants to KEEP the mode.
  if (anyCue('off')) {
    return negated ? null : { action: 'off' };
  }

  // Activation — first language (table order) whose activate cue matches. Suppressed
  // by the negation guard ("스크루지처럼 말하지 마" / "スクルージみたいにしないで").
  for (const lang of langs) {
    if (LANG_META[lang].nlCue.activate.test(text)) {
      return negated ? null : { action: 'set', lang, dial: 'full' };
    }
  }

  return null;
}
