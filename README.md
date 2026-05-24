# Scrooge 🪙

English | [한국어](README.ko.md)

> Tokens are money. So spend them like a miser.

**Scrooge** is a Korean-first bilingual (KO/EN) skill that makes AI coding agents reply in a
**compressed register while keeping full technical accuracy**, cutting **output tokens**.
The persona is a penny-pinching miser who refuses to waste a single token.

## Why Scrooge — positioning is "accessibility"

Existing compression tools assume fluency in English or Classical Chinese. Scrooge treats
**Korean as a first-class language**, so you can use natural compressed output without that background.
The goal is **accessibility**: anyone can save tokens in their own language.

## Register: language × dial

At launch, **KO + EN** each ship with two dials (`lite` / `full`).

| Lang | Dial   | Rule summary |
| ---- | ------ | ------------ |
| EN   | `lite` | Drop filler/pleasantry/hedging, keep full grammar + articles |
| EN   | `full` | Caveman-style — drop articles/filler, allow fragments, short synonyms |
| KO   | `lite` | Trimmed 존댓말 — keep polite endings, drop filler/empty greetings/hedging |
| KO   | `full` | 개조식 + 음슴체 — nominal/`~함`·`~됨`, drop particles, subject pro-drop |

Common to all dials: **code blocks, errors, and technical terms stay verbatim**, and **clarity beats compression**.
Safety-related content (security warnings, irreversible-action confirmations) always reverts to normal prose, regardless of dial.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash
```

The installer auto-detects AI coding agents on your machine (Claude Code, Codex, etc.) and installs Scrooge into each.
Agents that aren't present are skipped without error.

## Usage

Scrooge has **two independent axes** — language `{ko, en}` and dial `{lite, full}`.
Each axis persists on its own; an axis you don't name keeps its current value. Order doesn't matter.

```text
/scrooge            # default register (en / full)
/scrooge lite       # dial → lite      (language unchanged)
/scrooge full       # dial → full      (language unchanged)
/scrooge ko         # language → ko    (dial unchanged)
/scrooge en         # language → en    (dial unchanged)
/scrooge ko lite    # set both at once (order-free)
```

The value sets don't overlap, so each token unambiguously selects its axis.
A mode persists until you change it or the session ends.
Once a turn runs in scrooge mode, the statusline shows cumulative tokens saved for the session
(measured from the agent's session log, not estimated).

## Adding a language (i18n-first)

Scrooge does not hardcode language rules into core logic. Adding a language takes **only two steps**:

1. Author the `rules/{lang}/{lite,full}.md` rule files.
2. Add one entry to [registry.json](registry.json):

```json
{
  "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
}
```

No changes to activation, stats, or installer core are needed. `registry.json` resolves `language × dial → rule file path` 1:1.

## License / attribution

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
