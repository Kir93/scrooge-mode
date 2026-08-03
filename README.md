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

**`~70% KO · ~66% EN · ~64% JA · ~63% HI · ~67% ZH · output-only · honorifics stripped`** — `claude-opus-4-8`; KO/EN N=21–25 paired median, JA/HI/ZH held-out N=11.

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
npx -y github:Kir93/scrooge-mode#v0.21.0
```

**Update.** Re-running the quick-start updates every detected host in place. Scrooge is safe to re-run. On Claude Code the installer now refreshes the marketplace and runs `claude plugin update` (restart Claude to apply) instead of skipping; Codex and skill-only hosts overwrite their payload on re-run. To pin a specific version instead of latest, use the same `--tag`/`#ref` as above. Scrooge also checks GitHub once a day and, when a newer release exists, hints at session start (plus an `↑vX` statusline marker on Claude) — opt out with `SCROOGE_NO_UPDATE_CHECK=1`, or check on demand with `scrooge --version`.

Detailed setup, Claude Code plugin install, Codex `skills` install, troubleshooting, and uninstall steps live in [INSTALL.md](INSTALL.md). 한국어 설치 문서는 [INSTALL.ko.md](INSTALL.ko.md).

**Activate.** `/scrooge ko full` (or `/scrooge en lite`, `/scrooge ja full`, etc.) turns the register on. `/scrooge off` clears state. `scrooge --help` lists every flag. On the Claude Code hook, plain language works too — "talk like scrooge" / "스크루지처럼 답해줘" / "スクルージみたいに答えて" activates, "stop scrooge" / "스크루지 꺼" clears. A negation ("don't talk like scrooge" / "스크루지처럼 말하지 마") is ignored.

### Host support

The installer sets up each detected host at its capability tier:

| Host | Install | Reinject hook | Stats | Statusline |
| ---- | ------- | :-----------: | :---: | :--------: |
| Claude Code | plugin | ✓ | ✓ | ✓ |
| Codex | skills + `config.toml` hook | ✓ | ✓ | — |
| Cursor · Windsurf · Cline · Continue | skills (skill-only) | — | — | — |
| Gemini CLI (**opt-in**, `--only gemini`) | skills (skill-only) | — | — | — |

