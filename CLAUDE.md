# Scrooge — contributor guide

KO-first bilingual (KO/EN) **LLM output-compression skill**. npm `scrooge-mode` (ESM). "Tokens are money; spend them like a miser." This file guides anyone — human or agent — working on the repo. Bias toward caution over speed; trivial edits use judgment.

> Personal/machine-local overrides live in `CLAUDE.local.md` (gitignored). Don't put shared guidance there.

## What this repo is

- **Product = docs, not runtime code.** Shipped artifacts: register rule files `rules/{lang}/{lite,full}.md` + `registry.json`, which maps `language × dial → rule file path` 1:1.
- **Early development.** Installer, activation hook, token-savings stats, benchmark — future Tasks, intentionally unbuilt. Don't fill them in speculatively.
- **Test harness landed (Task 7).** `npm test` runs `node --test` over `tests/` (zero-dep, Node built-in). No other build scripts — don't invent new ones; verify per §4.

## Conventions

- **Language**: code, comments, and identifiers in English; user-facing docs are bilingual (KO/EN) — keep both sides in sync.
- **Registry contract**: renaming/moving any `rules/**` file requires the matching `registry.json` path edit in the *same* change. Dynamic loader reads rules via `registry.json[lang][dial]`.
- **Bilingual + dial parity**: a substantive change to one rule (or `README.md`) mirrors to its counterpart — `ko` ↔ `en`, `lite` ↔ `full`, `README.md` ↔ `README.ko.md` — or flag explicitly why not.
- **markdownlint**: respect `.markdownlint.jsonc`. It tunes (not blocks) the linter — don't delete it. Don't pre-disable a rule speculatively; disable only when one actually surfaces noise.
- **Dogfood**: this is a compression tool — keep docs and prose tight, no filler/hedging. Clarity wins where it conflicts with compression.
- **Safety register**: rule files must keep security warnings, destructive-action confirmations, and ambiguous multi-step sequences in normal prose (auto-clarity), every dial.

## Working rules

### 1. Think before coding

Don't assume, don't hide confusion, surface tradeoffs. State assumptions; multiple interpretations → present them, don't pick silently; simpler path → say so. Touching a rule file or `registry.json` → confirm whether the change must also land in the other lang/dial/README first.

### 2. Simplicity first

Minimum that solves it, nothing speculative. **Don't build future Tasks early** — skeletons and "TBD — Task N" markers are scaffolding, not gaps. No single-use abstractions, no unrequested flexibility.

### 3. Surgical changes

Touch only what you must; clean up only your own orphans. Don't "improve" adjacent prose, formatting, or unrelated rule files. Match existing style. Keep the registry contract and bilingual parity intact. Pre-existing cruft stays unless asked. Every changed line traces to the request.

### 4. Goal-driven execution

Verify with `npm test` (the `node:test` harness — covers hook parsing, state security, session-log parsing, detection, G7 safety-escape) plus:

- **markdownlint clean**: `npx markdownlint-cli2 "**/*.md"` (honors `.markdownlint.jsonc`).
- **Registry resolves**: every `registry.json` path points at a file that exists; every `rules/**` file is reachable from the registry.
- **Bilingual + dial parity**: `ko`/`en` and `lite`/`full` counterparts stay aligned.
- **JSON valid**: `registry.json` parses.
- **Lockfile with `npm ci`**: any CI, release, or doc change that introduces `npm ci` must include/update `package-lock.json` in the same change. `npm ci` fails without a lockfile.

For multi-step tasks, state a brief plan with a per-step verify.

---

**Working if:** fewer stray edits in diffs, registry/parity never silently drift, and clarifying questions come before mistakes — not after.
