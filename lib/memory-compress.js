// memory-compress.js — caveman /caveman-compress absorbed: compress a memory
// file (CLAUDE.md / notes / AGENTS.md) while preserving its load-bearing spans.
//
// Overwriting a memory file is irreversible, so the preservation guarantee is
// enforced here DETERMINISTICALLY — never left to the LLM that produced the
// compressed prose. The flow is: the model rewrites the prose tighter (KO-aware),
// then this module verifies that every PROTECTED span survived, before any write,
// and computes the honest input-savings delta the shared ledger records.
//
// What is protected (verbatim, by COUNT): fenced code blocks (fence-length
// matched), inline code, URLs, markdown link targets (incl. angle-bracket),
// rooted / extension / Windows file paths (incl. ?query#anchor), and rare
// destructive-command tokens (rm -rf, DROP TABLE, sudo, chmod, --force, …) so a
// deleted destructive-action warning is caught.
//
// What is NOT guaranteed: plain prose; paths containing spaces (a bare Windows
// `C:\Program Files\…` is captured only to the first space); and Markdown
// link-graph integrity (a reference-link usage `[label]` can be edited out of sync
// with its `[label]:` definition — the target is protected, the label binding is
// not). Compression is meant to reword prose, so the guard cannot also lock it.
// Wrap any path / identifier / command you need preserved in backticks (or use an
// <angle-bracket> link for a spaced path), and REVIEW THE DIFF before overwriting —
// especially for unbackticked permission / safety rules. The gross-deletion guard
// only catches a non-empty file compressed to nothing; diff review is the final
// safety net for everything above (the overwrite is irreversible).
//
// Verification is COUNT-based, not presence-based: a span that appears N times in
// the original must appear >= N times in the candidate. Presence (`includes`)
// alone would miss (a) a duplicated span dropped to fewer copies and (b) a span
// that survives only as a substring of a DIFFERENT, corrupted token. Overlapping
// matches (e.g. a path inside a link destination) are de-duplicated by source
// range so one physical span counts once regardless of how many patterns hit it.
//
// Pure + deterministic (no I/O, no Date.now): the CLI and tests pass text in.

import { estimateTokens } from '../hooks/scrooge-stats.js';

// Rare, command-shaped destructive tokens — protected so a deleted/altered
// destructive-action warning is caught, while staying clear of common prose words
// (token/삭제/permission) that would reject ordinary compression. Exact command
// ARGUMENTS still need backticks for byte-exact protection (see header). Split so
// the SQL arms stay UPPERCASE-only (prose "truncate the string" / "delete from the
// list" must not match) and flags use a hyphen-aware boundary (`--force` must not
// fire inside `--force-with-lease`).
const DESTRUCTIVE_SQL = /(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s+TABLE)/g;
const DESTRUCTIVE_CMD =
  /(rm\s+-rf|\bsudo\b|\bchmod\b|\bchown\b|\bmkfs\b|--force(?![\w-])|--no-verify(?![\w-])|--hard(?![\w-]))/gi;

const trimTrail = (s) => s.replace(/[.,;:!?)\]}>"']+$/, '');

