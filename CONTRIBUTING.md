# Contributing

English · [한국어](CONTRIBUTING.ko.md)

Scrooge is a docs-and-rules product. Keep changes small, bilingual where user-facing, and tied to the registry contract in [CLAUDE.md](CLAUDE.md#conventions).

## Dev Setup

Requirements:

- Node.js 18 or newer.
- Git.
- `npx` access for markdownlint.

Setup:

```bash
git clone https://github.com/Kir93/scrooge-mode.git
cd scrooge-mode
npm ci
```

The repo intentionally has no build step. The shipped product is `rules/**`, `registry.json`, `skills/**`, `hooks/**`, `bin/**`, and `.claude-plugin/**`.

## Test & Lint

Run before opening a PR:

```bash
npm test
npx markdownlint-cli2 "**/*.md"
```

Validate JSON files:

```bash
node -e "for (const f of ['package.json','registry.json','.claude-plugin/marketplace.json','.claude-plugin/plugin.json']) JSON.parse(require('fs').readFileSync(f))"
```

Validate registry reachability:

```bash
node --input-type=module <<'NODE'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const registry = JSON.parse(readFileSync('registry.json', 'utf8'));
const reachable = new Set();
const errors = [];

for (const [lang, dials] of Object.entries(registry)) {
  for (const [dial, rulePath] of Object.entries(dials)) {
    const normalized = String(rulePath).trim();
    if (!normalized.startsWith('rules/')) errors.push(`${lang}.${dial} outside rules/: ${normalized}`);
    else if (!existsSync(normalized) || !statSync(normalized).isFile()) errors.push(`${lang}.${dial} missing: ${normalized}`);
    else reachable.add(path.normalize(normalized));
  }
}

function listMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(filePath);
    if (entry.isFile() && entry.name.endsWith('.md')) return [filePath];
    return [];
  });
}

for (const filePath of listMarkdownFiles('rules')) {
  if (!reachable.has(path.normalize(filePath))) errors.push(`unreachable rule: ${filePath}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
NODE
```

GitHub branch protection should require the `CI / verify` workflow before merging to `main`. That makes test, markdownlint, registry, and JSON failures block merges.

## Bilingual + Dial Parity

Use [CLAUDE.md Conventions](CLAUDE.md#conventions) as the source of truth. In short:

- User-facing docs stay mirrored across English and Korean. Japanese ships as a lightweight `README.ja.md` landing (value + install + one example), not a full mirror — canonical docs are English/Korean.
- Substantive rule changes stay mirrored across `ko`/`en`/`ja` and `lite`/`full`, or the PR explains why parity is intentionally not changed.
- Renaming or moving `rules/**` requires the matching `registry.json` edit in the same PR.
- Safety auto-clarity must remain in every dial.
- The docs / prose compression boundary and its Docs escape must remain in every dial. `test_doc_boundaries.js` and `test_safety_escape.js` iterate `ko`/`en`/`ja`, and `test_registry_parity.js` guards `registry × VALID_LANGS × VALID_DIALS` completeness plus rule reachability — so a new language's rule files are auto-guarded once it joins `VALID_LANGS` and those loops.

## Adding a Language

1. Add new rule files at `rules/{lang}/lite.md` and `rules/{lang}/full.md`.
2. Add `registry.json[lang]` with `lite` and `full` paths.
3. Generate 5 sample outputs and self-check them against a QA checklist shaped like [docs/ko-qa-checklist.md](docs/ko-qa-checklist.md) when available: register consistency, verbatim code/error/technical terms, safety prose, particle/drop clarity, and honorific policy.
4. Review README, INSTALL, and CONTRIBUTING mirrors. Update user-facing docs if the new language changes installation, activation, or contribution behavior.
5. Open a PR with the sample self-check summary and the commands from [Test & Lint](#test--lint).

The PR-CI registry check catches forgotten registry entries or unreachable rule files automatically.

## PR Conventions

- Keep one behavioral or documentation concern per PR.
- State whether bilingual/dial parity is preserved.
- Include verification commands and results.
- Do not commit generated local agent files such as `.claude/`, `.agents/`, `skills-lock.json`, or `node_modules/`.
- Do not merge unless the required `CI / verify` branch protection check passes.

## Code of Conduct

Be direct, technical, and respectful. Focus critique on the change and its consequences. Report security-sensitive issues privately to the maintainer instead of opening a public issue.
