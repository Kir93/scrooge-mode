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
  <a href="#compared-to-caveman">Compared to caveman</a> ·
  <a href="#mechanics">Mechanics</a>
</p>

---

> Output-compression skill for AI coding agents — same answer, fewer tokens on every reply.

KO-first pentalingual (KO/EN/JA/HI/ZH) output-compression skill for AI coding agents: full on [Claude Code](https://docs.anthropic.com/en/docs/claude-code), hook + stats on Codex, skill-only on Cursor, Windsurf, Cline, Continue, Gemini CLI (see [Host support](#host-support)). The Korean register is designed around its own grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default), **not** translated from English compression rules.

**`~60% KO · ~55% EN · ~62% JA · ~63% HI · ~65% ZH · single-turn chat prose · output-only`** — `claude-opus-5-5`, held-out corpus, ratio of paired medians, N=10–19; lower than on `claude-opus-4-8` (~70/68/65/63/67% held-out). **Not an agentic-session figure** — agentic work is measured separately (52% total-output savings on a 10-task corpus; the register reaches ~14–30% of billed output in real sessions). [Measurement conditions](#benchmarks).

<p align="center">
  <a href="#benchmarks"><img src="https://raw.githubusercontent.com/Kir93/scrooge-mode/main/assets/benchmark.svg" alt="Median output tokens per turn (claude-opus-5-5, held-out corpus, paired median, N=19): Korean scrooge:ko/full 844 vs normal 2097 (−60%); English scrooge:en/full 665 vs normal 1476 (−55%)" width="760"></a>
</p>

## Demo

Same prompt, same Claude model, actual benchmark output. The prompt is Korean and the responses are Korean — this is a deliberate demo of the `ko/full` register, Scrooge's first-class target. See [`benchmarks/prompts/en.txt`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/prompts/en.txt) for the English-prompt corpus.

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

## Why a register, not a setting

No parameter or hook does this, and the vendor says so. The one setting that comes close, Claude Code's `Concise` output style, compresses less.

- **Anthropic documents the problem and prescribes this exact remedy.** The Opus 5 prompting guide records three verbosity regressions on what is now Claude Code's default model — longer user-facing responses, longer per-message output in agentic sessions, and longer files written to disk — and its prescribed fix is a **prompt-level brevity register**, down to recommended text (`<tone_preference>Keep outputs reasonably concise.</tone_preference>`). Scrooge is a measured, multilingual, safety-gated implementation of the mechanism Anthropic itself recommends.
- **No parameter does it.*_ The Messages API has no `verbosity` parameter (`output_config` is `effort` + `format` + `task_budget`). The effort doc states outright that on Opus 5 _"changing effort does not reliably shorten responses, so prompt for length instead."_ `max_tokens` truncates rather than compresses, and `task_budget` is explicitly unsupported on Claude Code.
- **No hook does it either.** `MessageDisplay` changes only what is rendered on screen — the transcript and what Claude sees keep the original text, so it cannot reduce a billed token. The request for a hook that _could_ (`updatedAssistantMessage` / `PreRender`, anthropics/claude-code#61152) was closed as duplicate. **System-prompt-level instruction is the only lever that actually reduces billed output.** That is why Scrooge injects on `UserPromptSubmit` — and why it bills that injection back to you as input in `/scrooge-stats` instead of pretending it is free.
- **Claude Code's terse output style is lighter.** Claude Code 2.1.237 added a built-in `Concise` output style. On the same corpus (chat-prose, `append` mode) Scrooge's answers are 17–29% shorter than Concise's, with no measurable difference in claim-preservation — see [Compared to Claude Code's Concise style](#compared-to-claude-codes-concise-style). The other two shipped styles, Explanatory and Learning, are documented to make output _longer_; `/output-style` itself was removed in v2.1.91.

## Install

Recommended quick-start:

```bash
npx -y github:Kir93/scrooge-mode
```

Pin a released version for reproducible installs (swap the tag for the release you want):

```bash
npx -y github:Kir93/scrooge-mode#vX.Y.Z
```

**Update.** Re-running the quick-start updates every detected host in place. Scrooge is safe to re-run. On Claude Code the installer now refreshes the marketplace and runs `claude plugin update` (restart Claude to apply) instead of skipping; Codex and skill-only hosts overwrite their payload on re-run. To pin a specific version instead of latest, use the same `--tag`/`#ref` as above. Scrooge also checks GitHub once a day and, when a newer release exists, hints at session start (plus an `↑vX` statusline marker on Claude) — opt out with `SCROOGE_NO_UPDATE_CHECK=1`. To check or update on demand, re-run the quick-start above — it is idempotent.

Detailed setup, Claude Code plugin install, Codex `skills` install, troubleshooting, and uninstall steps live in [INSTALL.md](https://github.com/Kir93/scrooge-mode/blob/main/INSTALL.md). 한국어 설치 문서는 [INSTALL.ko.md](https://github.com/Kir93/scrooge-mode/blob/main/INSTALL.ko.md).

**Activate.** `/scrooge ko full` (or `/scrooge en`, `/scrooge ja`, etc.) turns the register on. `/scrooge off` clears state. `npx -y github:Kir93/scrooge-mode -- --help` lists every flag. On the Claude Code hook, plain language works too — "talk like scrooge" / "스크루지처럼 답해줘" / "スクルージみたいに答えて" activates, "stop scrooge" / "스크루지 꺼" clears. A negation ("don't talk like scrooge" / "스크루지처럼 말하지 마") is ignored, and so is a cue inside a long prompt: plain language fires only on a short standalone prompt (≤80 code points), so a pasted log that mentions "stop scrooge" never toggles. The bare noun "scrooge mode" / "스크루지 모드" activates only as (nearly) the whole prompt — a topic mention inside a request ("update the scrooge mode section") does not; verb forms ("enable scrooge", "스크루지 모드로 답해줘") work anywhere.

### Host support

The installer sets up each detected host at its capability tier:

| Host | Install | Reinject hook | Stats | Statusline |
| ---- | ------- | :-----------: | :---: | :--------: |
| Claude Code | plugin | ✓ | ✓ | ✓ |
| Codex | skills + `config.toml` hook | ✓ | ✓ | — |
| Cursor · Windsurf · Cline · Continue | skills (skill-only) | — | — | — |
| Gemini CLI (**opt-in**, `--only gemini`) | skills (skill-only) | — | — | — |

**One `SKILL.md`, seven runtimes.** Agent Skills is an open standard under the Agentic AI Foundation (Linux Foundation) requiring only `name` and `description`, with runtimes mandated to ignore frontmatter keys they do not recognize — and [`plugin/skills/scrooge/SKILL.md`](plugin/skills/scrooge/SKILL.md) carries exactly those two fields. That makes all seven — Claude Code, Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI — reachable from one file; the table above is about how much _automation_ wraps it per host, not about how many ports exist. Reach is what the standard buys, not what we measured: every row under [`benchmarks/published/`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks/published) is Claude, the Codex rows are stale — pre-opus48, a different harness and tokenizer, and that harness was [removed in v0.23.0](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#codex-secondary-benchmark--removed-in-v0230) — so none of them is published, and the five skill-only hosts have no row at all. They rest on the spec argument above.

What the tiers mean: skill-only hosts load the register but activation is manual — no per-turn reinject hook, no token stats. Codex wires only `UserPromptSubmit` (no `SessionStart`), so its update notice and `↑vX` marker are Claude-only and upgrades are a reinstall (see [Update](https://github.com/Kir93/scrooge-mode/blob/main/INSTALL.md#update)). The statusline `✓` is narrower than it looks: it is wired by the one-line installer, and **the `/plugin install` path does not wire it** — see [INSTALL.md](https://github.com/Kir93/scrooge-mode/blob/main/INSTALL.md#statusline) for the manual `settings.json` entry.

**Inside Claude.** Hooks run only in Claude Code. On claude.ai, desktop chat, and Cowork the plugin loads as a skill alone:

| Surface | Loads | Activation | Reinject hook | Stats | Statusline |
| ------- | ----- | ---------- | :-----------: | :---: | :--------: |
| Claude Code (CLI · desktop Code tab · IDE) | skills + hooks | `/scrooge` or plain language, persists across sessions | ✓ | ✓ | ✓ |
| claude.ai · desktop chat · Cowork | skill only | ask in each conversation | — | — | — |

For a host not in the table, the standard's convergent location is `~/.agents/skills/` — which is where `npx skills add … -g` already writes, on the same spec argument as the five above.

## Surface

| Component                | What                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/scrooge [lang] [dial]` | Activate a register. Language axis — `ko`/`en`/`ja`/`hi`/`zh`; dial is `full`. Persists per session, and is saved as a global default that auto-activates new sessions. `full` is the only dial: `lite` shipped through v0.22.1, was measured, and lost on **both** axes — less compression _and_ less preservation than `full` — so v0.23.0 removed it rather than keep shipping a dial its own benchmark rejected ([measurement](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#the-lite-dial--measured-then-removed)). Saved state naming `lite` migrates to `full`. |
| `/scrooge … [flag]`      | Behavior flag orthogonal to the dial: `lean` (minimal code output) is **on by default** (~+18% on top of `full` in both KO and EN, est — provenance and reproduce command in [`benchmarks/README.md`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#the-lean-flag-numbers)). Toggle with `nolean` (per session) or `SCROOGE_DEFAULT_FLAGS` (global). |
| `/scrooge off`           | Clear state + the global default (global off), return to normal prose. The session keeps an off marker, so it stays off — on resume too, for up to 14 days — even if another session turns the default back on; activating again in that session turns it back on. |
| Natural language (hook)  | "talk like scrooge" / "스크루지처럼 답해줘" / "スクルージみたいに答えて" / "स्क्रूज की तरह जवाब दो" / "像斯克鲁奇一样回答" activates; "stop scrooge" / "스크루지 꺼" clears. Short standalone prompts only (≤80 code points); the bare noun "scrooge mode" / "스크루지 모드" activates only as (nearly) the whole prompt, not as a topic inside a request; negations ignored; slash wins. Dial `full`; language from the phrase only when nothing is saved yet — with a session state or global default, it keeps that language (change it with `/scrooge <lang>`). |
| `UserPromptSubmit` hook  | Reinjects the register every turn so the dial does not drift.                                                                                    |
| Safety auto-clarity      | Rules drop compression for security warnings, irreversible-action confirmations, and ambiguous multi-step sequences. Every language. **Measured:** on false-premise questions KO debunks 20/20 and EN 10/10 on `claude-opus-5-5`, matching an uncompressed baseline of 20/20 and 10/10 — but the earlier KO miss still reproduces when that prompt is re-judged on the original judge, so no safety claim is made ([detail](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#re-run-on-claude-opus-5-5-2026-10-07)). |
| Boundaries               | Compression scope. Code, commit messages, and PR descriptions are permanently excluded — compression breaks syntax. Docs / prose artifacts the model generates (READMEs, specs, reports, and drafts you will send onward — Slack, DM, email) **are** compressed: padding stripped, information and tone lossless. **Measured:** the exclusion held across a 20-turn hooked session past a compaction — 0/7 excluded artifacts came out compressed, with the register verified live on every liveness control turn ([detail](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#register-persistence-boundary-survival), rows: [`results-ko-persistence.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-ko-persistence.jsonl)). |
| `plugin/registry.json`   | Maps `language × dial → rule file path` 1:1, and the key list is the source `VALID_LANGS` derives from. Adding a language = two rule files (`full` + the `lean` fragment) + two registry entries + one `plugin/hooks/lang-meta.js` row.    |
| `scrooge-stats` skill    | Discoverable stats surface for Claude/Codex. Reports measured input + output tokens from the session JSONL; never asks the model to estimate. The savings estimate (and the ledger entry) covers only prose emitted after activation, shown as a `since activation` line. Self overhead counts the full register once per `SessionStart` injection plus one reminder per user prompt; after a mid-session activation it counts only what fired from activation on — the full register once at the activating prompt, again per later `SessionStart` and per register-change `/scrooge` set, and one reminder per other later prompt. |
| Token-savings statusline | Actual session output tokens from the Claude Code session JSONL — not tokenizer estimates.                                                       |
| CLI benchmark harness    | Reproducible runner (`benchmarks/run.py`) — see [`benchmarks/`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks).                                                                  |

**Why Korean matters.** There is an economic reason as well as a grammatical one: Claude's tokenizer charges Korean about **1.88x** the tokens of equivalent English text, against 1.38x on OpenAI's o200k — so the per-language argument is strongest on precisely the host where Scrooge runs at full tier. Most output-compression skills are English-first or assume Classical Chinese as the only non-English target. Scrooge treats Korean as a first-class language, with the register designed around Korean grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default). It is not translated from English. The architecture is i18n pluggable, so the rule engine loads any language from `registry.json` with no surgery. Japanese ships as the third language, mapping the Korean mechanism (keigo stripping · 体言止め · 助詞 drop) rather than translating English. CJK token inefficiency makes it a natural compression target. Hindi ships as the fourth, mapping the same mechanism (honorific leveling · noun-stop endings · postposition drop) onto Devanagari, another token-inefficient script. Chinese ships as the fifth, but unlike JA/HI it is **not** a port of the Korean mechanism: Chinese is an isolating language with no honorific morphology or case particles to strip, so its register is a **zh-native** design (drop politeness `请`/`您`, conservatively drop redundant structural particles `的`/`了`/`着` and measure words, cut connective filler). It is modern concise prose rather than caveman's wenyan.

## Benchmarks

The headline is measured on **`claude-opus-5-5`** (the `opus` alias; held-out corpus, register v0.27.0, 2026-09-28) — [table below](#headline-claude-opus-5-5-held-out). The per-language tables after it are the prior **`claude-opus-4-8`** measurement, kept because the caveman comparison exists only on that pin. Full methodology and raw reproduction commands live in [`benchmarks/`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks). Every headline number below is backed by scrubbed raw rows under [`benchmarks/published/`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks/published), so you can recompute the medians yourself. Per-file model, register version, and measurement date are in the [provenance manifest](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/README.md).

**Measurement conditions** (read before quoting the numbers):

- **Chat-prose workload only — this is the biggest limitation here.** Every published row has `tool_use_output_tokens: 0` and `turns: 1`: the corpus is single-turn conversational Q&A with no tool calls. In a real agentic session the register only reaches the prose fraction of billed output, and that fraction is small — measured over 930 scrooge-active sessions of the maintainer's own transcripts, prose was **13.8% of billed output tokens pooled (4.87M of 35.3M), 29.5% in the median session** ([`session-evidence/`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks/session-evidence), committed as `reach.*` in [`results.json`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/session-evidence/results.json)). The rest is tool-call payload — diffs, file writes, exact error strings — that the register leaves verbatim by design. Whole-session savings in _your_ sessions are still not claimed — a real session has no verbose counterfactual (ADR-003). What is measured is a **separate agentic benchmark**: 10 held-out tasks over a fixed scratch repo, where `scrooge:en/full` cut total billed output by **52%** (paired median, 95% CI +38.7 to +55.8, smaller on 10/10, p=0.002) while using _more_ turns than the baseline, and where a spot check confirmed the work was actually completed. That corpus's prose share is 18.7%, between the pooled and median real-session figures above, so a heavier session has a lower ceiling by construction. For contrast, JetBrains measured **8.5%** for `caveman` across 86 of 87 SkillsBench tasks (~240 billed trials, quality statistically unchanged, 2026-07) — a much larger and heavier corpus. Both numbers, and why they differ: [Agentic workload](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#agentic-workload--measured).
- **N=10–19 prompts × 1 run, paired median.** Treat headline percentages as one-significant-figure estimates (`~60%`, not "59.8% exactly"). Each headline arm is smaller on **every** paired prompt (exact sign test p ≤ 0.002) and its 95% bootstrap CI stays above 50%, so the hedge is about the second digit, not about whether the effect is real. `report.py --paired` prints the interval, the sign test, and the resolvable-effect floor for any published file.
- **Tool-using rows are excluded, from every arm (changed in v0.23.0).** A handful of rows answered by calling tools instead of replying inline — 119 prose tokens beside 7,645 tool tokens, in one case. Scoring those against an inline answer on a prose-only basis is not like-for-like, so `--drop-tool-rows` discards the whole prompt/run key across all arms. This was previously a manual, ZH-only exclusion described in prose but missing from the printed reproduce command, which is why that command used to return different numbers than the table above it. **Disclosure: the excluded rows sat mostly in the `normal` baseline, so applying the rule moved two headlines up — EN 66%→67%, JA 64%→65%, plus KO held-out 71%→70% the other way.** The rule is the same in both directions; it just happened to favour us twice. On the `claude-opus-5-5` files it drops one ZH key (N 11→10), which moves ZH from +62.5% to +65.4% — in our favour a third time.
- **Register-clean run.** Both register hooks (scrooge's own and caveman) are neutralized so they cannot inject into the `normal`/`terse` baseline; tokens are deduped by `message.id` (prose-only basis).
- **Held-out headline.** The headline uses the held-out prompt sets (`prompts/{lang}-report.txt`), disjoint from the corpus the rules were tuned on. On the prior pin, `claude-opus-4-8`, the same held-out sets gave KO ~70%, EN ~68%, JA ~65%, HI ~63%, ZH ~67%. KO and EN matched that pin's tuning-corpus tables below, so the savings were not overfitting; JA/HI/ZH have no tuning table — their table below is that held-out measurement itself. Method and per-prompt medians: [`benchmarks/README.md`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#reproducing-a-published-number).
- **Register-only isolation.** Each arm runs under `claude --print --system-prompt <rule>`, which _replaces_ Claude Code's default system prompt. That isolates the register cleanly, but a real `/scrooge` session keeps the full system prompt alongside it, so real savings may differ from the headline. Register **retention** does have direct real-session evidence: a drift analysis over dogfood sessions (188 conclusive of 930 scrooge-active, 2026-08-05, [`benchmarks/session-evidence/`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks/session-evidence)) shows late-session prose output stayed flat vs early turns — median late/early ratio 0.83, 77% of conclusive sessions retained. The aggregate is committed as [`results.json`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/session-evidence/results.json) so those four numbers can be checked against a file. The private transcripts behind it are not third-party reproducible. Retention only — real-session _savings_ remain unmeasurable (no verbose counterfactual, ADR-003). Full caveat list: [`benchmarks/README.md`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md).
- **Real `output_tokens`.** Numbers come from the session JSONL's `output_tokens` field — what the API actually billed, not a tokenizer estimate.
- **The safety register was tested against false premises, and has one reproducible failure.** Brevity-emphasising instructions are known to cost hallucination resistance (Giskard Phare, 2025-04-30: up to 20%), so the register was tested on questions where the correct answer is to reject the question's own assumption. On `claude-opus-5-5`: EN 10/10 and KO 20/20 (judge N=3, unanimous), matching an uncompressed baseline of 10/10 and 20/20. The first run, on `claude-opus-4-8`, scored KO **19/20** against 19/19 (Fisher exact p=1.000); its one miss was unanimous, and a generic `terse` control passed the same prompt, so it is attributable to this register rather than to shortness. **That miss still reproduces**: re-judged on the original judge, the re-run's answer to that prompt fails again, so 20/20 reflects a more lenient judge rather than a fixed failure ([re-run](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#re-run-on-claude-opus-5-5-2026-10-07)). No safety claim is made from this, and the register was not edited — the failing prompt, its mechanism, and that reasoning: [False premises](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#false-premises--one-demonstrated-failure-no-measurable-deficit).
- **Re-measured on `claude-opus-5-5`, and the savings moved down.** Claude Code's default model became Opus 5 on 2026-07-24 (v2.1.219); the headline sat on `claude-opus-4-8` until the held-out corpus was re-run on `claude-opus-5-5` (2026-09-28, register v0.27.0). Against the `claude-opus-4-8` held-out run, savings fell from ~70/68/65/63/67% to ~60/55/62/63/65% (KO/EN/JA/HI/ZH; HI flat). The uncompressed `normal` baseline got **shorter** in every language (KO 2782→2097, EN 2546→1476, JA 2399→1529, HI 2436→1889, ZH 2703→1772 median tokens), proportionally more than `scrooge` output did. Model, register version (≈v0.7–v0.15 → v0.27.0), and host isolation all changed between the two runs, so the drop is not attributed to any one of them.

### Headline: `claude-opus-5-5` held-out

Held-out corpus (`prompts/{lang}-report.txt`), register v0.27.0, 2026-09-28. Each file also carries a same-run `@v0.26.0` arm; the headline is the unsuffixed v0.27.0 arm. Savings is the ratio of medians; the per-prompt column is the paired statistic the CI and sign test attach to.

| Register | `normal` | `scrooge` | Savings vs `normal` | Per-prompt median (95% CI) | N |
| -------- | -------: | --------: | ------------------: | -------------------------: | -: |
| `scrooge:ko/full` | 2097 | **844** | **~60%** | 63.7% (56.1–66.6%) | 19 |
| `scrooge:en/full` | 1476 | **665** | **~55%** | 59.8% (50.2–63.0%) | 19 |
| `scrooge:ja/full` | 1529 | **587** | **~62%** | 60.0% (57.0–73.1%) | 11 |
| `scrooge:hi/full` | 1889 | **705** | **~63%** | 61.8% (52.9–64.4%) | 11 |
| `scrooge:zh/full` | 1771.5 | **613** | **~65%** | 65.1% (57.1–72.2%) | 10 |

Reproduce: `python3 benchmarks/report.py --input benchmarks/published/results-{lang}-report-v027.jsonl --paired --drop-tool-rows`. Raw rows: [`results-{lang}-report-v027.jsonl`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks/published). No caveman arm was run on this pin.

### Korean

Prior pin: `claude-opus-4-8`, tuning corpus — the only pin with a `caveman:full` arm.

`normal` is the model default, `terse` a control prompt ("answer concisely"), `caveman:full` a comparison baseline — not a Scrooge mode.

| Mode                  | Median output tokens (N=21) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        3413 |          (baseline) |
| `terse`               |                        2242 |                ~34% |
| **`scrooge:ko/full`** |                    **1042** |            **~70%** |
| `caveman:full`        |                        1005 |                ~71% |

`scrooge:ko/full` cuts Korean output by **~70%** and beats the `terse` control, so the gain is the register, not generic brevity. `caveman:full` lands at a similar token count (**1005** vs **1042**) but breaks grammar to get there. On claim-preservation the two files' medians read 0.68 vs 0.60 — but both arms answered the same prompts, and **paired the difference is +0.01 with a 95% CI of −0.02 to +0.10 (8 wins, 4 ties, 4 losses)**. In Korean the two are not distinguishable on this corpus; the median gap was an artifact of comparing two samples separately instead of pairing them, and this repo quoted it as its stronger fidelity result through v0.22.1. Safety prose survives equally in both (12/16 each). See [caveman fidelity](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#caveman-fidelity--the-differentiation-measured). Fidelity (held-out, judge N=3): **0.68 median claim-preservation, safety preserved 12/16**, over the 16 rows with all three judge runs; the loss is breadth, not wrong information. On `claude-opus-5` as measured 2026-08-06 the same corpus read **0.42, safety 13/19** at a higher **+78.3%** saved — opus-5 applies the same rule text more aggressively, so it compresses harder and drops more claims doing it; see [Fidelity across model pins](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/README.md#fidelity-judge-scored-n3). **Superseded**: the v0.25.0 re-measure (same pin, same corpus, 2026-09-16) reads **0.53, safety 12/18** at **+60.4%** — less compression, more claims kept. What moved it is not established; see [the re-measure note](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/README.md#the-re-measure). Token rows: [`results-ko-clean-opus48.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-ko-clean-opus48.jsonl) (v0.19.1) · judge rows: [`results-ko-fidelity.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-ko-fidelity.jsonl) (opus-4-8) and [`results-ko-fidelity-opus5.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-ko-fidelity-opus5.jsonl) (opus-5).

### English

Prior pin: `claude-opus-4-8`, tuning corpus.

| Mode                  | Median output tokens (N=24) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        2344 |          (baseline) |
| `terse`               |                        1796 |                ~23% |
| **`scrooge:en/full`** |                     **773** |            **~67%** |
| `caveman:full`        |                         649 |                ~72% |

`scrooge:en/full` cuts English output by **~67%** and beats the `terse` control. `caveman:full` is smaller in raw tokens (**649** vs **773**). Both arms are now judged, and English is where the fidelity difference actually shows: scrooge is ahead on **9 of 11 prompts**, paired median **+0.09 (95% CI +0.04 to +0.11)**. That interval excludes zero, but the exact sign test at n=11 gives p=0.065, so read it as a consistent direction rather than an established result. Safety preservation is identical (9/11 each) — see [caveman fidelity](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#caveman-fidelity--the-differentiation-measured). Fidelity (held-out, judge N=3): **0.72 median claim-preservation, safety preserved 9/11** — higher claim retention than JA; the loss is breadth, not wrong information. On `claude-opus-5` as measured 2026-08-06 it read **0.50, safety 15/19** at **+71.7%** saved. English was the control that identified the cause: `rules/en/full.md` was byte-identical from v0.21.0 through v0.23.1, so a drop of that size with the register held fixed was the model pin, not a register regression — [the full argument](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/README.md#fidelity-judge-scored-n3). **Superseded**: the v0.25.0 re-measure reads **0.60, safety 16/19** at **+62.1%**. EN also stopped being an unmoved control in v0.25.0 (it gained one clause), and that re-measure does **not** establish what moved the numbers — see [the note](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/README.md#the-re-measure). Token rows: [`results-en-clean-opus48.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-en-clean-opus48.jsonl) (v0.19.1) · judge rows: [`results-en-fidelity.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-en-fidelity.jsonl) (opus-4-8) and [`results-en-fidelity-opus5.jsonl`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/results-en-fidelity-opus5.jsonl) (opus-5).

### Japanese, Hindi, Chinese

Prior pin: `claude-opus-4-8`. All three are held-out-only measurements (N=10–11, `prompts/{ja,hi,zh}-report.txt`), so there is no separate tuning table for them. JA and HI map the Korean mechanism onto their own grammar; ZH is a zh-native register rather than a port, because Chinese has no honorific morphology or case particles to strip.

| Register | `normal` | `scrooge` | Savings vs `normal` | Fidelity (judge N=3) |
| -------- | -------: | --------: | ------------------: | -------------------: |
| `scrooge:ja/full` | 2399 | **833** | **~65%** (per-prompt 69.6%) | 0.60, safety 11/11 |
| `scrooge:hi/full` | 2436 | **897** | **~63%** (per-prompt 66.6%) | 0.76, safety 10/11 |
| `scrooge:zh/full` | 2703 | **897** | **~67%** (per-prompt 62.9%) | 0.72, safety 11/11 |

Measured on `claude-opus-4-8`; a table keeps the model it was measured on. Re-run on `claude-opus-5` (2026-08-06, same corpus and N): JA **+77.4%** at 0.40 / safety 10-of-11, HI **+79.1%** at 0.42 / 10-of-11, ZH **+72.9%** at 0.40 / 11-of-11. **Superseded** by the v0.25.0 re-measure (same pin, 2026-09-16): JA **+51.1%** at 0.60 / 9-of-11, HI **+52.6%** at 0.60 / 9-of-11, ZH **+51.3%** at 0.55 / 10-of-11 — the trade runs the other way there, and the cause is not established ([note](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/published/README.md#the-re-measure)).

Per-register design notes, the measurement-isolation caveat each one needs, and the full fidelity readouts are in [`benchmarks/README.md` § Per-language detail](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#per-language-detail). Raw rows: [`results-{ja,hi,zh}-report.jsonl`](https://github.com/Kir93/scrooge-mode/tree/main/benchmarks/published) · fidelity rows alongside them, `-opus5` variants for the re-run.

### Document generation

The tables above measure conversational replies. Scrooge's doc-compression rule also targets **generated documents** (READMEs, specs, API references, release notes, runbooks), measured on a separate held-out corpus that pins the facts each arm must convey:

| Lang | `normal` | `terse` | `scrooge` | Median per-prompt savings | scrooge < `normal` |
| ---- | -------: | ------: | --------: | ------------------------: | :----------------: |
| Korean (N=10)  | 3554 | 2460 | **1420** | **~48%** | 10 / 10 |
| English (N=11) | 2772 | 1504 |  **852** | **~55%** | 11 / 11 |

scrooge was smaller than the verbose baseline on **every** prompt and beat the `terse` control on 9/10 (KO) and 11/11 (EN). These numbers are noisier than the conversational headline (single run, wide per-prompt spread), so treat them as estimates — the stable signal is the win-rate. Corpus, method, variance caveats, and before/after pairs: [`benchmarks/README.md` § Document generation](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#document-generation-corpus) and [`benchmarks/examples/docgen-results.md`](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/examples/docgen-results.md).

## Compared to caveman

[caveman](https://github.com/JuliusBrussee/caveman) inspired the project. Scrooge is not a fork or README/code copy; it is an independent, KO-first implementation with caveman kept as an explicit benchmark/reference point. If you came here looking for a **caveman alternative** or a **Korean caveman**, that is the niche: the same token-miser idea, rebuilt Korean-first rather than translated.

| Axis                       | caveman                                    | Scrooge                                                      |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Primary target             | Aggressive English compression             | Korean-native bilingual compression                          |
| Languages                  | EN (+ wenyan classical Chinese)            | KO, EN, JA, HI, ZH; i18n via `registry.json`                 |
| Korean register            | None                                       | Native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default        |
| English result (`claude-opus-4-8`) | `649` median tokens (telegraphic)          | `773` median tokens — a few more, for a modestly higher claim-preservation score |
| Fidelity, judged head-to-head (`claude-opus-4-8`) | 0.60 KO · 0.69 EN                          | 0.68 KO · 0.72 EN — but **paired**, KO is a tie (+0.01, CI spans zero) and only EN separates (+0.09, 9 of 11). Same corpus, judge N=3; safety preservation ties in both. Head-to-head has not been re-run on `claude-opus-5`: only the scrooge arm was, so no caveman comparison exists on the current pin |
| Benchmarking here          | Comparison arm (`caveman:full`)            | Real `output_tokens` runner, paired reports                  |
| Input-side compression     | `caveman-shrink` (npm MCP middleware)      | None — output register only. An opt-in `memory-compress` CLI shipped through v0.22.1 and was removed once its own measurements (7.7% floor, ~3–4% realizable) and prompt-cache pricing showed it was not worth its surface |

In short: Scrooge should not read like caveman with Korean bolted on. The point is Korean-first register design, while still acknowledging caveman as the source of inspiration and the strongest English comparison baseline.

## Compared to Claude Code's Concise style

Claude Code 2.1.237 added a built-in `Concise` output style — the brevity you get with nothing to install. Measured on the held-out report corpus, N=19 per language, `claude-opus-5-5`, 2026-10-15:

| Corpus — chat-prose, `append` mode | `normal` | Concise | Scrooge | Scrooge shorter than Concise (paired) | Claim-preservation, Concise vs Scrooge (paired difference) |
| ---------------------------------- | -------: | ------: | ------: | ------------------------------------- | ---------------------------------------------------------- |
| KO held-out                        | 1735     | 1151    | 732     | **+28.7%** (95% CI +20.9 to +37.2, 17/19) | 0.62 vs 0.60 (−0.03, CI −0.08 to +0.02)                |
| EN held-out                        | 1114     | 796     | 602     | **+16.9%** (95% CI +12.1 to +28.7, 18/19) | 0.68 vs 0.62 (+0.00, CI −0.04 to +0.02)                |

Token columns are median output tokens. Scrooge is shorter on the KO and EN corpora alike; claim-preservation does not separate the two — both intervals span zero. An output style rides on Claude Code's own system prompt, so every arm here runs in `append` mode and these numbers are **not comparable to the `replace`-mode headline above**. Each Concise row is checked to have actually run with the style. Method and reproduction: [Concise comparison](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#claude-codes-built-in-concise-style--measured-2026-10-15).

## Mechanics

1. `/scrooge [lang] [dial]` activates a mode. Tokens are order-independent — `/scrooge ko`, `/scrooge full`, `/scrooge ko full`, etc.
2. The `UserPromptSubmit` hook parses the command, persists `{lang, dial}` to a state file, looks up the rule via [`plugin/registry.json`](plugin/registry.json), and injects it as `additionalContext`.
3. Every subsequent turn reinjects a lightweight reminder so the register does not drift.
4. `/scrooge off` clears state and the global default (global off; see below). Auto-clarity contexts inside the rule itself drop compression for safety-critical replies (security warnings, irreversible-action confirmations, ambiguous multi-step sequences) without the user having to opt out.

**Global default.** Activating in any session saves the choice as a global default (`~/.claude/.scrooge/default`). Every new session then auto-activates with the same lang/dial/flags — set it once, anywhere. The `SessionStart` hook seeds a fresh session from the default and re-injects the full rule; on a host without `SessionStart` (Codex), the first prompt the default seeds receives the full rule instead. `/scrooge off` clears the default too (global off); a session already running keeps its register until it restarts, so an off in one worktree never yanks a concurrent one. The same holds the other way: the offed session keeps an off marker and stays off — on resume too, for up to 14 days — even after another session re-activates the default, until you activate again in it.

**Flags.** Beyond lang/dial, a behavior flag composes orthogonally. `lean` (minimal code output) is **on by default** — `/scrooge` trims over-engineering and narration, never correctness (its fragment pins the safety floor). Measured on top of `full`, paired against the same register without the flag: **KO +17.6%** (95% CI 10.2–43.7%) and **EN +18.1%** (95% CI 10.7–28.3%), est, prose-only, `claude-opus-4-8`, 8 prompts × 3 runs each. Both intervals exclude zero; counted per prompt (the CI's unit) the sign test gives KO 8/8 (p=0.0078) and EN 7/8 (p=0.07), so the direction is established for KO and consistent but not significant for EN; the intervals are wide, so read `lean` as "roughly a fifth off the top", not a precise figure. Reproduce with `python3 benchmarks/report.py --input results-lean2-{ko,en}.jsonl --baseline scrooge:{ko,en}/full --paired --drop-tool-rows`. These supersede the KO +34.6% / EN +10.3% pair published through v0.22.1, which misread the corpus structure and included a tool-using row on each side ([why](https://github.com/Kir93/scrooge-mode/blob/main/benchmarks/README.md#the-lean-flag-numbers)). Toggle per session with `/scrooge … nolean`, or globally via `SCROOGE_DEFAULT_FLAGS` (a comma-separated set, or empty to disable all). Each active flag appends its register fragment (`plugin/rules/{lang}/fragments/{flag}.md`) to the injected rule.

**Adding a language** (registry-driven dispatch — data, not new branches):

1. Author `plugin/rules/{lang}/full.md` and its `lean` fragment at `plugin/rules/{lang}/fragments/lean.md` — `lean` is on by default, so every language needs one.
2. Add two entries to [`plugin/registry.json`](plugin/registry.json) — the rule path and the `fragments` path. `VALID_LANGS` derives from the top-level keys other than `fragments`, so the slash parser and rule loader pick up the language with no code edit:

   ```json
   {
     "ja": { "full": "rules/ja/full.md" },
     "fragments": { "ja": { "lean": "rules/ja/fragments/lean.md" } }
   }
   ```

3. Add one `LANG_META` row in [`plugin/hooks/lang-meta.js`](plugin/hooks/lang-meta.js) — `reminder`, `countermand`, `flagHint`, and `nlCue` — which drives the per-turn reminder, the off countermand, and natural-language activation. `test_registry_parity.js` fails if a registry language has no row.
4. Sample 5 outputs against the QA checklist (see [CONTRIBUTING.md](https://github.com/Kir93/scrooge-mode/blob/main/CONTRIBUTING.md)) and PR.

## Contributing

Development setup, parity rules, language-addition steps, PR checks, and branch protection guidance live in [CONTRIBUTING.md](https://github.com/Kir93/scrooge-mode/blob/main/CONTRIBUTING.md). 한국어 기여 가이드는 [CONTRIBUTING.ko.md](https://github.com/Kir93/scrooge-mode/blob/main/CONTRIBUTING.ko.md).

## License

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
