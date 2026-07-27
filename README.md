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
  English · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a>
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

KO-first pentalingual (KO/EN/JA/HI/ZH) output-compression skill for AI coding agents — full on [Claude Code](https://docs.anthropic.com/en/docs/claude-code), hook + stats on Codex, skill-only on Cursor, Windsurf, Cline, Continue, Gemini CLI (see [Host support](#host-support)). The Korean register is designed around its own grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), **not** translated from English compression rules.

**`~70% KO · ~66% EN · ~70% JA · ~66% HI · ~63% ZH · output-only · honorifics stripped`** — `claude-opus-4-8`; KO/EN/JA N=16–25 paired median, HI/ZH held-out N=11.

<p align="center">
  <a href="#benchmarks"><img src="assets/benchmark.svg" alt="Median output tokens per turn (claude-opus-4-8, paired median): Korean scrooge:ko/full 1042 vs normal 3413 (−70%); English scrooge:en/full 816 vs normal 2397 (−66%)" width="760"></a>
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

**Update.** Re-running the quick-start updates every detected host in place — Scrooge is safe to re-run. On Claude Code the installer now refreshes the marketplace and runs `claude plugin update` (restart Claude to apply) instead of skipping; Codex and skill-only hosts overwrite their payload on re-run. To pin a specific version instead of latest, use the same `--tag`/`#ref` as above. Scrooge also checks GitHub once a day and, when a newer release exists, hints at session start (plus an `↑vX` statusline marker on Claude) — opt out with `SCROOGE_NO_UPDATE_CHECK=1`, or check on demand with `scrooge --version`.

Detailed setup, Claude Code plugin install, Codex `skills` install, troubleshooting, and uninstall steps live in [INSTALL.md](INSTALL.md). 한국어 설치 문서는 [INSTALL.ko.md](INSTALL.ko.md).

**Activate.** `/scrooge ko full` (or `/scrooge en lite`, `/scrooge ja full`, etc.) turns the register on. `/scrooge off` clears state. `scrooge --help` lists every flag. On the Claude Code hook, plain language works too — "talk like scrooge" / "스크루지처럼 답해줘" / "スクルージみたいに答えて" activates, "stop scrooge" / "스크루지 꺼" clears. A negation ("don't talk like scrooge" / "스크루지처럼 말하지 마") is ignored.

### Host support

The installer sets up each detected host at its capability tier:

| Host | Install | Reinject hook | Stats | Statusline |
| ---- | ------- | :-----------: | :---: | :--------: |
| Claude Code | plugin | ✓ | ✓ | ✓ |
| Codex | skills + `config.toml` hook | ✓ | ✓ | — |
| Cursor · Windsurf · Cline · Continue · Gemini CLI | skills (skill-only) | — | — | — |

Skill-only hosts get the register rule as a skill, but activation is manual — no per-turn reinject hook and no token stats. The full hook + stats + statusline experience is Claude Code; Codex gets the hook + stats via `~/.codex/config.toml`. Codex wires only `UserPromptSubmit` (no `SessionStart`), so its update notice and `↑vX` marker are Claude-only and upgrades are a reinstall — see [Update](INSTALL.md#update) in INSTALL.md.

## Surface

| Component                | What                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/scrooge [lang] [dial]` | Activate a register. Two axes — `ko`/`en`/`ja`/`hi`/`zh` × `lite`/`full`. Persists per session, and is saved as a global default that auto-activates new sessions.                                                                 |
| `/scrooge … [flag]`      | Behavior flag orthogonal to the dial: `lean` (minimal code output) is **on by default** (~21% less code). Toggle with `nolean` (per session) or `SCROOGE_DEFAULT_FLAGS` (global). |
| `/scrooge off`           | Clear state + the global default (global off), return to normal prose.                                                                                                             |
| Natural language (hook)  | "talk like scrooge" / "스크루지처럼 답해줘" / "スクルージみたいに答えて" / "स्क्रूज की तरह जवाब दो" / "像斯克鲁奇一样回答" activates; "stop scrooge" / "스크루지 꺼" clears. Negations ignored; slash wins. Language from the phrase, dial `full`. |
| `UserPromptSubmit` hook  | Reinjects the register every turn so the dial does not drift.                                                                                    |
| Safety auto-clarity      | Rules drop compression for security warnings, irreversible-action confirmations, and ambiguous multi-step sequences. Every language, every dial. |
| `registry.json`          | Maps `language × dial → rule file path` 1:1, and the key list is the source `VALID_LANGS` derives from. Adding a language = one rule file + one registry entry + one `hooks/lang-meta.js` row.    |
| `scrooge-stats` skill    | Discoverable stats surface for Claude/Codex. Reports measured input + output tokens from the session JSONL; never asks the model to estimate.    |
| Token-savings statusline | Actual session output tokens from the Claude Code session JSONL — not tokenizer estimates.                                                       |
| CLI benchmark harness    | Reproducible runner (`benchmarks/run.py`) — see [`benchmarks/`](./benchmarks/).                                                                  |

**Why Korean matters.** Most output-compression skills are English-first or assume Classical Chinese as the only non-English target. Scrooge treats Korean as a first-class language — the register is designed around Korean grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), not translated from English. The architecture is i18n pluggable, so the rule engine loads any language from `registry.json` with no surgery. Japanese ships as the third language, mapping the Korean mechanism (keigo stripping · 体言止め · 助詞 drop) rather than translating English; CJK token inefficiency makes it a natural compression target. Hindi ships as the fourth, mapping the same mechanism (honorific leveling · noun-stop endings · postposition drop) onto Devanagari, another token-inefficient script. Chinese ships as the fifth — but unlike JA/HI, it is **not** a port of the Korean mechanism: Chinese is an isolating language with no honorific morphology or case particles to strip, so its register is a **zh-native** design (drop politeness `请`/`您`, conservatively drop redundant structural particles `的`/`了`/`着` and measure words, cut connective filler), modern concise prose rather than caveman's wenyan.

## Benchmarks

Measured on **`claude-opus-4-8`**. Full methodology and raw reproduction commands live in [`benchmarks/`](./benchmarks/). Every headline number below is backed by scrubbed raw rows under [`benchmarks/published/`](./benchmarks/published/) — recompute the medians yourself; per-file model, register version, and measurement date are in the [provenance manifest](./benchmarks/published/README.md).

**Measurement conditions** (read before quoting the numbers):

- **N=21–25 prompts × 1 run, paired median.** Single-run results; no variance estimate (a few prompts dropped on subscription timeouts). Re-running can shift any single cell by a few percent. Treat headline percentages as one-significant-figure estimates (`~70%`, not "69.5% exactly").
- **Register-clean run.** Both register hooks (scrooge's own activation hook and caveman) are neutralized for the benchmark so they cannot inject into the `normal`/`terse` baseline; token counts are deduped by `message.id` (prose-only basis). An earlier run whose baseline was silently compressed by the host's scrooge hook was discarded.
- **Held-out cross-check.** Re-measured on a held-out prompt set (`prompts/{ko,en,ja,hi}-report.txt`, disjoint from the tuning corpus): KO ~71%, EN ~68%, JA ~65%, HI ~63% (N=11 each; HI per-prompt median 67%). Consistent with the headline above, so the savings are not an artifact of overfitting to the tuning prompts. HI is held-out-only — no separate tuning corpus measured yet. Raw rows: [`benchmarks/published/`](./benchmarks/published/).
- **Register-only isolation.** The harness runs each arm under `claude --print --system-prompt <rule>`, which _replaces_ Claude Code's default system prompt. This isolates the register effect cleanly, but real `/scrooge` sessions keep Claude Code's full system prompt alongside the injected register, so real savings versus a real verbose session may differ from the headline. On register **retention**, real multi-turn sessions now have direct evidence: a drift analysis over dogfood sessions (134 conclusive of 372 scrooge-active, 2026-07, [`benchmarks/session-evidence/`](./benchmarks/session-evidence/)) shows the register holds across turns — late-session prose output stayed flat vs early turns (median late/early ratio 0.85, 77% of conclusive sessions retained). Retention only: real-session _savings_ still cannot be measured (no verbose counterfactual, ADR-003). See [`benchmarks/README.md`](./benchmarks/README.md) for the full caveat list.
- **Real `output_tokens`, not tokenizer estimates.** Numbers come from the Claude Code session JSONL's `output_tokens` field — what the API actually billed.

### Korean

`normal` is the model default; `terse` is a control prompt ("answer concisely"); `scrooge:*` is the rule we ship. `caveman:full` is a comparison baseline, not a Scrooge mode.

| Mode                  | Median output tokens (N=21) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        3413 |          (baseline) |
| `terse`               |                        2242 |                ~34% |
| **`scrooge:ko/full`** |                    **1042** |            **~70%** |
| `caveman:full`        |                        1005 |                ~71% |

`scrooge:ko/full` cuts Korean output by **~70%** vs the verbose default, and beats the `terse` control — so the gain is the register itself, not just generic brevity. `caveman:full` lands at a similar token count (**1005** vs **1042**), but it gets there by breaking grammar and dropping information, where scrooge keeps the answer intact — the axis is that fidelity gap, not raw tokens. Fidelity (held-out, judge N=3): **0.68 median claim-preservation, safety preserved 12/16** — the loss is breadth (secondary detail dropped under heavier compression), not wrong information; the core technical answer and safety prose are preserved. Raw rows: [`results-ko-clean-opus48.jsonl`](./benchmarks/published/results-ko-clean-opus48.jsonl) (v0.19.1).

### English

| Mode                  | Median output tokens (N=25) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        2397 |          (baseline) |
| `terse`               |                        1803 |                ~25% |
| **`scrooge:en/full`** |                     **816** |            **~66%** |
| `caveman:full`        |                         703 |                ~71% |

`scrooge:en/full` cuts English output by **~66%** vs the verbose default and beats the `terse` control. `caveman:full` is smaller in raw tokens (**703** vs **816**) because it compresses telegraphically, discarding information; scrooge trades those tokens to keep the answer intact — the fidelity gap is the point. Fidelity (held-out, judge N=3): **0.72 median claim-preservation, safety preserved 9/11** — higher claim retention than JA; the loss is breadth (secondary detail under heavier compression), not wrong information; the core technical answer and safety prose are preserved. Raw rows: [`results-en-clean-opus48.jsonl`](./benchmarks/published/results-en-clean-opus48.jsonl) (v0.19.1).

**Mini English sample (`en/full`)**

> Explain why a database index speeds up reads and slows down writes.

```text
Index = extra lookup structure.

Reads: planner searches index keys, then fetches matching rows; avoids full table scan when predicate is selective.
Writes: INSERT/UPDATE/DELETE must maintain index pages, maybe split/rebalance B-tree, write more WAL, and consume cache/disk.

Tradeoff: add indexes for hot selective reads; avoid redundant indexes on write-heavy tables.
```

### Japanese

`scrooge:ja/full` maps the Korean mechanism onto Japanese — keigo stripping, 体言止め (noun-stop endings), 助詞 (particle) drop — while keeping kanji as normal orthography (the inverse of KO's Hangul-only rule).

| Mode                  | Median output tokens (N=15) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        2930 |          (baseline) |
| `terse`               |                        1551 |                ~47% |
| **`scrooge:ja/full`** |                     **877** |            **~70%** |

`scrooge:ja/full` cuts Japanese output by **~70%** vs the verbose default, and beats the `terse` "answer concisely" control by **+43%** (15/15 prompt wins) — so the gain is the register, not generic brevity. Held-out cross-check (`prompts/ja-report.txt`, N=11): **~65%**. Fidelity (held-out, judge N=3): **0.60 median claim-preservation, 0 corruption, safety preserved 11/11** — the loss is breadth (secondary detail dropped under heavier compression), not wrong information; the core technical answer and safety prose are preserved. Raw rows: [`results-ja-report.jsonl`](./benchmarks/published/results-ja-report.jsonl) · [`results-ja-fidelity.jsonl`](./benchmarks/published/results-ja-fidelity.jsonl).

> **Measurement note**: the `normal` baseline is measured with host memory files (`~/.claude/CLAUDE.md`, project `CLAUDE.local.md`) isolated, so it answers in the prompt's language (Japanese) — otherwise a host "respond in Korean" instruction makes the baseline answer in Korean, whose different token efficiency inflates the savings.

### Hindi

`scrooge:hi/full` maps the Korean mechanism onto Hindi — honorific leveling (`कीजिए` → `करो`), noun-stop / verbal-noun endings, and optional postposition drop (`को`/`में`/`से`; the `ने` ergative marker is kept, since dropping it can shift meaning) — while keeping a Devanagari body with English technical terms code-mixed verbatim.

| Mode                  | Median output tokens (held-out N=11) | Savings vs `normal` |
| --------------------- | -----------------------------------: | ------------------: |
| `normal`              |                                 2436 |          (baseline) |
| **`scrooge:hi/full`** |                              **897** |            **~63%** |

`scrooge:hi/full` cuts Hindi output by a **66.6% per-prompt median** (ratio of medians ~63%) vs the verbose default, smaller on **11/11** held-out prompts. Fidelity (held-out, judge N=3): **0.76 median claim-preservation, safety preserved 10/11** — better claim retention than JA; the single safety-check miss is a heuristic false-positive on a rate-limiting prompt with no security/irreversible content (the compressed answer keeps its technical caveat), and the loss elsewhere is breadth, not wrong information. Measured held-out only — no separate tuning corpus yet, so no `normal`/`terse`/`scrooge` tuning table like the others. Raw rows: [`results-hi-report.jsonl`](./benchmarks/published/results-hi-report.jsonl) · [`results-hi-fidelity.jsonl`](./benchmarks/published/results-hi-fidelity.jsonl).

> **Measurement note**: same cwd-isolation as Japanese — the `normal` baseline runs with host memory files (`~/.claude/CLAUDE.md`) isolated so it answers in Hindi, not the host "respond in Korean" default, which would otherwise inflate the savings.

### Chinese

`scrooge:zh/full` is a **zh-native** register, not a port of the Korean mechanism: Chinese is an isolating language with no honorifics or case particles to strip, so it drops politeness (`请`/`您`), conservatively drops redundant structural particles (`的`/`了`/`着`) and measure words, and cuts connective filler — keeping a Simplified-Chinese body with English technical terms code-mixed verbatim. Modern concise prose, not caveman's wenyan.

| Mode | Median output tokens (held-out N=11) | Savings vs `normal` |
| --- | ---: | ---: |
| `normal` | 2703 | (baseline) |
| **`scrooge:zh/full`** | **897** | **~67%** |

`scrooge:zh/full` cuts Chinese output by a **62.9% per-prompt median** (ratio of medians ~67%) vs the verbose default, smaller on **11/11** held-out prompts. Fidelity (held-out, judge N=3): **0.72 median claim-preservation, safety preserved 11/11** — higher claim retention than JA and no safety miss; the loss is breadth (secondary detail dropped under heavier compression), not wrong information (0 fully-equivalent is the expected independent-generation signal, not corruption). Measured held-out only — no separate tuning corpus yet, so no `normal`/`terse`/`scrooge` tuning table like the others. Before/after: [`benchmarks/examples/zh-foreach-async.*`](./benchmarks/examples/) (`normal` 1221 → `scrooge` 466 tokens, same forEach-async diagnosis). Raw rows: [`results-zh-report.jsonl`](./benchmarks/published/results-zh-report.jsonl) · [`results-zh-fidelity.jsonl`](./benchmarks/published/results-zh-fidelity.jsonl).

> **Measurement note**: same cwd-isolation as Japanese/Hindi — the `normal` baseline runs with host memory files (`~/.claude/CLAUDE.md`) isolated so it answers in Chinese, not the host "respond in Korean" default, which would otherwise inflate the savings.

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

**Global default.** Activating in any session saves the choice as a global default (`~/.claude/.scrooge/default`), so every new session auto-activates with the same lang/dial/flags — set it once, anywhere. The `SessionStart` hook seeds a fresh session from the default and re-injects the full rule. `/scrooge off` clears the default too (global off); a session already running keeps its register until it restarts, so an off in one worktree never yanks a concurrent one.

**Flags.** Beyond lang/dial, a behavior flag composes orthogonally. `lean` (minimal code output) is **on by default** — `/scrooge` cuts ~21% more by trimming over-engineering and narration, never correctness (its fragment pins the safety floor). Toggle per session with `/scrooge … nolean`, or globally via `SCROOGE_DEFAULT_FLAGS` (a comma-separated set, or empty to disable all). Each active flag appends its register fragment (`rules/{lang}/fragments/{flag}.md`) to the injected rule.

**Adding a language** (registry-driven dispatch — data, not new branches):

1. Author `rules/{lang}/{lite,full}.md`.
2. Add one entry to [`registry.json`](registry.json) — `VALID_LANGS` derives from these keys, so the slash parser and rule loader pick up the language with no code edit:

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

3. Add one `LANG_META` row in [`hooks/lang-meta.js`](hooks/lang-meta.js) — `reminder`, `countermand`, `flagHint`, and `nlCue` — which drives the per-turn reminder, the off countermand, and natural-language activation. `test_registry_parity.js` fails if a registry language has no row.
4. Sample 5 outputs against the QA checklist (see [CONTRIBUTING.md](CONTRIBUTING.md)) and PR.

## Compared to caveman

[caveman](https://github.com/JuliusBrussee/caveman) inspired the project. Scrooge is not a fork or README/code copy; it is an independent, KO-first implementation with caveman kept as an explicit benchmark/reference point. If you came here looking for a **caveman alternative** — or a **Korean caveman** — that is the niche: the same token-miser idea, rebuilt Korean-first rather than translated.

| Axis                       | caveman                                    | Scrooge                                                      |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Primary target             | Aggressive English compression             | Korean-native bilingual compression                          |
| Languages                  | EN (+ wenyan classical Chinese)            | KO, EN; i18n via `registry.json`                             |
| Korean register            | None                                       | Native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default        |
| English result in this run | `703` median tokens (telegraphic, lossy)   | `816` median tokens — a few more, but the answer is preserved (fidelity 0.72) |
| Benchmarking here          | Comparison arm (`caveman:full`)            | Real `output_tokens` runner, paired reports                  |

In short: Scrooge should not read like caveman with Korean bolted on. The point is Korean-first register design, while still acknowledging caveman as the source of inspiration and the strongest English comparison baseline.

## Contributing

Development setup, parity rules, language-addition steps, PR checks, and branch protection guidance live in [CONTRIBUTING.md](CONTRIBUTING.md). 한국어 기여 가이드는 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md).

## License

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