// URL trim: strip trailing sentence punctuation, then strip only UNMATCHED
// trailing brackets — so a balanced URL like `…/Foo_(bar)` keeps its `)` (dropping
// it would corrupt the link) while a sentence `(see https://x.com)` loses the
// stray `)`.
const count = (s, ch) => s.split(ch).length - 1;
function trimUrl(s) {
  let u = s.replace(/[.,;:!?'"]+$/, '');
  for (;;) {
    const last = u[u.length - 1];
    if (last === ')' && count(u, ')') > count(u, '(')) u = u.slice(0, -1);
    else if (last === ']' && count(u, ']') > count(u, '[')) u = u.slice(0, -1);
    else break;
  }
  return u;
}

// Extract every protected span — WITH duplicates (a multiset) and de-duplicated by
// source range (a span fully inside another, e.g. a path within a link target or a
// command within a fenced block, counts once via the outer span).
export function protectedSpans(text) {
  if (typeof text !== 'string' || !text) return [];
  const raw = []; // { span, start, end }
  const add = (re, group = 0, transform = (s) => s) => {
    for (const m of text.matchAll(re)) {
      const s = transform(m[group]);
      if (!s || !s.trim()) continue;
      const off = group === 0 ? 0 : m[0].indexOf(m[group]);
      const start = m.index + (off < 0 ? 0 : off);
      raw.push({ span: s, start, end: start + m[group].length });
    }
  };

  // Fenced code blocks — closing fence matched to the OPENING length/char (\2), so
  // a 4-backtick block wrapping nested ``` examples is captured whole.
  add(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*$/gm);
  // Inline code.
  add(/`[^`\n]+`/g);
  // URLs — capture through non-whitespace (incl. balanced parens), then trim only
  // unmatched trailing punctuation/brackets so a Wikipedia-style `…_(bar)` keeps `)`.
  add(/\bhttps?:\/\/[^\s<>"']+/g, 0, trimUrl);
  add(/\bwww\.[^\s<>"']+/g, 0, trimUrl);
  // Markdown link targets: angle-bracket (may contain spaces), then plain. The
  // plain form captures through non-whitespace and balance-trims so a filename with
  // inner parens — `](docs/Foo_(bar).md)` — keeps its full target, not just up to
  // the first `)`.
  add(/\]\(<([^>]+)>\)/g, 1);
  add(/\]\(([^\s<]+)/g, 1, trimUrl);
  // Reference-style link definitions: `[id]: target` or `[id]:target`.
  add(/^[ \t]*\[[^\]]+\]:[ \t]*<?([^>\s]+)>?/gm, 1, trimUrl);
  // File paths (+ optional ?query#anchor): rooted (/, ./, ../, ~/, $VAR/, @alias/),
  // seg/seg.ext, and a no-space Windows drive path. Paths CONTAINING SPACES
  // (e.g. Windows `C:\Program Files\…`) must be backticked or <angle-bracket>
  // linked to be protected — a bare unquoted spaced path is captured only up to
  // the first space (documented boundary).
  // A path must start at a non-path boundary: the preceding char is none of
  // [word . / @ ~ $ -] (a negative lookbehind), so a path after ANY delimiter —
  // space, quote, `(`, `*`, `=` (KEY=path), `:` (key: path) — is captured, while a
  // path that is mid-token or a sub-segment of a longer path is not. (Closing
  // delimiters stay out of the path char class, so the span itself is clean.)
  add(/(?<![\w./@~$-])((?:~|@[\w.\-]*|\$[A-Za-z_]\w*|\.{1,2})?\/[\w.\-/]+(?:[?#][^\s)'"]*)?)/gm, 1, trimTrail);
  add(/(?<![\w./@~$-])([\w.\-]+\/[\w.\-/]*\w+\.\w+(?:[?#][^\s)'"]*)?)/gm, 1, trimTrail);
  add(/(?<![\w./@~$-])([A-Za-z]:\\[^\s)'"]+)/g, 1, trimTrail);
  // Bare filenames with a KNOWN file extension (no slash) — common in memory files
  // ("check package.json", "see AGENTS.md"). Whitelisting the extension avoids
  // protecting prose abbreviations/decimals (e.g. `e.g.`, `3.14`, `v2.0`, `U.S.`).
  add(
    /\b([\w][\w.\-]*\.(?:md|markdown|json|ya?ml|toml|tsx?|jsx?|mjs|cjs|lock|sh|bash|zsh|py|rb|rs|go|java|kt|txt|env|conf|cfg|ini|xml|html?|css|scss|sql|csv))\b/gi,
    1
  );
  // Config dotfiles (leading-dot, so the bare-filename matcher's word-char start
  // misses them): `.env` + its variants, and common tool rc/ignore files.
  add(
    /(?<![\w./@~$-])(\.(?:env(?:\.[\w.\-]+)?|gitignore|gitattributes|npmrc|nvmrc|editorconfig|dockerignore|(?:eslint|prettier|babel|stylelint)rc[\w.\-]*))\b/gi,
    1
  );
  // Glob path patterns (lint/build scope rules: `packages/*/src/**/*.ts`, `*.ts`).
  // A path-ish run containing a wildcard; the globOnly transform keeps only runs
  // that also carry a `/` or `.`, so markdown bold (`**x**`) and a bare `*` are not
  // protected. Known fail-safe over-capture: a word ending in a period immediately
  // followed by bold (`stubs.**bold**`) reads as `stubs.**` here — it only makes
  // verify stricter on that line (never a corruption escape), `.*` glob vs `.**`
  // bold being structurally indistinguishable from the token alone.
  const globOnly = (s) => {
    const t = trimTrail(s);
    return /[*?]/.test(t) && /[/.]/.test(t) ? t : '';
  };
  add(/(?<![\w./@~$-])([\w.\-/?*]*[*?][\w.\-/?*]*)/g, 1, globOnly);
  // Rare destructive tokens (SQL uppercase-only; commands hyphen-boundary-aware).
  add(DESTRUCTIVE_CMD, 1);
  add(DESTRUCTIVE_SQL, 1);

  // De-duplicate by containment: drop any span whose [start,end) is inside another.
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const r of raw) {
    if (kept.some((k) => k.start <= r.start && r.end <= k.end)) continue;
    kept.push(r);
  }
  return kept.map((r) => r.span);
}

function countMap(spans) {
  const m = new Map();
  for (const s of spans) m.set(s, (m.get(s) || 0) + 1);
  return m;
}

// Verify the candidate preserves every protected span from the original, BY COUNT.
// Returns { ok, missing }: `missing` lists spans the candidate has fewer of. A
// non-empty original compressed to empty/whitespace is gross deletion and fails
// closed.
export function verifyPreservation(original, compressed) {
  const orig = typeof original === 'string' ? original : '';
  const comp = typeof compressed === 'string' ? compressed : '';
  if (orig.trim() && !comp.trim()) return { ok: false, missing: ['<all content>'] };
  const want = countMap(protectedSpans(orig));
  const have = countMap(protectedSpans(comp));
  const missing = [];
  for (const [span, n] of want) {
    if ((have.get(span) || 0) < n) missing.push(span);
  }
  return { ok: missing.length === 0, missing };
}

// Honest input-savings delta for the shared ledger contract. baseline =
// uncompressed memory-file tokens; saved = tokens removed (never negative — a
// compression that grew the file contributes 0, not a phantom cost).
export function compressionDelta(original, compressed) {
  const baseline = estimateTokens(typeof original === 'string' ? original : '');
  const after = estimateTokens(typeof compressed === 'string' ? compressed : '');
  return { baseline, saved: Math.max(0, baseline - after) };
}
