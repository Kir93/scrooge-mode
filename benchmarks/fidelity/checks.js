// fidelity/checks.js — deterministic fidelity scoring (the CI-tested core).
//
// The fidelity bench asks: is the compressed (scrooge) answer the *same answer*
// as the uncompressed baseline? That question splits into a deterministic part
// and a model-judgment part:
//
//   - DETERMINISTIC (this file, tested by `npm test` / CI, zero-dep):
//       * byte-exact preservation of verbatim spans — fenced code, inline code,
//         and URLs the baseline emitted must survive byte-exact in the candidate
//         (compression may rephrase prose but must never mangle or drop code /
//         URLs / paths / commands). NOTE: this only covers code/paths/commands the
//         baseline actually marked up in backticks or fences; an identifier left in
//         plain prose is out of scope (see README "Fidelity bench" limitations).
//         Fenced code is compared as a multiset of code LINES, so re-splitting one
//         block into two (or merging) is not a false failure — only a changed or
//         dropped line is.
//       * safety-register preservation — each safety SENTENCE in the baseline (a
//         security / irreversible / confirm warning) must have a near-equivalent
//         sentence in the candidate (invariant ②). Category-presence alone is NOT
//         enough: dropping the real warning while keeping an unrelated same-category
//         word must fail, so we match warning CONTENT (token overlap), not just the
//         category.
//       * judge-verdict parsing — turning the LLM judge's reply into a structured
//         {equivalent, missingClaims, score} verdict, tolerant of format drift but
//         never silently "equivalent".
//
//   - MODEL JUDGMENT (judge.py, offline, subscription-CLI, quota-gated):
//       claim-set equivalence between baseline and candidate, scored by a SEPARATE
//       `claude --print` call (writer/evaluator separation). judge.py shells out to
//       this file's `evaluate` CLI for the deterministic half, so the byte-exact /
//       safety logic has one tested source of truth.
//
// No runtime per-reply use: this is offline-bench only (ADR-003). Pure functions,
// no Date.now()/randomness, so canary tests are deterministic.

// ---------------------------------------------------------------------------
// Verbatim span extraction
// ---------------------------------------------------------------------------

