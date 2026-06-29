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

// Activation triggers: the "scrooge" name plus an explicit action cue. The bare
// phrases "압축 모드" / "토큰 아껴" are intentionally NOT triggers — without the
// name they fire on ordinary talk ("이미지 압축 모드로 저장", "API 토큰 아껴 쓰자"),
// the exact false-positive class core v1 deferred NL over. The "be a token miser"
// persona stays on the EN side because it names Scrooge unambiguously.
const KO_ACTIVATE =
  /스크루지\s*(?:처럼|모드|로\s*(?:답|말|얘기|대답)|으로\s*(?:답|말))/;
const EN_ACTIVATE =
  /\btalk\s+like\s+(?:a\s+)?scrooge\b|\bscrooge\s+mode\b|\bbe\s+(?:a\s+)?token\s+miser\b|\b(?:activate|enable|turn\s+on)\s+scrooge\b/i;
// Japanese has no inter-word spaces, so `\b` is inert — the trigger anchors on
// explicit cue strings after the name (みたいに / モード / で答え…) instead of a
// word boundary. Mirrors KO_ACTIVATE's "name + action cue" shape.
const JA_ACTIVATE =
  /スクルージ\s*(?:みたいに|のように|っぽく|モード|で\s*(?:答|話|返答))/;

// Explicit deactivation intent. An optional "모드"/"mode" may sit between the
// name and the off cue, so "스크루지 모드 꺼" / "scrooge mode off" deactivate
// instead of matching the activation pattern's bare "스크루지 모드"/"scrooge mode".
const KO_OFF =
  /스크루지\s*(?:모드\s*)?(?:꺼|끄(?:기|자|줘|는)?|그만|중지|비활성|off)/;
const EN_OFF = /\b(?:stop|disable|turn\s+off|deactivate)\s+scrooge\b|\bscrooge(?:\s+mode)?\s+off\b/i;
const JA_OFF =
  /スクルージ\s*(?:モード\s*)?(?:やめ|止め|停止|オフ|無効|切(?:っ|る)|off)/i;

// Negation guard: a negation anywhere in a short prompt cancels an activation
// (or deactivation) request. Conservative by design — when negation is present
// we prefer a no-op over a wrong state change.
// Bare "no" is excluded: it appears in benign phrases ("no rush", "no need")
// that don't negate the activation intent, so matching it here silently
// no-op'd legitimate requests. don't / do not / never are kept.
const KO_NEGATE = /지\s*마|지마|말고|말아|마세요|마라|않/;
const EN_NEGATE = /\b(?:don'?t|do\s+not|never)\b/i;
// Japanese negation: 〜しないで / 〜ないで / 〜するな / 〜せず. "スクルージみたいに
// しないで" (don't answer like scrooge) and "スクルージやめないで" (don't turn it
// off → keep it) both no-op via the shared negation guard.
const JA_NEGATE = /しないで|ないで|するな|しなくて|せず/;

// Meta-question guard: a prompt that asks ABOUT scrooge mode — its logic, a bug,
// how it works — names scrooge alongside a question cue but is not a command.
// "스크루지 모드 끄는 로직 설명해줘" / "explain scrooge mode off" / "스크루지 모드 버그"
// previously toggled the mode; here they are suppressed (no-op). The cue list is
// kept disjoint from the activation/off phrases so it never cancels a real command
// (답/부탁/꺼/끄기/enable/off carry no meta cue). EN cues are word-bounded so they
// don't fire on substrings ("how" inside "show").
const SCROOGE_NAME = /스크루지|scrooge|スクルージ/i;
const META_CUE =
  /설명|로직|버그|동작|작동|어떻게|원리|의미|무엇|무슨|説明|ロジック|バグ|仕組み|どうやって|なぜ|どういう|\b(?:explain|logic|bug|debug|how|what|why|mean(?:s|ing)?)\b/i;
// Unambiguous style directives stay activations even when a meta cue is present:
// "스크루지처럼 설명해줘" / "talk like scrooge and explain this" want the ANSWER in
// scrooge style, so they are exempt from the meta guard (avoids the false-negative
// of suppressing a genuine activation).
const STRONG_STYLE =
  /스크루지\s*(?:처럼|로\s*(?:답|말|얘기|대답)|으로\s*(?:답|말))|スクルージ\s*(?:みたいに|のように|っぽく|で\s*(?:答|話|返答))|\btalk\s+like\s+(?:a\s+)?scrooge\b|\bbe\s+(?:a\s+)?token\s+miser\b/i;

// Parse natural-language activation intent from a plain prompt.
export function parseNaturalActivation(prompt) {
  const text = String(prompt || '');
  if (!text) return null;

  // A meta-question about scrooge mode is neither activation nor deactivation.
  if (SCROOGE_NAME.test(text) && META_CUE.test(text) && !STRONG_STYLE.test(text)) {
    return null;
  }

  const koOff = KO_OFF.test(text);
  const enOff = EN_OFF.test(text);
  const jaOff = JA_OFF.test(text);
  const koActivate = KO_ACTIVATE.test(text);
  const enActivate = EN_ACTIVATE.test(text);
  const jaActivate = JA_ACTIVATE.test(text);
  const negated = KO_NEGATE.test(text) || EN_NEGATE.test(text) || JA_NEGATE.test(text);

  // Explicit deactivation — unless negated ("스크루지 끄지 마" / "don't turn off
  // scrooge" / "スクルージやめないで"), where the user wants to KEEP the mode, so
  // leave state untouched.
  if (koOff || enOff || jaOff) {
    return negated ? null : { action: 'off' };
  }

  // Activation — suppressed by the negation guard ("스크루지처럼 말하지 마" /
  // "スクルージみたいにしないで").
  if (koActivate || enActivate || jaActivate) {
    if (negated) return null;
    return {
      action: 'set',
      lang: koActivate ? 'ko' : enActivate ? 'en' : 'ja',
      dial: 'full',
    };
  }

  return null;
}
