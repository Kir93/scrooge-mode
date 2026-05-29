# 🪙 scrooge

`tokens are money — spend them like a miser`

[![Stars](https://img.shields.io/github/stars/Kir93/scrooge-mode?style=flat&color=yellow)](https://github.com/Kir93/scrooge-mode/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Kir93/scrooge-mode?style=flat)](https://github.com/Kir93/scrooge-mode/commits/main)
[![License](https://img.shields.io/github/license/Kir93/scrooge-mode?style=flat)](LICENSE)

English · [한국어](README.ko.md)

KO-first bilingual (KO/EN) output-compression skill for AI coding agents — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI. The Korean register is designed around its own grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), **not** translated from English compression rules.

**`~67% KO · ~65% EN · 100% accuracy · honorifics stripped`** — `claude-opus-4-7`, N=24 paired median.

Jump to: [Demo](#demo) · [Install](#install) · [Surface](#surface) · [Benchmarks](#benchmarks) · [Mechanics](#mechanics) · [Compared to caveman](#compared-to-caveman)

---

## Demo

Same prompt, same Claude model, actual benchmark output. The prompt is Korean and the responses are Korean — this is a deliberate demo of the `ko/full` register, Scrooge's first-class target. See [`benchmarks/prompts/en.txt`](./benchmarks/prompts/en.txt) for the English-prompt corpus.

> Node.js로 만든 단일 모놀리스 서비스를 서비스 분리할 때 가장 먼저 봐야 할 측정 지표 3가지를 알려줘.
>
> *(Translation: "List the 3 most important metrics to look at first when splitting a Node.js monolith into separate services.")*

### Normal Claude (693 tokens)

```text
모놀리스 분리 전 측정 지표 3가지:

## 1. 모듈 간 결합도 (Coupling)
- 측정: import graph 분석 (`madge`, `dependency-cruiser`)
- 지표: cross-module import 수, 순환 의존 여부, fan-in/fan-out
- 판정: 결합 약한 경계가 분리 후보. 순환 의존 있으면 먼저 끊어야 함.

## 2. 도메인별 트래픽/리소스 사용량
- 측정: APM (Datadog/New Relic) 또는 endpoint별 로그 집계
- 지표: RPS, p95 latency, CPU/메모리 점유율 — 라우트/도메인 단위
- 판정: hot path와 cold path 분리하면 독립 스케일 이득.

## 3. 데이터 소유권 (DB 테이블 접근 패턴)
- 측정: 쿼리 로그 → 모듈×테이블 행렬
- 지표: 모듈별 read/write 테이블 집합, JOIN 경계, 트랜잭션 범위
- 판정: 한 모듈이 독점 쓰는 테이블 군 = 깨끗한 분리선.

---

**우선순위**: 3 → 1 → 2. 데이터 경계 못 그으면 서비스 쪼개도 분산 모놀리스.

**보조 지표**:
- 배포 빈도/장애 격리 — 조직 관점
- 팀 경계 (Conway's Law) — 소유권 명확화
- 빌드/테스트 시간 — 기준선
```

### Scrooge `ko/full` (188 tokens)

```text
1. **모듈 간 결합도** — import 그래프, 순환 의존, cross-module 호출 빈도. 분리 경계 후보 식별.
2. **트래픽/부하 편차** — endpoint별 RPS·CPU·메모리 점유율. 스케일 요구 다른 영역이 1순위 분리 대상.
3. **DB 접근 패턴** — 테이블별 read/write 소유권, join 경계, 트랜잭션 스팬. 공유 테이블 많으면 분리 비용 폭증.
```

Same three metrics, same technical decision shape — **~73% fewer output tokens** on this prompt.

> [!IMPORTANT]
> Output only. Reasoning, thinking, accuracy — untouched. A miser ledgers the spend, not the thought.

## Install

Multi-agent installer — auto-detects Claude Code, Codex, Cursor, Windsurf, Cline, Continue, and Gemini CLI, and wires Scrooge into each.

### npx (cross-platform, recommended)

```bash
npx -y github:Kir93/scrooge-mode
```

### macOS / Linux

```bash
# curl | bash (no clone)
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash

# or from a local clone
./install.sh
```

### Windows (PowerShell)

```powershell
# PowerShell one-liner (no clone)
irm https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.ps1 | iex

# or from a local clone
./install.ps1
```

~10 seconds. Needs Node ≥18. Skips any agent you don't have. Safe to re-run. Preview without applying: append `--dry-run`. Restrict to one agent: `--only claude`.

Codex gets an additional user-level hook: the installer copies Scrooge's hook payload to `~/.codex/scrooge/` and merges a `UserPromptSubmit` entry into `~/.codex/config.toml`. It does **not** create per-project `.codex/hooks.json`.

> **Where you run the one-liner matters.** For non-Claude targets (Codex, Cursor, etc.) the installer calls `npx skills add`, which the upstream `skills` CLI installs at **project scope** when it detects a `package.json` in the cwd or an ancestor. If you pipe `curl | bash` from inside one of your own projects, you'll find a fresh `.agents/`, `skills/<name>` symlink, and `skills-lock.json` in that project's root. Two ways to avoid that:
>
> - **Run from your home directory** (`cd ~`) before the curl one-liner — no `package.json` ancestor → installs at user scope.
> - Or pass `--global-skills` to force user-scope explicitly:
>
>   ```bash
>   curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash -s -- --global-skills
>   ```
>
> Running from inside a clone of *this* repo is auto-detected and skipped — the source already is the canonical layout.
> This warning is about `skills` CLI files only; the Codex activation hook is always user-level.

### Uninstall

```bash
# macOS / Linux
./uninstall.sh

# cross-platform via npx
npx -y github:Kir93/scrooge-mode -- -u
```

```powershell
# Windows (PowerShell)
./uninstall.ps1
```

**Claude Code plugin path** (resolves directly from this repo after the `v0.1.0` tag):

```bash
claude plugin marketplace add Kir93/scrooge-mode
claude plugin install scrooge@scrooge
```

**Activate.** `/scrooge ko full` (or `/scrooge en lite`, etc.) turns the register on. `/scrooge off` clears state. `scrooge --help` lists every flag.

## Surface

| Component | What |
| --- | --- |
| `/scrooge [lang] [dial]` | Activate a register. Two axes — `ko`/`en` × `lite`/`full`. Persists per session. |
| `/scrooge off` | Clear state, return to normal prose. |
| `UserPromptSubmit` hook | Reinjects the register every turn so the dial does not drift. |
| Safety auto-clarity | Rules drop compression for security warnings, irreversible-action confirmations, and ambiguous multi-step sequences. Both languages, every dial. |
| `registry.json` | Maps `language × dial → rule file path` 1:1. Adding a language = one new rule file + one registry entry. |
| Token-savings statusline | Actual session output tokens from the Claude Code session JSONL — not tokenizer estimates. |
| CLI benchmark harness | Reproducible runner (`benchmarks/run.py`) — see [`benchmarks/`](./benchmarks/). |

**Why Korean matters.** Most output-compression skills are English-first or assume Classical Chinese as the only non-English target. Scrooge treats Korean as a first-class language — the register is designed around Korean grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), not translated from English. The architecture is i18n pluggable, so adding a language is one rule file + one `registry.json` entry — no rule-engine surgery.

## Benchmarks

Measured on **`claude-opus-4-7`**. Full methodology and raw reproduction commands live in [`benchmarks/`](./benchmarks/).

**Measurement conditions** (read before quoting the numbers):

- **N=24 prompts × 1 run, paired median.** Single-run results; no variance estimate. Re-running can shift any single cell by a few percent. Treat headline percentages as one-significant-figure estimates (`~67%`, not "67.4% exactly").
- **Register-only isolation.** The harness runs each arm under `claude --print --system-prompt <rule>`, which *replaces* Claude Code's default system prompt. This isolates the register effect cleanly, but real `/scrooge` sessions keep Claude Code's full system prompt alongside the injected register, so real savings versus a real verbose session may differ from the headline. See [`benchmarks/README.md`](./benchmarks/README.md) for the full caveat list.
- **Real `output_tokens`, not tokenizer estimates.** Numbers come from the Claude Code session JSONL's `output_tokens` field — what the API actually billed.

### Korean

`normal` is the model default; `terse` is a control prompt ("answer concisely"); `scrooge:*` is the rule we ship. `caveman:full` is a comparison baseline, not a Scrooge mode.

| Mode | Median output tokens (N=24) | Savings vs `normal` |
| --- | --------------------------: | ------------------: |
| `normal` | 1567 | (baseline) |
| `terse` | 1145 | ~27% |
| **`scrooge:ko/full`** | **511** | **~67%** |
| `caveman:full` | 901 | ~43% |

`scrooge:ko/full` cuts Korean output by **~67%** vs the verbose default and by **~43%** vs `caveman:full`. It also beats `terse`, so the gain is the register itself, not just generic brevity.

### English

| Mode | Median output tokens (N=24) | Savings vs `normal` |
| --- | --------------------------: | ------------------: |
| `normal` | 2235 | (baseline) |
| **`scrooge:en/full`** | **774** | **~65%** |
| `caveman:full` | 396 | ~82% |

`scrooge:en/full` cuts English output by **~65%**. `caveman:full` is still the stronger English compression baseline; Scrooge's first release goal is Korean-native compression.

**Mini English sample (`en/full`)**

> Explain why a database index speeds up reads and slows down writes.

```text
Index = extra lookup structure.

Reads: planner searches index keys, then fetches matching rows; avoids full table scan when predicate is selective.
Writes: INSERT/UPDATE/DELETE must maintain index pages, maybe split/rebalance B-tree, write more WAL, and consume cache/disk.

Tradeoff: add indexes for hot selective reads; avoid redundant indexes on write-heavy tables.
```

## Mechanics

1. `/scrooge [lang] [dial]` activates a mode. Tokens compose on two independent axes — `/scrooge ko`, `/scrooge full`, `/scrooge ko lite`, etc.
2. The `UserPromptSubmit` hook parses the command, persists `{lang, dial}` to a state file, looks up the rule via [`registry.json`](registry.json), and injects it as `additionalContext`.
3. Every subsequent turn reinjects a lightweight reminder so the register does not drift.
4. `/scrooge off` clears state. Auto-clarity contexts inside the rule itself drop compression for safety-critical replies — security warnings, irreversible-action confirmations, ambiguous multi-step sequences — without the user having to opt out.

**Adding a language**:

1. Author `rules/{lang}/{lite,full}.md`.
2. Add one entry to [`registry.json`](registry.json):

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

3. Sample 5 outputs against the QA checklist (see `CONTRIBUTING.md`, once available) and PR.

## Compared to caveman

[caveman](https://github.com/JuliusBrussee/caveman) inspired the project. Scrooge is not a fork or README/code copy; it is an independent, KO-first implementation with caveman kept as an explicit benchmark/reference point.

| Axis | caveman | Scrooge |
| --- | --- | --- |
| Primary target | Aggressive English compression | Korean-native bilingual compression |
| Languages | EN (+ wenyan classical Chinese) | KO, EN; i18n via `registry.json` |
| Korean register | None | Native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default |
| English result in this run | Stronger compression (`396` median tokens) | Less aggressive (`774` median tokens), clarity/i18n tradeoff |
| Benchmarking here | Comparison arm (`caveman:full`) | Real `output_tokens` runner, paired reports |

In short: Scrooge should not read like caveman with Korean bolted on. The point is Korean-first register design, while still acknowledging caveman as the source of inspiration and the strongest English comparison baseline.

## License

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