// A fenced code block: ```lang\n...\n``` or ~~~ ... ~~~. We capture the body only
// (not the fence/lang) and normalize trailing whitespace per line so a difference
// in cosmetic trailing space does not read as a byte-exact violation, while real
// token changes (an altered identifier, a changed flag) still do.
const FENCE_RE = /(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/g;
// Inline code: `...` (single backtick spans). Excludes empty spans.
const INLINE_RE = /`([^`\n]+)`/g;
// URLs: http(s):// up to the first whitespace or common closing delimiter.
const URL_RE = /https?:\/\/[^\s)<>\]}"']+/g;

function normalizeFenceBody(body) {
  return body
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

// Extract the verbatim spans from one answer. Each category is a deduped list,
// preserving first-seen order. These are the tokens compression must not corrupt.
export function extractSpans(text) {
  const out = { fenced: [], inline: [], urls: [] };
  if (!text || typeof text !== 'string') return out;

  const seen = { fenced: new Set(), inline: new Set(), urls: new Set() };
  const push = (cat, value) => {
    if (!value) return;
    if (seen[cat].has(value)) return;
    seen[cat].add(value);
    out[cat].push(value);
  };

  let m;
  // Strip fenced blocks first so a backtick inside a fence is not also caught as
  // an inline span, then scan the remainder for inline code.
  while ((m = FENCE_RE.exec(text)) !== null) {
    const body = normalizeFenceBody(m[1]);
    if (body) push('fenced', body);
  }
  const withoutFences = text.replace(FENCE_RE, '\n');
  while ((m = INLINE_RE.exec(withoutFences)) !== null) {
    push('inline', m[1].trim());
  }
  while ((m = URL_RE.exec(text)) !== null) {
    // Trim a trailing sentence period that is almost never part of the URL.
    push('urls', m[0].replace(/[.,;:]+$/, ''));
  }
  return out;
}

// Flatten fenced blocks into their non-empty, trimmed code lines. Comparing at
// line granularity means a meaning-preserving re-split (one block → two) is not a
// false byte-exact failure, while a genuinely changed/dropped line still is.
function fencedLines(blocks) {
  const out = [];
  for (const blk of blocks) {
    for (const line of blk.split('\n')) {
      const t = line.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

// Multiset difference: elements of `a` not matched (by count) in `b`. Distinct
// values are returned, but counts are respected so a line present twice in the
// baseline and once in the candidate still reports one drop.
function multisetDiff(a, b) {
  const counts = new Map();
  for (const x of b) counts.set(x, (counts.get(x) || 0) + 1);
  const out = [];
  for (const x of a) {
    const n = counts.get(x) || 0;
    if (n > 0) counts.set(x, n - 1);
    else if (!out.includes(x)) out.push(x);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Byte-exact preservation
// ---------------------------------------------------------------------------

// Measures CORRUPTION, not completeness. `corrupted` = a verbatim span the
// CANDIDATE emits that is not present byte-exact anywhere in the baseline (a mangled
// identifier, a changed flag, a hallucinated path/URL) — the real fidelity
// violation. Dropping a baseline code example is normal compression, NOT corruption,
// so `dropped` is INFORMATIONAL only and never fails the check (this is the key
// recalibration: an earlier "candidate must keep every baseline span" definition
// scored all real compression as 0%). Reformatting (inline↔fenced) is tolerated by
// also checking the baseline's raw text, so a span that merely moved markup styles
// still counts as present. `pass` keys on `corrupted` being empty.
//
// NOTE: baseline and candidate are INDEPENDENT generations (same prompt, different
// register), not an edit of one another, so a candidate span absent from the
// baseline can be a legitimate alternative rather than a true corruption. This rate
// is therefore an informational signal for the register bench (the headline gates
// on claim-equivalence); it is a hard gate only for edit-relationship surfaces
// (e.g. memory-compress, where candidate IS a compression of the same source).
export function byteExactCheck(baseline, candidate) {
  const b = extractSpans(baseline);
  const c = extractSpans(candidate);
  const baseText = typeof baseline === 'string' ? baseline : '';
  const candText = typeof candidate === 'string' ? candidate : '';
  const bFenced = fencedLines(b.fenced);
  const cFenced = fencedLines(c.fenced);

  const inBaseline = (s) =>
    bFenced.includes(s) || b.inline.includes(s) || b.urls.includes(s) || baseText.includes(s);
  const inCandidate = (s) =>
    cFenced.includes(s) || c.inline.includes(s) || c.urls.includes(s) || candText.includes(s);

  const corrupted = {
    fenced: cFenced.filter((s) => !inBaseline(s)),
    inline: c.inline.filter((s) => !inBaseline(s)),
    urls: c.urls.filter((s) => !inBaseline(s)),
  };
  const dropped = {
    fenced: bFenced.filter((s) => !inCandidate(s)),
    inline: b.inline.filter((s) => !inCandidate(s)),
    urls: b.urls.filter((s) => !inCandidate(s)),
  };
  const corruptedCount = corrupted.fenced.length + corrupted.inline.length + corrupted.urls.length;
  return { corrupted, dropped, corruptedCount, pass: corruptedCount === 0 };
}

// ---------------------------------------------------------------------------
// Safety-register preservation
// ---------------------------------------------------------------------------

// The GENUINE safety register the compression must never drop (KO + EN): security
// warnings and irreversible/destructive actions (the scrooge register's "보안 경고 ·
// 되돌릴 수 없는 동작"). Korean has no ASCII word boundaries, so these match on
// substrings (never \b after Hangul). The broad confirm category (주의/확인/경고/백업)
// was REMOVED — it over-fired on ordinary technical prose ("주의: value를 주면
// controlled", "포트를 쓰는지 확인"), tagging normal answers as safety-bearing and
// tanking the rate. Multi-step ambiguity is not regex-detectable; left to the judge.
export const SAFETY_PATTERNS = {
  security:
    /보안|취약|권한\s*상승|비밀번호|자격\s*증명|유출|민감\s*정보|secur|vulnerab|credential|password|secret|privilege|injection|xss|csrf|sanitiz/i,
  irreversible:
    /되돌릴 수\s*없|복구\s*불가|영구\s*(삭제|적용)|덮어쓰|초기화|data\s*loss|irreversible|cannot be undone|permanent|overwrit|destructive|rm -rf|drop table|truncate|force[- ]?push|--force/i,
};

// A baseline warning is "preserved" when this fraction of its content tokens are
// covered by the candidate (across all candidate sentences, prefix-aware so Korean
// 조사/어미 inflection — 증명이 vs 증명 — still matches) AND its negation polarity is
// not flipped. A rephrase/re-split clears it; a dropped or inverted warning does not.
const SAFETY_COVERAGE_THRESHOLD = 0.5;

// Negation / prohibition markers that flip a warning's meaning. If the baseline
// warning is negative ("cannot", "되돌릴 수 없", "do not", "irreversible") the candidate
// must carry a negation too — otherwise the warning was inverted ("can", "되돌릴 수
// 있"), not preserved. This is the most dangerous false-pass a bag-of-tokens check
// misses, so it is a separate axis from token coverage.
const NEGATION_RE =
  /\bnot\b|\bnever\b|\bcannot\b|can't|don't|\bdo not\b|\bavoid\b|\birreversible\b|\bdestructive\b|없|못|금지|불가|되돌릴 수\s*없|복구\s*불가/i;

function hasNegation(text) {
  return NEGATION_RE.test(text || '');
}

// Korean particles / verb endings that may attach to a stem. Used to accept an
// INFLECTION as a token match (증명이 ⊃ 증명) while rejecting a meaning-changing
// compound (보안 vs 보안관, where the leftover '관' is not in this set). Not
// exhaustive — when in doubt the token is NOT covered, which is the safe direction
// for a safety check (a possibly-dropped warning is flagged, not hidden).
const KO_INFLECTION =
  /^(이|가|은|는|을|를|에|의|로|으로|와|과|도|만|께|에서|에게|한테|까지|부터|나|이나|라도|보다|처럼|만큼|뿐|밖에|이라|라|마다|마저|조차|든|든지|다|음|임|됨|기|게|고|며|면|으면|니|으니|므로|지만|는데|은데|세요|요|았|었|였|되|된|될|돼|함|할|한|해|했|하다|하면|하므로|하세요|합니다|입니다|이다|예요|에요|습니다|는다)$/;

// A baseline token is covered if the candidate has the same token or an inflected
// form: one is the other plus a Korean particle/ending. Bidirectional (the stem can
// be on either side), but the leftover must be a real inflection — a plain prefix
// like 보안→보안관 does NOT count, which closes the over-match false-pass.
function tokenCovered(t, candSet) {
  if (candSet.has(t)) return true;
  if (t.length < 2) return false;
  for (const u of candSet) {
    if (u.length < 2) continue;
    if (t.startsWith(u) && KO_INFLECTION.test(t.slice(u.length))) return true;
    if (u.startsWith(t) && KO_INFLECTION.test(u.slice(t.length))) return true;
  }
  return false;
}

// Split into rough sentences/clauses for content matching: hard breaks on newlines
// and sentence terminators (., !, ?, 。, and Korean clause boundaries are left to
// the terminator + newline split, which is enough for warning-level granularity).
function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Content tokens of a sentence: lowercased word-ish runs of length >= 2 (drops
// one-char Korean particles and punctuation), used for Jaccard overlap.
function contentTokens(sentence) {
  const toks = (sentence.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_./-]+/gu) || [])
    .map((t) => t.replace(/[._/-]+$/, '')) // drop trailing punctuation so '먼저.' === '먼저'
    .filter((t) => t.length >= 2);
  return new Set(toks);
}

// Return the set of safety categories detected anywhere in a text (for reporting).
export function detectSafety(text) {
  const found = [];
  if (!text || typeof text !== 'string') return found;
  for (const [cat, re] of Object.entries(SAFETY_PATTERNS)) {
    if (re.test(text)) found.push(cat);
  }
  return found;
}

// Sentences in `text` that carry a safety marker, with the categories they hit.
function safetySegments(text) {
  return splitSentences(text)
    .map((sentence) => {
      const cats = [];
      for (const [cat, re] of Object.entries(SAFETY_PATTERNS)) {
        if (re.test(sentence)) cats.push(cat);
      }
      return cats.length ? { sentence, cats, tokens: contentTokens(sentence) } : null;
    })
    .filter(Boolean);
}

// Pass when every safety SENTENCE in the baseline is preserved in the candidate.
// "Preserved" = (a) enough of its content tokens are covered by the union of ALL
// candidate sentences (cross-sentence, prefix-aware — a re-split + inflected
// rephrase still clears it) AND (b) its negation polarity is not flipped (a "cannot"
// warning must not become "can"). Category presence alone is NOT sufficient:
// dropping the real warning while keeping an unrelated same-category word fails,
// and inverting the warning fails. `dropped` lists baseline warnings not preserved.
export function safetyCheck(baseline, candidate, threshold = SAFETY_COVERAGE_THRESHOLD) {
  const baseSegs = safetySegments(baseline);
  const candSentences = splitSentences(candidate).map((s) => ({ text: s, tokens: contentTokens(s) }));

  const dropped = [];
  for (const seg of baseSegs) {
    const toks = [...seg.tokens];
    // Candidate sentences that actually discuss THIS warning (share a token). Used
    // for coverage (cross-sentence union → a re-split warning still covers) AND for
    // polarity, so a negation in some UNRELATED candidate sentence cannot mask an
    // inversion of this warning.
    const relevant = candSentences.filter((cs) => toks.some((t) => tokenCovered(t, cs.tokens)));
    const relevantTokens = new Set();
    for (const cs of relevant) for (const t of cs.tokens) relevantTokens.add(t);
    const covered = toks.filter((t) => tokenCovered(t, relevantTokens)).length;
    const coverage = toks.length ? covered / toks.length : 1;
    // Polarity flip: the baseline warns with a negation but the relevant candidate
    // text carries none — the warning was inverted (없→있, cannot→can), not preserved.
    const polarityFlip = hasNegation(seg.sentence) && !relevant.some((cs) => hasNegation(cs.text));
    if (coverage < threshold || polarityFlip) {
      dropped.push({ sentence: seg.sentence, cats: seg.cats, coverage, polarityFlip });
    }
  }
  return {
    baseline: detectSafety(baseline),
    candidate: detectSafety(candidate),
    segments: baseSegs.length,
    dropped,
    pass: dropped.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Judge-verdict parsing
// ---------------------------------------------------------------------------

// Parse the equivalence judge's reply (from judge.py's `claude --print` call) into
// a structured verdict. Tolerant by design — the model may wrap JSON in prose or a
// code fence, or answer in labeled lines. Robust against two reproduced failure
// modes: a judge that RESTATES the schema before its real answer (so we take the
// LAST verdict-bearing JSON, not the first), and a labeled line inside a negation
// ("not equivalent: yes ..."). Order: (1) the last balanced JSON carrying an
// `equivalent` key, (2) a per-line labeled fallback, (3) HOLD when nothing parses
// or a contradiction is detected (never silently scored equivalent, which would
// inflate fidelity).
export function parseVerdict(text) {
  const fail = (reason) => ({
    equivalent: null,
    missingClaims: [],
    alteredClaims: [],
    score: null,
    verdict: 'HOLD',
    reason,
  });
  if (!text || typeof text !== 'string') return fail('empty judge reply');

  // (1) JSON — the real verdict is the LAST balanced object that MENTIONS an
  // `equivalent` key (a schema restated earlier in the reply loses). Critically, if
  // that last verdict-bearing object fails to parse (a common LLM defect: trailing
  // comma, Python True/False/None), we repair-and-retry but NEVER fall back to an
  // earlier object — that earlier object is usually the schema example and would
  // silently score EQUIVALENT. On unrepairable failure we abstain (HOLD).
  const objs = extractJsonObjects(text);
  const eqBearing = objs.filter((o) => /["']?equivalent["']?\s*[:=]/i.test(o));
  if (eqBearing.length) {
    const obj = tryParseJsonLoose(eqBearing[eqBearing.length - 1]);
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, 'equivalent')) {
      return fail('last verdict JSON unparseable — abstaining (no fallback to an earlier object)');
    }
    const equivalent = coerceBool(obj.equivalent);
    if (equivalent === null) return fail('last verdict JSON has a non-boolean equivalent');
    const score = coerceScore(obj.score);
    // Contradiction guard: "equivalent" yet a low score is incoherent → abstain.
    if (equivalent === true && score !== null && score < 0.5) {
      return fail('contradictory verdict: equivalent=true with score<0.5');
    }
    return {
      equivalent,
      missingClaims: toStringArray(obj.missing_claims ?? obj.missingClaims),
      alteredClaims: toStringArray(obj.altered_claims ?? obj.alteredClaims),
      score,
      verdict: equivalent ? 'EQUIVALENT' : 'DIVERGENT',
      reason: typeof obj.reason === 'string' ? obj.reason : null,
    };
  }

  // (2) Labeled-line fallback, scanned per line so surrounding prose cannot flip
  // the verdict. A negation before the marker on the same line → abstain.
  for (const line of text.split('\n')) {
    const m = line.match(/(equivalent|동등)\s*[:=]\s*(yes|true|no|false|예|아니오|아님)/i);
    if (!m) continue;
    // Abstain only when a negation is directly attached to the marker
    // ("not equivalent", "동등 아님") — a generic '없'/'no' elsewhere on the line
    // ("누락 없음. 동등: 예" = no omissions, equivalent) must NOT trip this.
    const before = line.slice(0, m.index).replace(/[\s:=,-]+$/, '');
    if (/(?:\bnot|\bnever|아님|아닌|아니)$/i.test(before)) {
      return fail('negation before verdict marker — ambiguous');
    }
    const equivalent = /^(yes|true|예)$/i.test(m[2]);
    const scoreLine = text.match(/score\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
    return {
      equivalent,
      missingClaims: [],
      alteredClaims: [],
      score: scoreLine ? coerceScore(scoreLine[1]) : null,
      verdict: equivalent ? 'EQUIVALENT' : 'DIVERGENT',
      reason: 'parsed from labeled line',
    };
  }

  return fail('unparseable judge reply');
}

// Return every top-level balanced {...} substring in order (string-aware so braces
// inside JSON strings do not miscount).
function extractJsonObjects(text) {
  const objs = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    objs.push(text.slice(start, end + 1));
    i = end + 1;
  }
  return objs;
}

// Parse JSON, then retry once with light repair for the common LLM defects:
// trailing commas and Python literals (True/False/None). Returns null on failure —
// the caller abstains (HOLD) rather than guessing, so an unrepairable verdict never
// silently scores equivalent. Single-quoted JSON is intentionally NOT coerced
// (apostrophes in strings make it ambiguous) → HOLD.
function tryParseJsonLoose(s) {
  try {
    return JSON.parse(s);
  } catch {
    /* try repair */
  }
  const repaired = s
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(yes|true|예)$/i.test(v.trim())) return true;
    if (/^(no|false|아니오|아님)$/i.test(v.trim())) return false;
  }
  return null;
}

function coerceScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

// ---------------------------------------------------------------------------
// Combined pair scoring
// ---------------------------------------------------------------------------

// Score one (baseline, candidate) pair. `verdictText` is the raw judge reply when
// available; without it, only the deterministic half is computed (equivalence left
// null).
//
// `equivalent` is the REGISTER bench's headline gate (claim-equivalence by the
// judge). `byteExact` (corruption) and `safety` are informational signals there —
// on independent generations they are noisy (see byteExactCheck note). `strictPass`
// is the STRICT all-axes gate (no corruption AND safety preserved AND equivalent),
// reserved for edit-relationship surfaces like memory-compress where byte-exact and
// safety preservation are hard requirements, not signals.
export function scorePair(baseline, candidate, verdictText = null) {
  const byteExact = byteExactCheck(baseline, candidate);
  const safety = safetyCheck(baseline, candidate);
  const verdict = verdictText !== null ? parseVerdict(verdictText) : null;
  const equivalent = verdict ? verdict.equivalent : null;
  const strictPass =
    byteExact.pass && safety.pass && (equivalent === null ? null : equivalent === true);
  return { byteExact, safety, verdict, equivalent, strictPass };
}

// ---------------------------------------------------------------------------
// CLI — `node checks.js evaluate <baselineFile> <candidateFile> [verdictFile]`
// ---------------------------------------------------------------------------
// judge.py shells out to this so the deterministic logic has one tested source of
// truth. Emits the scorePair result as JSON on stdout.

function isMain() {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  const invoked = process.argv[1].replace(/\\/g, '/');
  return invoked.endsWith('benchmarks/fidelity/checks.js') || invoked.endsWith('/checks.js');
}

if (isMain()) {
  const { readFileSync } = await import('node:fs');
  const [cmd, baselineFile, candidateFile, verdictFile] = process.argv.slice(2);
  if (cmd !== 'evaluate' || !baselineFile || !candidateFile) {
    process.stderr.write(
      'usage: node checks.js evaluate <baselineFile> <candidateFile> [verdictFile]\n'
    );
    process.exit(2);
  }
  const read = (p) => (p ? readFileSync(p, 'utf8') : null);
  const result = scorePair(read(baselineFile), read(candidateFile), read(verdictFile));
  process.stdout.write(JSON.stringify(result) + '\n');
}
