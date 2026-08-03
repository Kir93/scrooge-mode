// lang-meta.js — per-language activation/UI/NL metadata table + table-driven
// dispatch helpers. The single home for everything that used to be a `ko`/`en`/`ja`
// branch or regex pair scattered across scrooge-activate.js and nl-activation.js.
//
// Why a table: rule *loading* was already registry-driven (registry.json[lang][dial]),
// but the activation surfaces — the per-turn reminder, the off countermand, the flag
// hints, and the natural-language cues — were binary/ternary branches hardcoded to
// ko/en/ja. Adding a 4th/5th language meant editing every branch. Here each language
// is ONE row of data; the dispatch helpers below are language-agnostic, so a new
// language is a table row + a rule file + a registry entry, no hook surgery.
//
// Behavior contract: the ko/en/ja strings and regexes are moved VERBATIM from the
// original hooks (no rewrite), so every reminder/countermand/NL output stays
// byte-identical — the existing fixtures are the regression guard.

// LANG_META — one row per language.
//   reminder: pieces the per-turn reminder is assembled from (see buildReminder).
//   countermand: the off-turn "return to normal prose" line.
//   flagHint: compact per-flag behavior label map (mirrors each fragment heading).
//   savings: measured per-dial output-token compression ratio + its provenance,
//          moved here from the former scrooge-stats.js SAVINGS_RATIO constant so a
//          benchmarked language lives in ONE row (ratio included), not a second
//          parallel table. Per dial: { ratio, results, n, model } — `results` is the
//          backing benchmark file(s), `n` the sample size, `model` the measured model.
//          Every row is derived from a file under benchmarks/published/, so anyone can
//          recompute the ratio: `report.py --input <results> --paired`, then
//          1 − median(scrooge)/median(normal), rounded to 2 decimals. That published
//          derivation is the single source these ratios and the README tables share;
//          tests/test_doc_parity.js asserts the two still agree. (Before this, the
//          ratios were carried forward from an older opus-4-7 run, ko pointed at a
//          file that does not exist, and hi/zh were transposed.) `lite` is absent
//          on purpose and is NOT unmeasured: lite-dial-verification (2026-07-20)
//          measured it and returned NO-GO — lite compresses less than full AND
//          preserves less (ko 0.650 vs full 0.690; en 0.700 vs 0.720), a Pareto
//          loss — so decision D2 option A keeps the dial shipped with no ratio on
//          the product surface, and deriveEstimate returns null for it.
//   nlCue: natural-language activation cues (see parseNaturalActivation in
//          nl-activation.js). Each is the language's slice of the original combined
//          regex; `name`/`meta`/`strong`/`off`/`activate`/`negate` test independently
//          and OR across languages, so splitting the combined patterns per-language
//          is behavior-identical (alternation A|B === A.test || B.test; the /i flag
//          only ever mattered for the Latin-script English alternatives).
export const LANG_META = {
  ko: {
    reminder: {
      head: 'SCROOGE 활성',
      modeClose: '. ',
      lite: '다듬은 존댓말, filler·빈 인사·hedging 드롭, 완전문. ',
      full: '개조식·음슴체(~함/~됨), 의미 명확 시 조사 드롭, 존대 제거. ',
      suffix: 'code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose.',
      flag: { prefix: ' flag: ', sep: '·', suffix: ' 활성.' },
    },
    countermand: 'SCROOGE OFF — 압축 모드 해제. 이번 턴부터 평소 register(일반 문체)로 복귀.',
    flagHint: { lean: 'lean(최소 코드)' },
    savings: {
      full: { ratio: 0.69, results: ['benchmarks/published/results-ko-clean-opus48.jsonl'], n: 21, model: 'claude-opus-4-8' },
    },
    nlCue: {
      name: /스크루지/,
      // Activation triggers: the "scrooge" name plus an explicit action cue. The bare
      // phrases "압축 모드" / "토큰 아껴" are intentionally NOT triggers — without the
      // name they fire on ordinary talk ("이미지 압축 모드로 저장").
      activate: /스크루지\s*(?:처럼|모드|로\s*(?:답|말|얘기|대답)|으로\s*(?:답|말))/,
      // An optional "모드" may sit between the name and the off cue, so "스크루지 모드 꺼"
      // deactivates instead of matching the activation pattern's bare "스크루지 모드".
      off: /스크루지\s*(?:모드\s*)?(?:꺼|끄(?:기|자|줘|는)?|그만|중지|비활성|off)/,
      negate: /지\s*마|지마|말고|말아|마세요|마라|않/,
      meta: /설명|로직|버그|동작|작동|어떻게|원리|의미|무엇|무슨/,
      strong: /스크루지\s*(?:처럼|로\s*(?:답|말|얘기|대답)|으로\s*(?:답|말))/,
    },
  },
  en: {
    reminder: {
      head: 'SCROOGE active',
      modeClose: '. ',
      lite: 'Drop filler/pleasantry/hedging, keep grammar + articles. ',
      full: 'Drop articles/filler/pleasantries, fragments OK, short synonyms. ',
      suffix: 'Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.',
      flag: { prefix: ' Flags: ', sep: ', ', suffix: ' active.' },
    },
    countermand: 'SCROOGE OFF — compression mode deactivated. Return to your normal register from this turn on.',
    flagHint: { lean: 'lean (minimal code)' },
    savings: {
      full: { ratio: 0.66, results: ['benchmarks/published/results-en-clean-opus48.jsonl'], n: 25, model: 'claude-opus-4-8' },
    },
    nlCue: {
      name: /scrooge/i,
      // The "be a token miser" persona stays on the EN side because it names Scrooge
      // unambiguously even without the literal word.
      activate: /\btalk\s+like\s+(?:a\s+)?scrooge\b|\bscrooge\s+mode\b|\bbe\s+(?:a\s+)?token\s+miser\b|\b(?:activate|enable|turn\s+on)\s+scrooge\b/i,
      off: /\b(?:stop|disable|turn\s+off|deactivate)\s+scrooge\b|\bscrooge(?:\s+mode)?\s+off\b/i,
      // Bare "no" is excluded: it appears in benign phrases ("no rush", "no need").
      negate: /\b(?:don'?t|do\s+not|never)\b/i,
      // EN cues are word-bounded so they don't fire on substrings ("how" inside "show").
      meta: /\b(?:explain|logic|bug|debug|how|what|why|mean(?:s|ing)?)\b/i,
      strong: /\btalk\s+like\s+(?:a\s+)?scrooge\b|\bbe\s+(?:a\s+)?token\s+miser\b/i,
    },
  },
  ja: {
    reminder: {
      head: 'SCROOGE 活性',
      modeClose: '。 ',
      lite: '整えた丁寧体、filler・空のあいさつ・hedging ドロップ、完全文。',
      full: '体言止め・常体、意味明確時は助詞ドロップ、敬語除去。',
      suffix: ' code block・error・技術用語は原文。セキュリティ／取り消せない操作は normal prose。',
      flag: { prefix: ' flag: ', sep: '・', suffix: ' 活性。' },
    },
    countermand: 'SCROOGE OFF — 圧縮モード解除。今ターンから通常の register（通常文体）に復帰。',
    flagHint: { lean: 'lean（最小コード）' },
    savings: {
      // Held-out corpus only (integrity-sweep Task 5). The old 0.63 averaged an
      // N=15 tuning run with the held-out one; that tuning corpus is gitignored,
      // so nobody could recompute the average — the README table it backed was
      // dropped for the same reason.
      full: { ratio: 0.64, results: ['benchmarks/published/results-ja-report.jsonl'], n: 11, model: 'claude-opus-4-8' },
    },
    nlCue: {
      name: /スクルージ/,
      // Japanese has no inter-word spaces, so `\b` is inert — the trigger anchors on
      // explicit cue strings after the name (みたいに / モード / で答え…).
      activate: /スクルージ\s*(?:みたいに|のように|っぽく|モード|で\s*(?:答|話|返答))/,
      off: /スクルージ\s*(?:モード\s*)?(?:やめ|止め|停止|オフ|無効|切(?:っ|る)|off)/i,
      negate: /しないで|ないで|するな|しなくて|せず/,
      meta: /説明|ロジック|バグ|仕組み|どうやって|なぜ|どういう/,
      strong: /スクルージ\s*(?:みたいに|のように|っぽく|で\s*(?:答|話|返答))/,
    },
  },
  hi: {
    reminder: {
      head: 'SCROOGE सक्रिय',
      modeClose: '। ',
      lite: 'भद्र आदरसूचक शैली, filler·खाली अभिवादन·hedging ड्रॉप, पूर्ण वाक्य।',
      full: 'संज्ञा-अंत·सामान्य शैली, अर्थ स्पष्ट होने पर परसर्ग ड्रॉप, आदरसूचक हटाना।',
      suffix: ' code block·error·तकनीकी शब्द मूल रूप में। सुरक्षा/अपरिवर्तनीय ऑपरेशन normal prose।',
      flag: { prefix: ' flag: ', sep: '·', suffix: ' सक्रिय।' },
    },
    countermand: 'SCROOGE OFF — संपीड़न मोड बंद। इस turn से सामान्य register (सामान्य शैली) में वापस।',
    flagHint: { lean: 'lean (न्यूनतम कोड)' },
    savings: {
      full: { ratio: 0.63, results: ['benchmarks/published/results-hi-report.jsonl'], n: 11, model: 'claude-opus-4-8' },
    },
    nlCue: {
      name: /स्क्रूज/,
      // Devanagari has spaces, but JS `\b` is ASCII-only and inert on it — the trigger
      // anchors on explicit cue strings after the name (की तरह / जैसे / मोड). Latin
      // "scrooge" input is already caught by the en cue; the hi row owns Devanagari.
      activate: /स्क्रूज\s*(?:की\s*तरह|जैसे|मोड)/,
      off: /स्क्रूज\s*(?:मोड\s*)?(?:बंद|रोक(?:ो)?|हटाओ|अक्षम|निष्क्रिय|off)/i,
      // मत = imperative "don't" (space-anchored so it never fires inside मतलब etc.).
      // नहीं (bare declarative "no") is intentionally excluded, like the en bare-"no".
      negate: /(?:^|\s)मत(?:\s|$)/,
      meta: /समझा|क्या|कैसे|क्यों|बग|मतलब|तर्क|लॉजिक|काम\s*कर/,
      strong: /स्क्रूज\s*(?:की\s*तरह|जैसे)/,
    },
  },
  zh: {
    reminder: {
      head: 'SCROOGE 已激活',
      modeClose: '。 ',
      lite: '礼貌得体、filler·空客套·hedging 删除,完整句。',
      full: '名词短语结尾·平语,义明时删冗余结构助词·量词,礼貌层·filler 删除。',
      suffix: ' code block·error·技术词原形。安全/不可逆操作用 normal prose。',
      flag: { prefix: ' flag: ', sep: '·', suffix: ' 已激活。' },
    },
    countermand: 'SCROOGE OFF — 压缩模式解除。本回合起回到日常 register(常规文体)。',
    flagHint: { lean: 'lean(最小代码)' },
    savings: {
      full: { ratio: 0.67, results: ['benchmarks/published/results-zh-report.jsonl'], n: 11, model: 'claude-opus-4-8' },
    },
    nlCue: {
      name: /斯克鲁奇/,
      // Chinese has no inter-word spaces, so JS `\b` is inert — the trigger anchors on
      // explicit cue strings around the name (一样 / 那样 / 模式 / 来答…). Latin "scrooge"
      // input is already caught by the en cue; the zh row owns the 斯克鲁奇 transliteration.
      activate: /斯克鲁奇\s*(?:一样|那样|模式|风格|来\s*(?:答|回答|说|讲))/,
      // Order-flexible: Chinese puts the off verb after the name (斯克鲁奇关闭) OR before
      // it (关闭斯克鲁奇), unlike the KO/JA name-then-cue order — so both orders match.
      off: /斯克鲁奇\s*(?:模式\s*)?(?:关闭|关掉|停止|停用|禁用|退出|off)|(?:关闭|关掉|停止|停用|禁用|退出)\s*斯克鲁奇/i,
      // 别+verb / 不要 are the imperative "don't"; bare 别 is avoided — it rides inside
      // benign words (识别/级别/特别), the same bare-"no" trap the en/hi rows dodge.
      negate: /不要|别\s*(?:像|用|开|启|激活|启用|回答|答|说|讲|关|停|切换)/,
      meta: /解释|说明|逻辑|bug|调试|怎么|如何|什么|为什么|为何|意思|含义|原理|运作|工作原理/i,
      strong: /斯克鲁奇\s*(?:一样|那样|风格|来\s*(?:答|回答|说|讲))/,
    },
  },
};

// Language lookup. Returns the row, or null for an unknown language (callers below
// degrade to a safe fallback rather than crashing on a registry lang with no meta).
export function langMeta(lang) {
  return LANG_META[lang] || null;
}

// Languages that carry activation metadata, in table order (= ko, en, ja). The NL
// parser and any future N-ary dispatch iterate this, so a new table row joins the
// dispatch automatically; appended rows (e.g. a test-injected `xx`) get lowest
// priority and never disturb the ko→en→ja precedence.
export function metaLangs() {
  return Object.keys(LANG_META);
}

// Measured savings entry { ratio, results, n, model } for a (lang, dial), or null
// when the pair has no benchmark (any lite dial today, or a lang with no savings row).
// deriveEstimate reads `.ratio` from this; the doc-parity provenance guard reads the
// whole entry. Replaces the removed scrooge-stats.js SAVINGS_RATIO constant.
export function savingsMeta(lang, dial) {
  const s = LANG_META[lang] && LANG_META[lang].savings;
  return (s && s[dial]) || null;
}

// Compact per-flag behavior labels for the active language; an unmapped flag (or a
// language with no flagHint map) degrades to the bare flag name.
export function flagHints(lang, flags) {
  const map = (LANG_META[lang] && LANG_META[lang].flagHint) || {};
  return flags.map((f) => map[f] || f);
}

// Per-turn reminder (the high-frequency injection). Assembled language-agnostically
// from the table row: `{head} ({label}/{dial}){modeClose}{body}{suffix}{flagClause}`.
// An unknown language (no table row — guarded against by test_registry_parity, so
// unreachable for a real registry lang) falls back to the en row, label and all,
// exactly matching the original hook's en fallthrough (which hardcoded "en" in the
// header). For ko/en/ja the label IS the lang, so output stays byte-identical.
export function buildReminder(lang, dial, flags = []) {
  // For an unknown lang, every piece — body, suffix, flag hints, AND the header label
  // — comes from the en row, matching the original en fallthrough exactly.
  const effLang = LANG_META[lang] ? lang : 'en';
  const r = LANG_META[effLang].reminder;
  const flagClause = flags.length
    ? `${r.flag.prefix}${flagHints(effLang, flags).join(r.flag.sep)}${r.flag.suffix}`
    : '';
  return `${r.head} (${effLang}/${dial})${r.modeClose}${r[dial]}${r.suffix}${flagClause}`;
}

// Deactivation countermand, localized to the register that was active when off fired.
// Unknown language falls back to the en line (matches the original hook).
export function buildCountermand(lang) {
  return (LANG_META[lang] || LANG_META.en).countermand;
}
