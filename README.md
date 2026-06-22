<p align="center">
  <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f4b0/emoji.svg" width="120" alt="money bag" />
</p>

<h1 align="center">scrooge</h1>

<p align="center">
  <code>tokens are money — spend them like a miser</code>
</p>

<p align="center">
  <a href="https://github.com/Kir93/scrooge-mode/stargazers"><img src="https://img.shields.io/github/stars/Kir93/scrooge-mode?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://github.com/Kir93/scrooge-mode/commits/main"><img src="https://img.shields.io/github/last-commit/Kir93/scrooge-mode?style=flat" alt="Last Commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Kir93/scrooge-mode?style=flat" alt="License"></a>
</p>

<p align="center">
  English · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#install">Install</a> ·
  <a href="#surface">Surface</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#mechanics">Mechanics</a> ·
  <a href="#compared-to-caveman">Compared to caveman</a>
</p>

---

> Output-compression skill for AI coding agents — same answer, fewer tokens on every reply.

KO-first bilingual (KO/EN) output-compression skill for AI coding agents — full on [Claude Code](https://docs.anthropic.com/en/docs/claude-code), hook + stats on Codex, skill-only on Cursor, Windsurf, Cline, Continue, Gemini CLI (see [Host support](#host-support)). The Korean register is designed around its own grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), **not** translated from English compression rules.

**`~70% KO · ~73% EN · output-only · honorifics stripped`** — `claude-opus-4-8`, N=20–21 paired median.

<p align="center">
  <a href="#benchmarks"><img src="assets/benchmark.svg" alt="Median output tokens per turn (claude-opus-4-8, paired median): Korean scrooge:ko/full 972 vs normal 3186 (−70%); English scrooge:en/full 969 vs normal 3578 (−73%)" width="760"></a>
</p>

## Demo

Same prompt, same Claude model, actual benchmark output. The prompt is Korean and the responses are Korean — this is a deliberate demo of the `ko/full` register, Scrooge's first-class target. See [`benchmarks/prompts/en.txt`](./benchmarks/prompts/en.txt) for the English-prompt corpus.

> Node.js로 만든 단일 모놀리스 서비스를 서비스 분리할 때 가장 먼저 봐야 할 측정 지표 3가지를 알려줘.
>
> _(Translation: "List the 3 most important metrics to look at first when splitting a Node.js monolith into separate services.")_

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

Recommended quick-start:

```bash
npx -y github:Kir93/scrooge-mode
```

Pin a released version for reproducible installs (swap the tag for the release you want):

```bash
npx -y github:Kir93/scrooge-mode#v0.6.1
```

**Update.** Re-running the quick-start updates every detected host in place — Scrooge is safe to re-run. On Claude Code the installer now refreshes the marketplace and runs `claude plugin update` (restart Claude to apply) instead of skipping; Codex and skill-only hosts overwrite their payload on re-run. To pin a specific version instead of latest, use the same `--tag`/`#ref` as above.

Detailed setup, Claude Code plugin install, Codex `skills` install, troubleshooting, and uninstall steps live in [INSTALL.md](INSTALL.md). 한국어 설치 문서는 [INSTALL.ko.md](INSTALL.ko.md).

**Activate.** `/scrooge ko full` (or `/scrooge en lite`, etc.) turns the register on. `/scrooge off` clears state. `scrooge --help` lists every flag. On the Claude Code hook, plain language works too — "talk like scrooge" / "스크루지처럼 답해줘" activates, "stop scrooge" / "스크루지 꺼" clears. A negation ("don't talk like scrooge" / "스크루지처럼 말하지 마") is ignored.

### Host support

The installer sets up each detected host at its capability tier:

| Host | Install | Reinject hook | Stats | Statusline |
| ---- | ------- | :-----------: | :---: | :--------: |
| Claude Code | plugin | ✓ | ✓ | ✓ |
| Codex | skills + `config.toml` hook | ✓ | ✓ | — |
| Cursor · Windsurf · Cline · Continue · Gemini CLI | skills (skill-only) | — | — | — |

Skill-only hosts get the register rule as a skill, but activation is manual — no per-turn reinject hook and no token stats. The full hook + stats + statusline experience is Claude Code; Codex gets the hook + stats via `~/.codex/config.toml`.

## Surface

| Component                | What                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/scrooge [lang] [dial]` | Activate a register. Two axes — `ko`/`en` × `lite`/`full`. Persists per session, and is saved as a global default that auto-activates new sessions.                                                                 |
| `/scrooge … [flag]`      | Behavior flags orthogonal to the dial: `lean` (minimal code output) is **on by default** (~21% less code); `ctx` (context economy) is **opt-in**. Toggle with `nolean`/`ctx` (per session) or `SCROOGE_DEFAULT_FLAGS` (global). `max` = both. |
| `/scrooge off`           | Clear state + the global default (global off), return to normal prose.                                                                                                             |
| Natural language (hook)  | "talk like scrooge" / "스크루지처럼 답해줘" activates; "stop scrooge" / "스크루지 꺼" clears. Negations ignored; slash wins. Language from the phrase, dial `full`. |
| `UserPromptSubmit` hook  | Reinjects the register every turn so the dial does not drift.                                                                                    |
| Safety auto-clarity      | Rules drop compression for security warnings, irreversible-action confirmations, and ambiguous multi-step sequences. Both languages, every dial. |
| `registry.json`          | Maps `language × dial → rule file path` 1:1. Adding a language = one new rule file + one registry entry.                                         |
| `scrooge-stats` skill    | Discoverable stats surface for Claude/Codex. Reports measured input + output tokens from the session JSONL; never asks the model to estimate.    |
| Token-savings statusline | Actual session output tokens from the Claude Code session JSONL — not tokenizer estimates.                                                       |
| CLI benchmark harness    | Reproducible runner (`benchmarks/run.py`) — see [`benchmarks/`](./benchmarks/).                                                                  |

**Why Korean matters.** Most output-compression skills are English-first or assume Classical Chinese as the only non-English target. Scrooge treats Korean as a first-class language — the register is designed around Korean grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), not translated from English. The architecture is i18n pluggable, so adding a language is one rule file + one `registry.json` entry — no rule-engine surgery.

## Benchmarks

Measured on **`claude-opus-4-8`**. Full methodology and raw reproduction commands live in [`benchmarks/`](./benchmarks/).

**Measurement conditions** (read before quoting the numbers):

- **N=20–21 prompts × 1 run, paired median.** Single-run results; no variance estimate (a few prompts dropped on subscription timeouts). Re-running can shift any single cell by a few percent. Treat headline percentages as one-significant-figure estimates (`~70%`, not "69.5% exactly").
- **Register-clean run.** Both register hooks (scrooge's own activation hook and caveman) are neutralized for the benchmark so they cannot inject into the `normal`/`terse` baseline; token counts are deduped by `message.id` (prose-only basis). An earlier run whose baseline was silently compressed by the host's scrooge hook was discarded.
- **Held-out cross-check.** Re-measured on a held-out prompt set (`prompts/{ko,en}-report.txt`, disjoint from the tuning corpus): KO ~71%, EN ~68% (N=11 each). Consistent with the headline above, so the savings are not an artifact of overfitting to the tuning prompts.
- **Register-only isolation.** The harness runs each arm under `claude --print --system-prompt <rule>`, which _replaces_ Claude Code's default system prompt. This isolates the register effect cleanly, but real `/scrooge` sessions keep Claude Code's full system prompt alongside the injected register, so real savings versus a real verbose session may differ from the headline. See [`benchmarks/README.md`](./benchmarks/README.md) for the full caveat list.
- **Real `output_tokens`, not tokenizer estimates.** Numbers come from the Claude Code session JSONL's `output_tokens` field — what the API actually billed.

### Korean

`normal` is the model default; `terse` is a control prompt ("answer concisely"); `scrooge:*` is the rule we ship. `caveman:full` is a comparison baseline, not a Scrooge mode.

| Mode                  | Median output tokens (N=20) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        3186 |          (baseline) |
| `terse`               |                        2597 |                ~19% |
| **`scrooge:ko/full`** |                     **972** |            **~70%** |
| `caveman:full`        |                        1203 |                ~62% |

`scrooge:ko/full` cuts Korean output by **~70%** vs the verbose default and by **~19%** vs `caveman:full` (15/20 prompt wins). It also beats `terse`, so the gain is the register itself, not just generic brevity.

### English

| Mode                  | Median output tokens (N=21) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        3578 |          (baseline) |
| `terse`               |                        2509 |                ~30% |
| **`scrooge:en/full`** |                     **969** |            **~73%** |
| `caveman:full`        |                        1264 |                ~65% |

`scrooge:en/full` cuts English output by **~73%** vs the verbose default and by **~23%** vs `caveman:full` (17/21 prompt wins) — its strongest result.

**Mini English sample (`en/full`)**

> Explain why a database index speeds up reads and slows down writes.

```text
Index = extra lookup structure.

Reads: planner searches index keys, then fetches matching rows; avoids full table scan when predicate is selective.
Writes: INSERT/UPDATE/DELETE must maintain index pages, maybe split/rebalance B-tree, write more WAL, and consume cache/disk.

Tradeoff: add indexes for hot selective reads; avoid redundant indexes on write-heavy tables.
```

### Document generation

The tables above measure conversational replies. Scrooge's doc-compression rule (the `## Boundaries` "docs / prose artifacts" clause) also targets **generated documents** — READMEs, specs, API references, release notes, runbooks. Measured on a separate held-out corpus ([`prompts/{ko,en}-docgen.txt`](./benchmarks/prompts/ko-docgen.txt) — 12 document-generation tasks that pin the facts to include, so every arm conveys the _same information_), run inline-only (`--disallow-tools`, so the model emits the document as prose instead of writing it to a file):

| Lang | `normal` | `terse` | `scrooge` | Median per-prompt savings | scrooge < `normal` |
| ---- | -------: | ------: | --------: | ------------------------: | :----------------: |
| Korean (N=10)  | 3554 | 2460 | **1420** | **~48%** | 10 / 10 |
| English (N=11) | 2772 | 1504 |  **852** | **~55%** | 11 / 11 |

Median output tokens per arm; the savings column is the **median of each prompt's reduction** (dividing the two median-token columns gives a higher 60% KO / 69% EN — they land on different prompts under the heavy-tailed spread, so the per-prompt median is the representative figure). scrooge was smaller than the verbose baseline on **every** prompt, and beat the `terse` "answer concisely" control on 9/10 (KO) and 11/11 (EN) — so the win is the register, not generic brevity. The savings come from dropping meta-prologues ("릴리스 노트입니다…"), closing "want me to also reformat this?" offers, and per-item over-explanation, while keeping the document body intact: every fact, code block, and step. Before/after pairs and the full per-prompt token tables behind these numbers are committed under [`benchmarks/examples/`](./benchmarks/examples/) ([`docgen-results.md`](./benchmarks/examples/docgen-results.md); e.g. Korean release notes, `normal` 1839 → `scrooge` 776 tokens, same six changes).

These doc-generation numbers are **noisier than the conversational headline** — treat them as estimates:

- **Single run, high variance.** Document length varies a lot run-to-run; per-prompt savings here ranged from 7% (a dense feature spec — mostly required content) to 92% (a verbose baseline). The stable signal is the per-prompt win-rate, not the exact percentage.
- **Conservative.** A few `normal`/`terse` prompts were dropped from the paired set because their documents were too long to finish within the timeout — i.e. the most verbose baselines are _excluded_, not counted.
- **Clean baseline.** Unlike the conversational headline, this run additionally neutralizes the host `CLAUDE.md` and forces inline output, so the baseline reflects a default assistant rather than one shaped by the local `CLAUDE.md` or a file-writing tool. (The per-machine `settings.json` hooks/plugins still load, but apply equally to every arm.) Full methodology in [`benchmarks/README.md`](./benchmarks/README.md).

## Mechanics

1. `/scrooge [lang] [dial]` activates a mode. Tokens compose on two independent axes — `/scrooge ko`, `/scrooge full`, `/scrooge ko lite`, etc.
2. The `UserPromptSubmit` hook parses the command, persists `{lang, dial}` to a state file, looks up the rule via [`registry.json`](registry.json), and injects it as `additionalContext`.
3. Every subsequent turn reinjects a lightweight reminder so the register does not drift.
4. `/scrooge off` clears state and the global default (global off — see below). Auto-clarity contexts inside the rule itself drop compression for safety-critical replies — security warnings, irreversible-action confirmations, ambiguous multi-step sequences — without the user having to opt out.

**Global default.** Activating in any session saves the choice as a global default (`~/.claude/.scrooge-default`), so every new session auto-activates with the same lang/dial/flags — set it once, anywhere. The `SessionStart` hook seeds a fresh session from the default and re-injects the full rule. `/scrooge off` clears the default too (global off); a session already running keeps its register until it restarts, so an off in one worktree never yanks a concurrent one.

**Flags.** Beyond lang/dial, two behavior flags compose orthogonally. `lean` (minimal code output) is **on by default** — `/scrooge` cuts ~21% more by trimming over-engineering and narration, never correctness (its fragment pins the safety floor). `ctx` (context economy) is **opt-in**. Toggle per session with `/scrooge … nolean` / `ctx`, or globally via `SCROOGE_DEFAULT_FLAGS` (a comma-separated set, or empty to disable all); `max` enables both. Each active flag appends its register fragment (`rules/{lang}/fragments/{flag}.md`) to the injected rule.

**Adding a language**:

1. Author `rules/{lang}/{lite,full}.md`.
2. Add one entry to [`registry.json`](registry.json):

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

3. Sample 5 outputs against the QA checklist (see [CONTRIBUTING.md](CONTRIBUTING.md)) and PR.

## Compared to caveman

[caveman](https://github.com/JuliusBrussee/caveman) inspired the project. Scrooge is not a fork or README/code copy; it is an independent, KO-first implementation with caveman kept as an explicit benchmark/reference point. If you came here looking for a **caveman alternative** — or a **Korean caveman** — that is the niche: the same token-miser idea, rebuilt Korean-first rather than translated.

| Axis                       | caveman                                    | Scrooge                                                      |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Primary target             | Aggressive English compression             | Korean-native bilingual compression                          |
| Languages                  | EN (+ wenyan classical Chinese)            | KO, EN; i18n via `registry.json`                             |
| Korean register            | None                                       | Native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default        |
| English result in this run | `1264` median tokens                       | Stronger compression (`969` median tokens), wins ~23% on the clean run |
| Benchmarking here          | Comparison arm (`caveman:full`)            | Real `output_tokens` runner, paired reports                  |

In short: Scrooge should not read like caveman with Korean bolted on. The point is Korean-first register design, while still acknowledging caveman as the source of inspiration and the strongest English comparison baseline.

## Contributing

Development setup, parity rules, language-addition steps, PR checks, and branch protection guidance live in [CONTRIBUTING.md](CONTRIBUTING.md). 한국어 기여 가이드는 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md).

## License

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