Skill-only hosts get the register rule as a skill, but activation is manual — no per-turn reinject hook and no token stats. The full hook + stats + statusline experience is Claude Code; Codex gets the hook + stats via `~/.codex/config.toml`. Codex wires only `UserPromptSubmit` (no `SessionStart`), so its update notice and `↑vX` marker are Claude-only. On Codex, upgrades are a reinstall (see [Update](INSTALL.md#update) in INSTALL.md).

## Surface

| Component                | What                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/scrooge [lang] [dial]` | Activate a register. Two axes — `ko`/`en`/`ja`/`hi`/`zh` × `lite`/`full`. Persists per session, and is saved as a global default that auto-activates new sessions. `full` is the measured dial; `lite` was measured and quotes no savings estimate — it compresses less than `full` _and_ preserves less ([why](./benchmarks/README.md#the-lite-dial--measured-then-not-adopted)). |
| `/scrooge … [flag]`      | Behavior flag orthogonal to the dial: `lean` (minimal code output) is **on by default** (KO +34.6% / EN +10.3% on top of `full`, est — provenance and reproduce command in [`benchmarks/README.md`](./benchmarks/README.md#the-lean-flag-numbers)). Toggle with `nolean` (per session) or `SCROOGE_DEFAULT_FLAGS` (global). |
| `/scrooge off`           | Clear state + the global default (global off), return to normal prose.                                                                                                             |
| Natural language (hook)  | "talk like scrooge" / "스크루지처럼 답해줘" / "スクルージみたいに答えて" / "स्क्रूज की तरह जवाब दो" / "像斯克鲁奇一样回答" activates; "stop scrooge" / "스크루지 꺼" clears. Negations ignored; slash wins. Language from the phrase, dial `full`. |
| `UserPromptSubmit` hook  | Reinjects the register every turn so the dial does not drift.                                                                                    |
| Safety auto-clarity      | Rules drop compression for security warnings, irreversible-action confirmations, and ambiguous multi-step sequences. Every language, every dial. |
| `registry.json`          | Maps `language × dial → rule file path` 1:1, and the key list is the source `VALID_LANGS` derives from. Adding a language = one rule file + one registry entry + one `hooks/lang-meta.js` row.    |
| `scrooge-stats` skill    | Discoverable stats surface for Claude/Codex. Reports measured input + output tokens from the session JSONL; never asks the model to estimate.    |
| Token-savings statusline | Actual session output tokens from the Claude Code session JSONL — not tokenizer estimates.                                                       |
| CLI benchmark harness    | Reproducible runner (`benchmarks/run.py`) — see [`benchmarks/`](./benchmarks/).                                                                  |
| `memory-compress` CLI    | **Opt-in**, input-side and separate from the register: compresses a memory file (CLAUDE.md, AGENTS.md) to fewer input tokens with code, URLs, and paths kept byte-exact. Nothing runs automatically — see [Memory Compress](INSTALL.md#memory-compress-optional-cli). |

**Why Korean matters.** Most output-compression skills are English-first or assume Classical Chinese as the only non-English target. Scrooge treats Korean as a first-class language, with the register designed around Korean grammar primitives (개조식 · 음슴체 · 존댓말 제거 · 반말 default). It is not translated from English. The architecture is i18n pluggable, so the rule engine loads any language from `registry.json` with no surgery. Japanese ships as the third language, mapping the Korean mechanism (keigo stripping · 体言止め · 助詞 drop) rather than translating English. CJK token inefficiency makes it a natural compression target. Hindi ships as the fourth, mapping the same mechanism (honorific leveling · noun-stop endings · postposition drop) onto Devanagari, another token-inefficient script. Chinese ships as the fifth, but unlike JA/HI it is **not** a port of the Korean mechanism: Chinese is an isolating language with no honorific morphology or case particles to strip, so its register is a **zh-native** design (drop politeness `请`/`您`, conservatively drop redundant structural particles `的`/`了`/`着` and measure words, cut connective filler). It is modern concise prose rather than caveman's wenyan.

## Benchmarks

Measured on **`claude-opus-4-8`**. Full methodology and raw reproduction commands live in [`benchmarks/`](./benchmarks/). Every headline number below is backed by scrubbed raw rows under [`benchmarks/published/`](./benchmarks/published/), so you can recompute the medians yourself. Per-file model, register version, and measurement date are in the [provenance manifest](./benchmarks/published/README.md).

**Measurement conditions** (read before quoting the numbers):

- **N=21–25 prompts × 1 run, paired median.** No variance estimate; treat headline percentages as one-significant-figure estimates (`~70%`, not "69.5% exactly").
- **Register-clean run.** Both register hooks (scrooge's own and caveman) are neutralized so they cannot inject into the `normal`/`terse` baseline; tokens are deduped by `message.id` (prose-only basis).
- **Held-out cross-check.** A disjoint prompt set (N=11 each) gives KO ~71%, EN ~68%, JA ~64%, HI ~63%, ZH ~67% — consistent with the headline, so the savings are not overfitting. Method and per-prompt medians: [`benchmarks/README.md`](./benchmarks/README.md#reproducing-a-published-number).
- **Register-only isolation.** Each arm runs under `claude --print --system-prompt <rule>`, which _replaces_ Claude Code's default system prompt. That isolates the register cleanly, but a real `/scrooge` session keeps the full system prompt alongside it, so real savings may differ from the headline. Register **retention** does have direct real-session evidence: a drift analysis over dogfood sessions (177 conclusive of 744 scrooge-active, 2026-07-31, [`benchmarks/session-evidence/`](./benchmarks/session-evidence/)) shows late-session prose output stayed flat vs early turns — median late/early ratio 0.83, 77% of conclusive sessions retained. The aggregate is committed as [`results.json`](./benchmarks/session-evidence/results.json) so those four numbers can be checked against a file. The private transcripts behind it are not third-party reproducible. Retention only — real-session _savings_ remain unmeasurable (no verbose counterfactual, ADR-003). Full caveat list: [`benchmarks/README.md`](./benchmarks/README.md).
- **Real `output_tokens`.** Numbers come from the session JSONL's `output_tokens` field — what the API actually billed, not a tokenizer estimate.

### Korean

`normal` is the model default, `terse` a control prompt ("answer concisely"), `caveman:full` a comparison baseline — not a Scrooge mode.

| Mode                  | Median output tokens (N=21) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        3413 |          (baseline) |
| `terse`               |                        2242 |                ~34% |
| **`scrooge:ko/full`** |                    **1042** |            **~70%** |
| `caveman:full`        |                        1005 |                ~71% |

`scrooge:ko/full` cuts Korean output by **~70%** and beats the `terse` control, so the gain is the register, not generic brevity. `caveman:full` lands at a similar token count (**1005** vs **1042**) but breaks grammar to get there, and on the held-out corpus it preserves fewer claims (**0.60** vs scrooge's **0.68**). That fidelity gap is the axis, not raw tokens; safety prose survives equally in both (12/16 each). Fidelity (held-out, judge N=3): **0.68 median claim-preservation, safety preserved 12/16**, over the 16 rows with all three judge runs; the loss is breadth, not wrong information. Token rows: [`results-ko-clean-opus48.jsonl`](./benchmarks/published/results-ko-clean-opus48.jsonl) (v0.19.1) · judge rows: [`results-ko-fidelity.jsonl`](./benchmarks/published/results-ko-fidelity.jsonl).

### English

| Mode                  | Median output tokens (N=25) | Savings vs `normal` |
| --------------------- | --------------------------: | ------------------: |
| `normal`              |                        2397 |          (baseline) |
| `terse`               |                        1803 |                ~25% |
| **`scrooge:en/full`** |                     **816** |            **~66%** |
| `caveman:full`        |                         703 |                ~71% |

`scrooge:en/full` cuts English output by **~66%** and beats the `terse` control. `caveman:full` is smaller in raw tokens (**703** vs **816**). Both arms are now judged: on the held-out corpus scrooge preserves more claims (**0.72** vs caveman's **0.69**, 9 of 11 prompts), but the margin is small and safety preservation is identical (9/11 each) — see [caveman fidelity](./benchmarks/README.md#caveman-fidelity--the-differentiation-measured). Fidelity (held-out, judge N=3): **0.72 median claim-preservation, safety preserved 9/11** — higher claim retention than JA; the loss is breadth, not wrong information. Token rows: [`results-en-clean-opus48.jsonl`](./benchmarks/published/results-en-clean-opus48.jsonl) (v0.19.1) · judge rows: [`results-en-fidelity.jsonl`](./benchmarks/published/results-en-fidelity.jsonl).

### Japanese, Hindi, Chinese

All three are held-out-only measurements (N=11, `prompts/{ja,hi,zh}-report.txt`), so there is no separate tuning table for them. JA and HI map the Korean mechanism onto their own grammar; ZH is a zh-native register rather than a port, because Chinese has no honorific morphology or case particles to strip.

| Register | `normal` | `scrooge` | Savings vs `normal` | Fidelity (judge N=3) |
| -------- | -------: | --------: | ------------------: | -------------------: |
| `scrooge:ja/full` | 2477 | **880** | **~64%** (per-prompt 69.6%) | 0.60, safety 11/11 |
| `scrooge:hi/full` | 2436 | **897** | **~63%** (per-prompt 66.6%) | 0.76, safety 10/11 |
| `scrooge:zh/full` | 2703 | **897** | **~67%** (per-prompt 62.9%) | 0.72, safety 11/11 |

Per-register design notes, the measurement-isolation caveat each one needs, and the full fidelity readouts are in [`benchmarks/README.md` § Per-language detail](./benchmarks/README.md#per-language-detail). Raw rows: [`results-{ja,hi,zh}-report.jsonl`](./benchmarks/published/) · fidelity rows alongside them.

### Document generation

The tables above measure conversational replies. Scrooge's doc-compression rule also targets **generated documents** (READMEs, specs, API references, release notes, runbooks), measured on a separate held-out corpus that pins the facts each arm must convey:

| Lang | `normal` | `terse` | `scrooge` | Median per-prompt savings | scrooge < `normal` |
| ---- | -------: | ------: | --------: | ------------------------: | :----------------: |
| Korean (N=10)  | 3554 | 2460 | **1420** | **~48%** | 10 / 10 |
| English (N=11) | 2772 | 1504 |  **852** | **~55%** | 11 / 11 |

scrooge was smaller than the verbose baseline on **every** prompt and beat the `terse` control on 9/10 (KO) and 11/11 (EN). These numbers are noisier than the conversational headline (single run, wide per-prompt spread), so treat them as estimates — the stable signal is the win-rate. Corpus, method, variance caveats, and before/after pairs: [`benchmarks/README.md` § Document generation](./benchmarks/README.md#document-generation-corpus) and [`benchmarks/examples/docgen-results.md`](./benchmarks/examples/docgen-results.md).

## Compared to caveman

[caveman](https://github.com/JuliusBrussee/caveman) inspired the project. Scrooge is not a fork or README/code copy; it is an independent, KO-first implementation with caveman kept as an explicit benchmark/reference point. If you came here looking for a **caveman alternative** or a **Korean caveman**, that is the niche: the same token-miser idea, rebuilt Korean-first rather than translated.

| Axis                       | caveman                                    | Scrooge                                                      |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Primary target             | Aggressive English compression             | Korean-native bilingual compression                          |
| Languages                  | EN (+ wenyan classical Chinese)            | KO, EN, JA, HI, ZH; i18n via `registry.json`                 |
| Korean register            | None                                       | Native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default        |
| English result in this run | `703` median tokens (telegraphic)          | `816` median tokens — a few more, for a modestly higher claim-preservation score |
| Fidelity, judged head-to-head | 0.60 KO · 0.69 EN                          | **0.68** KO · **0.72** EN (same corpus, judge N=3; safety preservation ties) |
| Benchmarking here          | Comparison arm (`caveman:full`)            | Real `output_tokens` runner, paired reports                  |
| Input-side compression     | None                                       | `memory-compress`, an opt-in CLI (see the Surface table above) — separate from the always-on output register |

In short: Scrooge should not read like caveman with Korean bolted on. The point is Korean-first register design, while still acknowledging caveman as the source of inspiration and the strongest English comparison baseline.

## Mechanics

1. `/scrooge [lang] [dial]` activates a mode. Tokens compose on two independent axes — `/scrooge ko`, `/scrooge full`, `/scrooge ko lite`, etc.
2. The `UserPromptSubmit` hook parses the command, persists `{lang, dial}` to a state file, looks up the rule via [`registry.json`](registry.json), and injects it as `additionalContext`.
3. Every subsequent turn reinjects a lightweight reminder so the register does not drift.
4. `/scrooge off` clears state and the global default (global off; see below). Auto-clarity contexts inside the rule itself drop compression for safety-critical replies (security warnings, irreversible-action confirmations, ambiguous multi-step sequences) without the user having to opt out.

**Global default.** Activating in any session saves the choice as a global default (`~/.claude/.scrooge/default`). Every new session then auto-activates with the same lang/dial/flags — set it once, anywhere. The `SessionStart` hook seeds a fresh session from the default and re-injects the full rule. `/scrooge off` clears the default too (global off); a session already running keeps its register until it restarts, so an off in one worktree never yanks a concurrent one.

**Flags.** Beyond lang/dial, a behavior flag composes orthogonally. `lean` (minimal code output) is **on by default** — `/scrooge` trims over-engineering and narration, never correctness (its fragment pins the safety floor). Measured on top of `full`, paired against the same register without the flag: **KO +34.6%** (n=22) and **EN +10.3%** (n=21), est, prose-only, `claude-opus-4-8`. The two languages differ by 24pp, so no single averaged figure fits either. Both corpora ran 24 prompt/run pairs; the usable n differs only because of failed runs (KO 2, EN 3). Reproduce with `python3 benchmarks/report.py --input results-lean2-{ko,en}.jsonl --baseline scrooge:{ko,en}/full --paired`. Toggle per session with `/scrooge … nolean`, or globally via `SCROOGE_DEFAULT_FLAGS` (a comma-separated set, or empty to disable all). Each active flag appends its register fragment (`rules/{lang}/fragments/{flag}.md`) to the injected rule.

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

## Contributing

Development setup, parity rules, language-addition steps, PR checks, and branch protection guidance live in [CONTRIBUTING.md](CONTRIBUTING.md). 한국어 기여 가이드는 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md).

## License

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
