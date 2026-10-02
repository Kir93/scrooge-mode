# scrooge

> Tokens are money — spend them like a miser.

Scrooge makes Claude answer in a compressed register: no filler, no hedging, no polite padding. Code, error strings, identifiers, and technical terms stay verbatim. Security warnings and irreversible-action steps are always written in normal prose.

**`~70% KO · ~67% EN · ~65% JA · ~63% HI · ~67% ZH`** fewer output tokens on single-turn chat prose (`claude-opus-4-8`, paired median). This is not an agentic-session figure. The benchmark rows are published, and the cost of the per-turn injection is counted against the savings — see [Benchmarks](https://github.com/Kir93/scrooge-mode#benchmarks).

## Usage

- `/scrooge ko` turns the Korean register on. `/scrooge en`, `/scrooge ja`, `/scrooge hi`, and `/scrooge zh` work the same way.
- `/scrooge off` turns it off and returns to normal prose.
- `/scrooge-stats` reports the measured output tokens and estimated savings for the session.
- In Claude Code, plain language works too: "talk like scrooge" or "스크루지처럼 답해줘" turns it on, and "stop scrooge" turns it off.

The `lean` flag (minimal code output) is on by default. Turn it off for a session with `/scrooge … nolean`.

## Supported surfaces

| Surface | What loads | Activation | Re-injected every turn | Token stats |
| --- | --- | --- | :-: | :-: |
| Claude Code (CLI, desktop Code tab, IDE) | skills + hooks | `/scrooge` or plain language; persists across sessions | ✓ | ✓ |
| claude.ai, desktop chat, Cowork | skill only | ask in each conversation | — | — |

Hooks run only in Claude Code. If you already installed Scrooge from its own marketplace (`scrooge@scrooge`), Claude Code keeps that copy and does not load the directory copy, so the hooks never run twice.

## What it runs

- Three Node hooks in Claude Code only (`SessionStart`, `UserPromptSubmit`, `SessionEnd`), each with a 5 s timeout. They run only the scripts in this folder.
- It writes only under `~/.claude/.scrooge/` (or `$CLAUDE_CONFIG_DIR/.scrooge/`): mode state, a version marker, an update cache, and a local savings ledger. For token stats it reads the session transcript that Claude Code passes to the hook.
- One network call: at most once a day, a detached process sends a GET to `api.github.com/repos/Kir93/scrooge-mode/releases/latest` to check for updates. It is disabled by `SCROOGE_NO_UPDATE_CHECK=1` and in CI. There is no telemetry.

## More

Installation for other agents (Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI), benchmarks, and design notes are in the [main repository](https://github.com/Kir93/scrooge-mode). Licensed under [MIT](LICENSE).
