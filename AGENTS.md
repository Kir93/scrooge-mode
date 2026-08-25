# Scrooge — agent entry point

@./skills/scrooge/SKILL.md

<!-- AGENTS.local.md is the maintainer's gitignored local override (auto-injected by
     ai-config). The import is kept tracked so local setup and the repo agree; on a
     fresh clone the file is absent and the import simply resolves to nothing. -->

@./AGENTS.local.md

@./CLAUDE.md

## Agents without @-import support

Codex, Copilot's coding agent, and Zed read this file literally, so the `@`-imports above resolve to nothing for them. Read `CLAUDE.md` directly — it is the canonical contributor guide (conventions, registry contract, bilingual parity, verify steps). `AGENTS.local.md`, when present, is the Codex load-order adapter.
