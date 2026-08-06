// scrub.js — deterministic pre-publish scrub gate + publish-ready transform.
//
// Publishing measured rows is IRREVERSIBLE, so a leak gate must run before any
// row reaches benchmarks/published/. Two responsibilities, both zero-dep and pure
// (no Date.now()/randomness → deterministic canary tests), mirroring the
// fidelity/checks.js pattern (pure functions + a thin `isMain()` CLI):
//
//   - scan — flag any residual host-context leak: a host CLAUDE.md rule name
//            echoed into the answer, a /Users/ (home) absolute path, or a
//            session_file carrying a path rather than a bare filename. Also
//            rejects a row that still holds an `output_text` key: decision D2
//            mandates FULL removal (not truncation), because a truncated prose
//            remnant can smuggle an unenumerated host/personal string past the
//            enumerated-token scan (false-green). Applies to derived provenance
//            markdown / examples excerpts too, not only JSONL.
//   - transform — produce the publish-ready row: drop `output_text` entirely and
//            reduce `session_file` to its bare basename (strips any leaked path).
//
// CLI:
//   node scrub.js scan <file...>          exit 1 if any leak, else 0
//   node scrub.js transform <src.jsonl>   write scrubbed JSONL to stdout

// Host CLAUDE.md rule names / markers that only appear when an un-isolated run
// echoed the host context into its answer (never ordinary bench prose — these are
// file-name / header tokens). Matched case-insensitively as substrings. Kept broad
// on purpose: a false-negative here publishes a leak irreversibly.
export const HOST_RULE_TOKENS = [
  'react-best-practices',
  'web-interface-guidelines',
  'web-design-guidelines',
  'ui-rules-loading',
  'RULES CHECK',
];

const HOST_RULE_LOWER = HOST_RULE_TOKENS.map((t) => t.toLowerCase());

// Home / absolute-path leak: a /Users/... or /home/... POSIX path, or a Windows
// C:\Users\ / \Users\ path. Hoisted so the scan loop does not recompile it per row.
const HOME_PATH_RE = /\/(?:Users|home)\/[^\s"'\\]+|[A-Za-z]:\\Users\\[^\s"']+|\\Users\\[^\s"']+/;

// Scan a raw string for host-context leaks (common to JSONL lines and markdown).
export function scanText(text) {
  const leaks = [];
  if (!text || typeof text !== 'string') return leaks;
  const lower = text.toLowerCase();
  for (let i = 0; i < HOST_RULE_LOWER.length; i++) {
    if (lower.includes(HOST_RULE_LOWER[i])) leaks.push(`host-rule:${HOST_RULE_TOKENS[i]}`);
  }
  const m = text.match(HOME_PATH_RE);
  if (m) leaks.push(`home-path:${m[0]}`);
  return leaks;
}

// Prose-bearing keys that must never reach published/. `output_text` is the D2
// case; `missing_claims` is the judge's verbatim excerpt of what the compressed
// answer dropped — same category, and it leaks the same way: the 2026-08-06
// re-measure published a zh row whose missing_claims quoted an answer that had
// echoed the bench working directory, so the excerpt carried a /Users/ path the
// enumerated-token scan would otherwise have to guess at. Excerpts stay in the
// gitignored local file; published rows keep only the scores derived from them.
const PROSE_KEYS = ['output_text', 'missing_claims'];

// Structural checks on a parsed JSONL row: the prose keys must be gone (D2, full
// removal — a truncated remnant is rejected because its key still being present
// signals partial-preservation), and session_file must be a bare filename.
export function scanRow(row) {
  const leaks = [];
  if (!row || typeof row !== 'object') return leaks;
  for (const k of PROSE_KEYS) if (k in row) leaks.push(`${k}-present`);
  const sf = row.session_file;
  if (typeof sf === 'string' && /[/\\]/.test(sf)) leaks.push(`session-path:${sf}`);
  return leaks;
}

// Publish-ready row: drop the prose keys entirely (D2), reduce session_file to its
// bare basename so any leaked directory path is stripped.
export function toPublishRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (PROSE_KEYS.includes(k)) continue;
    if (k === 'session_file' && typeof v === 'string') out[k] = v.replace(/^.*[/\\]/, '');
    else out[k] = v;
  }
  return out;
}

// Scan one file for leaks. JSONL → per-line scanText(raw) + scanRow(parsed);
// anything else (markdown, txt) → scanText over the whole file. Returns a list of
// { line, leak } (line is null for whole-file scans).
export function scanFile(path, text) {
  const leaks = [];
  if (path.endsWith('.jsonl')) {
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      for (const leak of scanText(line)) leaks.push({ line: i + 1, leak });
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        leaks.push({ line: i + 1, leak: 'invalid-json' });
        return;
      }
      for (const leak of scanRow(row)) leaks.push({ line: i + 1, leak });
    });
  } else {
    for (const leak of scanText(text)) leaks.push({ line: null, leak });
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// CLI — node scrub.js <scan|transform> <file...>
// ---------------------------------------------------------------------------

function isMain() {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  const invoked = process.argv[1].replace(/\\/g, '/');
  return invoked.endsWith('benchmarks/scrub.js') || invoked.endsWith('/scrub.js');
}

if (isMain()) {
  const { readFileSync } = await import('node:fs');
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd === 'scan') {
    if (!files.length) {
      process.stderr.write('usage: node scrub.js scan <file...>\n');
      process.exit(2);
    }
    let total = 0;
    for (const f of files) {
      const leaks = scanFile(f, readFileSync(f, 'utf8'));
      for (const { line, leak } of leaks) {
        process.stderr.write(`${f}${line ? ':' + line : ''}: ${leak}\n`);
      }
      total += leaks.length;
    }
    if (total) {
      process.stderr.write(`scrub: ${total} leak(s) found\n`);
      process.exit(1);
    }
    process.stdout.write('scrub: clean\n');
  } else if (cmd === 'transform') {
    const [src] = files;
    if (!src) {
      process.stderr.write('usage: node scrub.js transform <src.jsonl>\n');
      process.exit(2);
    }
    const out = [];
    for (const line of readFileSync(src, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      out.push(JSON.stringify(toPublishRow(JSON.parse(line))));
    }
    process.stdout.write(out.join('\n') + '\n');
  } else {
    process.stderr.write('usage: node scrub.js <scan|transform> <file...>\n');
    process.exit(2);
  }
}
