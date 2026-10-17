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
//   stats: /scrooge-stats report, --share line, statusline suffix, and run-failure
//          strings, rendered in the active register's language. `{name}` slots are
//          filled by scrooge-stats.js. Every estimate-derived string carries the
//          row's `note.est` marker — the "(est)" honesty label survives translation
//          (tests/test_honest_bill.js asserts it per row).
//   savings: measured per-dial output-token compression ratio + its provenance,
//          moved here from the former scrooge-stats.js SAVINGS_RATIO constant so a
//          benchmarked language lives in ONE row (ratio included), not a second
//          parallel table. Per dial: { ratio, results, n, model } — `results` is the
//          backing benchmark file(s), `n` the sample size, `model` the measured model.
//          Every row is derived from a file under benchmarks/published/, so anyone can
//          recompute the ratio: `report.py --input <results> --paired --drop-tool-rows`,
//          then 1 − median(scrooge)/median(normal) on the unsuffixed `scrooge:<lang>/full`
//          arm (the v027 files also carry a same-run `@v0.26.0` arm), rounded to 2
//          decimals. Rows are the claude-opus-5-5 held-out run (register v0.27.0); the
//          earlier claude-opus-4-8 ratios (ko .69 en .67 ja .65 hi .63 zh .67) were
//          retired when the README headline moved to the same files. That published
//          derivation is the single source these ratios and the README tables share;
//          tests/test_doc_parity.js asserts the two still agree. (Before this, the
//          ratios were carried forward from an older opus-4-7 run, ko pointed at a
//          file that does not exist, and hi/zh were transposed.) `lite` is absent
//          on purpose and is NOT unmeasured: lite-dial-verification (2026-07-20)
//          measured it and returned NO-GO — lite compresses less than full AND
//          preserves less (ko 0.650 vs full 0.690; en 0.700 vs 0.720), a Pareto
//          loss — so the dial was retired in v0.23.0 (scrooge-config.js
//          RETIRED_DIALS migrates saved `lite` state to `full`).
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
      full: '개조식·음슴체(~함/~됨), 의미 명확 시 조사 드롭, 존대 제거. ',
      suffix: 'code block·error·기술 용어 원문. 보안/되돌릴 수 없는 동작은 normal prose.',
      flag: { prefix: ' flag: ', sep: '·', suffix: ' 활성.' },
    },
    countermand: 'SCROOGE OFF — 압축 모드 해제. 이번 턴부터 평소 register(일반 문체)로 복귀.',
    flagHint: { lean: 'lean(최소 코드)' },
    stats: {
      title: 'Scrooge 통계',
      noTurns: '아직 대화 없음 — 첫 응답 후 통계 표시.',
      session: '세션',
      mode: '모드',
      turns: '턴',
      input: '입력 토큰',
      output: '출력 토큰',
      cacheRead: '캐시 읽기 토큰',
      estNormal: 'scrooge 미사용 추정',
      estSaved: '절약 토큰 추정',
      overhead: '자체 오버헤드 (입력)',
      footer: '추정 근거: benchmarks/ (dial별 평균, {mode}). prose 출력에만 적용 — tool_use 출력 제외. 절약량은 반사실 추정.',
      lifetime: '누적',
      since: '{since} 이후',
      ledger: '원장',
      unreadable: '사용 불가 — history 파일 읽기 실패 (크기 상한 초과 추정).\n누적 재개하려면 {path} 정리 또는 이동.',
      sessions: '세션 수',
      savedOut: '절약 출력 토큰',
      overheadTotal: '자체 오버헤드',
      net: '순 절약 토큰',
      reasoningTotal: '추론 토큰',
      usd: '절약 금액 추정',
      sinceActivation: '활성화 이후',
      note: {
        est: '추정',
        measured: '측정',
        uncompressed: '비압축',
        proseBasis: 'prose만 기준',
        pctEst: '~{pct}%, 추정',
        staticCtx: '추정, 정적 rule 컨텍스트',
        estProse: '추정, prose만',
        notSaving: '비압축, 절약 아님',
        estNet: '추정, 순액',
        estimateBasis: '추정 기준',
      },
      shareNoTurns: '💰 scrooge 대기 중, 아직 턴 없음',
      shareSaved: '💰 이번 세션 {turns}턴 동안 prose 출력 토큰 ~{saved} 절약 (추정)',
      shareRaw: '💰 이번 세션 {turns}턴, 출력 토큰 {output}',
      suffixSaved: '⛏ ~{saved} 절약 (추정)',
      runFailed: 'scrooge-stats: 실행 실패 — node hooks/scrooge-stats.js 수동 실행.',
    },
    savings: {
      full: { ratio: 0.60, results: ['benchmarks/published/results-ko-report-v027.jsonl'], n: 19, model: 'claude-opus-5-5' },
    },
    nlCue: {
      name: /스크루지/,
      // Activation triggers: the "scrooge" name plus an explicit action cue. The bare
      // phrases "압축 모드" / "토큰 아껴" are intentionally NOT triggers — without the
      // name they fire on ordinary talk ("이미지 압축 모드로 저장"). The bare mode noun
      // ("스크루지 모드") is a topic as often as a request ("README의 스크루지 모드 섹션
      // 다듬어줘"), so it activates only as the whole prompt, optionally with an on/use/
      // please word (켜 줘 / 로 해줘 / 써줘); verb forms (처럼 / 모드로 답해 / 모드로 전환…)
      // match anywhere.
      activate: /스크루지\s*(?:처럼|(?:모드\s*)?로\s*(?:답|말|얘기|대답)|으로\s*(?:답|말))|^스크루지\s*모드\s*(?:로\s*)?(?:전환(?:\s*해\s*(?:줘요|줘|주세요))?|켜\s*(?:줘요|줘|요|기|자)?|해\s*(?:줘요|줘|주세요)|써\s*(?:줘요|줘)|on|부탁(?:해요|해|합니다|드려요)?)?\s*[.!~]*$/i,
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
      full: 'Drop articles/filler/pleasantries, fragments OK, short synonyms. ',
      suffix: 'Code blocks, errors, technical terms verbatim. Security / irreversible actions: normal prose.',
      flag: { prefix: ' Flags: ', sep: ', ', suffix: ' active.' },
    },
    countermand: 'SCROOGE OFF — compression mode deactivated. Return to your normal register from this turn on.',
    flagHint: { lean: 'lean (minimal code)' },
    stats: {
      title: 'Scrooge Stats',
      noTurns: 'No conversation yet — stats available after the first response.',
      session: 'Session',
      mode: 'Mode',
      turns: 'Turns',
      input: 'Input tokens',
      output: 'Output tokens',
      cacheRead: 'Cache-read tokens',
      estNormal: 'Est. without scrooge',
      estSaved: 'Est. tokens saved',
      overhead: 'Self overhead (input)',
      footer: 'Estimate from benchmarks/ (mean per-dial, {mode}); applied to prose output only — tool_use output excluded. Savings are counterfactual.',
      lifetime: 'Lifetime',
      since: 'Since {since}',
      ledger: 'ledger',
      unreadable: 'unavailable — history file could not be read (likely over the size cap).\nTrim or move {path} to resume accumulating.',
      sessions: 'Sessions',
      savedOut: 'Output tokens saved',
      overheadTotal: 'Self overhead',
      net: 'Net tokens saved',
      reasoningTotal: 'Reasoning tokens',
      usd: 'Est. value saved',
      sinceActivation: 'since activation',
      note: {
        est: 'est',
        measured: 'measured',
        uncompressed: 'uncompressed',
        proseBasis: 'prose-only basis',
        pctEst: '~{pct}%, est',
        staticCtx: 'est, static rule ctx',
        estProse: 'est, prose-only',
        notSaving: 'uncompressed, not a saving',
        estNet: 'est, net',
        estimateBasis: 'estimate basis',
      },
      shareNoTurns: '💰 scrooge armed, no turns yet',
      shareSaved: '💰 saved ~{saved} prose output tokens (est) across {turns} turns this session',
      shareRaw: '💰 {turns} turns, {output} output tokens this session',
      suffixSaved: '⛏ ~{saved} saved (est)',
      runFailed: 'scrooge-stats: run failed — run node hooks/scrooge-stats.js manually.',
    },
    savings: {
      full: { ratio: 0.55, results: ['benchmarks/published/results-en-report-v027.jsonl'], n: 19, model: 'claude-opus-5-5' },
    },
    nlCue: {
      name: /scrooge/i,
      // The "be a token miser" persona stays on the EN side because it names Scrooge
      // unambiguously even without the literal word. The bare "scrooge mode" noun is a
      // topic as often as a request ("update the scrooge mode section"), so it activates
      // only as the whole prompt (optionally + use/on/now/please); verb forms (activate /
      // enable / turn on / switch to scrooge) match anywhere.
      activate: /\btalk\s+like\s+(?:a\s+)?scrooge\b|\bbe\s+(?:a\s+)?token\s+miser\b|\b(?:activate|enable|turn\s+on)\s+scrooge\b|^(?:please\s+)?(?:use\s+|switch\s+to\s+)?scrooge\s+mode(?:\s+(?:on|now))?(?:\s*,?\s*please)?\s*[.!]*$/i,
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
      full: '体言止め・常体、意味明確時は助詞ドロップ、敬語除去。',
      suffix: ' code block・error・技術用語は原文。セキュリティ／取り消せない操作は normal prose。',
      flag: { prefix: ' flag: ', sep: '・', suffix: ' 活性。' },
    },
    countermand: 'SCROOGE OFF — 圧縮モード解除。今ターンから通常の register（通常文体）に復帰。',
    flagHint: { lean: 'lean（最小コード）' },
    stats: {
      title: 'Scrooge 統計',
      noTurns: 'まだ会話なし — 最初の応答後に統計を表示。',
      session: 'セッション',
      mode: 'モード',
      turns: 'ターン',
      input: '入力トークン',
      output: '出力トークン',
      cacheRead: 'キャッシュ読取トークン',
      estNormal: 'scrooge なし推定',
      estSaved: '節約トークン推定',
      overhead: '自己オーバーヘッド (入力)',
      footer: 'benchmarks/ に基づく推定 (dial 別平均, {mode})。prose 出力にのみ適用 — tool_use 出力は除外。節約量は反実仮想の推定。',
      lifetime: '累計',
      since: '{since} 以降',
      ledger: '台帳',
      unreadable: '利用不可 — history ファイルを読めない (サイズ上限超過の可能性)。\n累計を再開するには {path} を整理または移動。',
      sessions: 'セッション数',
      savedOut: '節約出力トークン',
      overheadTotal: '自己オーバーヘッド',
      net: '正味節約トークン',
      reasoningTotal: '推論トークン',
      usd: '節約額推定',
      sinceActivation: '有効化以降',
      note: {
        est: '推定',
        measured: '実測',
        uncompressed: '非圧縮',
        proseBasis: 'prose のみ基準',
        pctEst: '~{pct}%, 推定',
        staticCtx: '推定, 静的 rule コンテキスト',
        estProse: '推定, prose のみ',
        notSaving: '非圧縮, 節約ではない',
        estNet: '推定, 正味',
        estimateBasis: '推定基準',
      },
      shareNoTurns: '💰 scrooge 待機中、まだターンなし',
      shareSaved: '💰 このセッション {turns} ターンで prose 出力トークン ~{saved} 節約 (推定)',
      shareRaw: '💰 このセッション {turns} ターン、出力トークン {output}',
      suffixSaved: '⛏ ~{saved} 節約 (推定)',
      runFailed: 'scrooge-stats: 実行失敗 — node hooks/scrooge-stats.js を手動実行。',
    },
    savings: {
      full: { ratio: 0.62, results: ['benchmarks/published/results-ja-report-v027.jsonl'], n: 11, model: 'claude-opus-5-5' },
    },
    nlCue: {
      name: /スクルージ/,
      // Japanese has no inter-word spaces, so `\b` is inert — the trigger anchors on
      // explicit cue strings after the name (みたいに / モードで答え…). The bare モード noun
      // activates only as the whole prompt (optionally + オン/で/お願い) — inside a request
      // ("READMEのスクルージモードの節を直して") it is a topic, not a command.
      activate: /スクルージ\s*(?:みたいに|のように|っぽく|(?:モード\s*)?で\s*(?:答|話|返答))|^スクルージ\s*モード\s*(?:を?\s*(?:オン|on)(?:\s*に(?:して)?)?|で(?:\s*お願い(?:します)?)?|お願い(?:します)?)?\s*[。！!]*$/i,
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
      full: 'संज्ञा-अंत·सामान्य शैली, अर्थ स्पष्ट होने पर परसर्ग ड्रॉप, आदरसूचक हटाना।',
      suffix: ' code block·error·तकनीकी शब्द मूल रूप में। सुरक्षा/अपरिवर्तनीय ऑपरेशन normal prose।',
      flag: { prefix: ' flag: ', sep: '·', suffix: ' सक्रिय।' },
    },
    countermand: 'SCROOGE OFF — संपीड़न मोड बंद। इस turn से सामान्य register (सामान्य शैली) में वापस।',
    flagHint: { lean: 'lean (न्यूनतम कोड)' },
    stats: {
      title: 'Scrooge आँकड़े',
      noTurns: 'अभी कोई बातचीत नहीं — पहले जवाब के बाद आँकड़े उपलब्ध।',
      session: 'सत्र',
      mode: 'मोड',
      turns: 'टर्न',
      input: 'इनपुट टोकन',
      output: 'आउटपुट टोकन',
      cacheRead: 'कैश-रीड टोकन',
      estNormal: 'scrooge के बिना अनुमान',
      estSaved: 'बचे टोकन अनुमान',
      overhead: 'स्व-ओवरहेड (इनपुट)',
      footer: 'अनुमान benchmarks/ से (dial-वार औसत, {mode}); केवल prose आउटपुट पर लागू — tool_use आउटपुट शामिल नहीं। बचत प्रतितथ्यात्मक अनुमान है।',
      lifetime: 'कुल',
      since: '{since} से',
      ledger: 'लेजर',
      unreadable: 'अनुपलब्ध — history फ़ाइल पढ़ी नहीं जा सकी (संभवतः आकार सीमा से अधिक)।\nसंचय फिर शुरू करने के लिए {path} को छोटा करें या हटाएँ।',
      sessions: 'सत्र संख्या',
      savedOut: 'बचे आउटपुट टोकन',
      overheadTotal: 'स्व-ओवरहेड',
      net: 'शुद्ध बचे टोकन',
      reasoningTotal: 'रीज़निंग टोकन',
      usd: 'बचत मूल्य अनुमान',
      sinceActivation: 'सक्रियण के बाद',
      note: {
        est: 'अनुमान',
        measured: 'मापा गया',
        uncompressed: 'असंपीड़ित',
        proseBasis: 'केवल prose आधार',
        pctEst: '~{pct}%, अनुमान',
        staticCtx: 'अनुमान, स्थिर rule संदर्भ',
        estProse: 'अनुमान, केवल prose',
        notSaving: 'असंपीड़ित, बचत नहीं',
        estNet: 'अनुमान, शुद्ध',
        estimateBasis: 'अनुमान आधार',
      },
      shareNoTurns: '💰 scrooge तैयार, अभी कोई टर्न नहीं',
      shareSaved: '💰 इस सत्र में {turns} टर्न में ~{saved} prose आउटपुट टोकन बचे (अनुमान)',
      shareRaw: '💰 इस सत्र में {turns} टर्न, {output} आउटपुट टोकन',
      suffixSaved: '⛏ ~{saved} बचत (अनुमान)',
      runFailed: 'scrooge-stats: चलाना विफल — node hooks/scrooge-stats.js मैन्युअल रूप से चलाएँ।',
    },
    savings: {
      full: { ratio: 0.63, results: ['benchmarks/published/results-hi-report-v027.jsonl'], n: 11, model: 'claude-opus-5-5' },
    },
    nlCue: {
      name: /स्क्रूज/,
      // Devanagari has spaces, but JS `\b` is ASCII-only and inert on it — the trigger
      // anchors on explicit cue strings after the name (की तरह / जैसे / मोड में जवाब). The
      // bare मोड noun activates only as the whole prompt (optionally + चालू/please) —
      // inside a request it is a topic. Latin "scrooge" input is already caught by the
      // en cue; the hi row owns Devanagari.
      activate: /स्क्रूज\s*(?:की\s*तरह|जैसे|मोड\s*में\s*(?:जवाब|बात|बोल))|^(?:कृपया\s*)?स्क्रूज\s*मोड\s*(?:(?:चालू|ऑन)(?:\s*करो)?|on|please|कृपया)?\s*[।!.]*$/i,
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
      full: '名词短语结尾·平语,义明时删冗余结构助词·量词,礼貌层·filler 删除。',
      suffix: ' code block·error·技术词原形。安全/不可逆操作用 normal prose。',
      flag: { prefix: ' flag: ', sep: '·', suffix: ' 已激活。' },
    },
    countermand: 'SCROOGE OFF — 压缩模式解除。本回合起回到日常 register(常规文体)。',
    flagHint: { lean: 'lean(最小代码)' },
    stats: {
      title: 'Scrooge 统计',
      noTurns: '尚无对话 — 首次回复后显示统计。',
      session: '会话',
      mode: '模式',
      turns: '轮次',
      input: '输入 token',
      output: '输出 token',
      cacheRead: '缓存读取 token',
      estNormal: '无 scrooge 估算',
      estSaved: '节省 token 估算',
      overhead: '自身开销 (输入)',
      footer: '估算来自 benchmarks/ (按 dial 平均, {mode});仅用于 prose 输出 — 不含 tool_use 输出。节省量为反事实估算。',
      lifetime: '累计',
      since: '{since} 以来',
      ledger: '账本',
      unreadable: '不可用 — 无法读取 history 文件 (可能超出大小上限)。\n整理或移走 {path} 以恢复累计。',
      sessions: '会话数',
      savedOut: '节省输出 token',
      overheadTotal: '自身开销',
      net: '净节省 token',
      reasoningTotal: '推理 token',
      usd: '节省金额估算',
      sinceActivation: '激活以来',
      note: {
        est: '估算',
        measured: '实测',
        uncompressed: '未压缩',
        proseBasis: '仅 prose 基准',
        pctEst: '~{pct}%, 估算',
        staticCtx: '估算, 静态 rule 上下文',
        estProse: '估算, 仅 prose',
        notSaving: '未压缩, 不计节省',
        estNet: '估算, 净值',
        estimateBasis: '估算基准',
      },
      shareNoTurns: '💰 scrooge 已就绪, 尚无轮次',
      shareSaved: '💰 本会话 {turns} 轮节省 ~{saved} prose 输出 token (估算)',
      shareRaw: '💰 本会话 {turns} 轮, 输出 token {output}',
      suffixSaved: '⛏ 节省 ~{saved} (估算)',
      runFailed: 'scrooge-stats: 运行失败 — 请手动运行 node hooks/scrooge-stats.js。',
    },
    savings: {
      // n=10: --drop-tool-rows drops one tool-using key (N=11 without it reads +62.5%).
      full: { ratio: 0.65, results: ['benchmarks/published/results-zh-report-v027.jsonl'], n: 10, model: 'claude-opus-5-5' },
    },
    nlCue: {
      name: /斯克鲁奇/,
      // Chinese has no inter-word spaces, so JS `\b` is inert — the trigger anchors on
      // explicit cue strings around the name (一样 / 那样 / 风格 / 模式回答 / 来答…). The bare
      // 模式 noun activates only as the whole prompt (optionally + 请/开启/吧) — inside a
      // request it is a topic. Latin "scrooge" input is already caught by the en cue; the
      // zh row owns the 斯克鲁奇 transliteration.
      activate: /斯克鲁奇\s*(?:一样|那样|风格|(?:模式\s*)?来\s*(?:答|回答|说|讲)|模式\s*回答)|^(?:请\s*)?(?:开启|打开|启用)?\s*斯克鲁奇\s*模式\s*(?:开启|打开|启用|on)?\s*吧?\s*[。！!]*$/i,
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

// Languages that carry activation metadata, in table order (= ko, en, ja, hi, zh). The NL
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

// Stats strings for a language. Unknown or absent lang (inactive session), or a
// row without a stats map, → en.
export function statsText(lang) {
  return (LANG_META[lang] && LANG_META[lang].stats) || LANG_META.en.stats;
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
