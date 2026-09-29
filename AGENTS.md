# Scrooge — agent entry point

@./CLAUDE.md

The shipped skill is `skills/scrooge/SKILL.md`. It is referenced here as a path and deliberately not `@`-imported. Claude Code ≥2.1.277 in `claude-md-and-agents-md` mode expands this file's imports, and the skill's standing "Answer in a compressed register" would then compress every contributor session even with scrooge off.

## Agents without @-import support

Codex, Copilot's coding agent, and Zed read this file literally, so the `@`-import above resolves to nothing for them. Read `CLAUDE.md` directly — it is the canonical contributor guide (conventions, registry contract, bilingual parity, verify steps).
