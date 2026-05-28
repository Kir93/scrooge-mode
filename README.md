# Scrooge 🪙

> Same answer, fewer tokens — in your language.

English | [한국어](README.ko.md)

🪙 **v0.1.0.** Installer (`curl | bash`, `npx`, or local clone), activation hook, token-savings stats, multilingual register, and benchmark harness all landed. `claude plugin install` resolves directly from this repo — no central submission required.

**Scrooge** makes AI coding agents reply in a **compressed register while keeping full technical accuracy**, cutting **output tokens** — with **Korean as a first-class language** alongside English.

## Install

Multi-agent installer — auto-detects Claude Code, Codex, Cursor, Windsurf, Cline, Continue, and Gemini CLI and wires Scrooge into each.

```bash
# curl | bash (no clone)
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash

# or via npx
npx -y github:Kir93/scrooge-mode

# or from a local clone
./install.sh
```

Preview without applying: append `--dry-run`. Restrict to one agent: `--only claude`. Uninstall: pass `-u`, or run `uninstall.sh`.

Claude Code plugin path (resolves after the `v0.1.0` tag is published):

```bash
claude plugin marketplace add Kir93/scrooge-mode
claude plugin install scrooge@scrooge
```

Then activate with `/scrooge ko full` (or `/scrooge en lite`, etc.). `/scrooge off` clears state. See `scrooge --help` for all flags.

## Why Scrooge — positioning is "accessibility"

Existing compression tools assume fluency in English or Classical Chinese. Scrooge treats Korean as a first-class language with a register designed around Korean grammar (개조식 · 음슴체 · honorific stripping), so you can save tokens in your own language without that background.

## Before / After

Same prompt, same Claude model, actual benchmark output. The prompt is Korean and the responses are Korean — this is a deliberate demo of the `ko/full` register, which is Scrooge's first-class target. The `en/full` register applies the same rule shape to English; see the English-prompt corpus at [`benchmarks/prompts/en.txt`](./benchmarks/prompts/en.txt) for representative inputs.

> Node.js로 만든 단일 모놀리스 서비스를 서비스 분리할 때 가장 먼저 봐야 할 측정 지표 3가지를 알려줘.
>
> *(Translation: "List the 3 most important metrics to look at first when splitting a Node.js monolith into separate services.")*

### Normal Claude (693 output tokens)

```text
모놀리스 분리 전 측정 지표 3가지:

## 1. 모듈 간 결합도 (Coupling)
- 측정: import graph 분석 (`madge`, `dependency-cruiser`)
- 지표: cross-module import 수, 순환 의존 여부, fan-in/fan-out
- 판정: 결합 약한 경계가 분리 후보. 순환 의존 있으면 먼저 끊어야 함.

## 2. 도메인별 트래픽/리소스 사용량
- 측정: APM (Datadog/New Relic) 또는 endpoint별 로그 집계
- 지표: RPS, p95 latency, CPU/메모리 점유율 — 라우트/도메인 단위
- 판정: hot path와 cold path 분리하면 독립 스케일 이득. 한 도메인이 전체 리소스 압도하면 1순위 추출 대상.

## 3. 데이터 소유권 (DB 테이블 접근 패턴)
- 측정: 쿼리 로그 → 모듈×테이블 행렬
- 지표: 모듈별 read/write 테이블 집합, JOIN 경계, 트랜잭션 범위
- 판정: 한 모듈이 독점 쓰는 테이블 군 = 깨끗한 분리선. 여러 모듈이 JOIN으로 얽힌 테이블은 분리 비용 큼 (Saga/2PC 필요).

---

**우선순위**: 3 → 1 → 2. 데이터 경계 못 그으면 서비스 쪼개도 분산 모놀리스 됨. 결합도로 코드 경계 확인, 트래픽으로 ROI 계산.

**보조 지표 (한 줄)**:
- 배포 빈도/장애 격리 필요성 — 조직 관점
- 팀 경계 (Conway's Law) — 소유권 명확화
- 빌드/테스트 시간 — 분리 후 효과 측정 기준선
```

### Scrooge `ko/full` (188 output tokens)

```text
1. **모듈 간 결합도** — import 그래프, 순환 의존, cross-module 호출 빈도. 분리 경계 후보 식별.
2. **트래픽/부하 편차** — endpoint별 RPS·CPU·메모리 점유율. 스케일 요구 다른 영역이 1순위 분리 대상.
3. **DB 접근 패턴** — 테이블별 read/write 소유권, join 경계, 트랜잭션 스팬. 공유 테이블 많으면 분리 비용 폭증.
```

Same three metrics, same technical decision shape, **~73% fewer output tokens**.

## Benchmarks

Measured on **claude-opus-4-7**. Full methodology and raw reproduction commands live in [`benchmarks/`](./benchmarks/).

**Measurement conditions** (read before quoting the numbers):

- **N=24 prompts × 1 run, paired median.** Single-run results; no variance estimate. Re-running can shift any single cell by a few percent. Treat headline percentages as one-significant-figure estimates (`~67%`, not "67.4% exactly").
- **Register-only isolation.** The harness runs each arm under `claude --print --system-prompt <rule>`, which *replaces* Claude Code's default system prompt. This isolates the register effect cleanly, but real `/scrooge` sessions keep Claude Code's full system prompt alongside the injected register, so real savings versus a real verbose session may differ from the headline. See [`benchmarks/README.md`](./benchmarks/README.md) for the full caveat list.

### Korean

Mode notes: `normal` is the model default; `terse` is a control that only says "answer concisely"; `scrooge:*` and `caveman:*` are compression-rule modes.

| Mode | Median output tokens (N=24) | Savings vs `normal` |
| --- | --------------------------: | ------------------: |
| `normal` | 1567 | (baseline) |
| `terse` | 1145 | ~27% |
| **`scrooge:ko/full`** | **511** | **~67%** |
| `caveman:full` | 901 | ~43% |

`scrooge:ko/full` cuts Korean output by **~67%** vs the verbose default and by **~43%** vs `caveman:full`. It also beats `terse`, so the gain is not just generic brevity.

### English

English remains below caveman at the `full` dial; the first release goal is Korean.

| Mode | Median output tokens (N=24) | Savings vs `normal` |
| --- | --------------------------: | ------------------: |
| `normal` | 2235 | (baseline) |
| **`scrooge:en/full`** | **774** | **~65%** |
| `caveman:full` | 396 | ~82% |

`scrooge:en/full` cuts English output by **~65%**, reaching ~80% of caveman's compression rate at the full dial.

## What you get

- **i18n architecture** — `registry.json` maps `language × dial → rule file path`; adding a language is two steps (rule file + one registry entry)
- **2 languages, 2 dials** — KO/EN × lite/full
- **Korean-native register** — designed around Korean grammar, not translated from English compression rules
- **Safety auto-clarity** — rules explicitly drop compression for security warnings, irreversible-action confirmations, ambiguous multi-step sequences (both languages)
- **CLI benchmark harness** — reproducible runner for measuring output-token savings
- **Token-savings statusline** — actual session output tokens, not tokenizer estimates

## How it works

1. `/scrooge [lang] [dial]` activates a mode. Tokens compose on two independent axes (`/scrooge ko`, `/scrooge full`, `/scrooge ko lite`, etc.).
2. The `UserPromptSubmit` hook parses the command, persists `{lang,dial}` to a state file, looks up the rule via `registry.json`, and injects it as `additionalContext`.
3. Every subsequent turn reinjects a lightweight reminder so the register does not drift.
4. `/scrooge off` clears state. Auto-clarity contexts in the rule itself drop compression for safety-critical replies.

Adding a language:

1. Author `rules/{lang}/{lite,full}.md`
2. Add one entry to [registry.json](registry.json):

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

## Compared to caveman

[caveman](https://github.com/JuliusBrussee/caveman) is the inspiration. Scrooge differs:

- **Bilingual + dial**: KO and EN, lite and full, 4 registers total
- **Korean-native register**: 개조식 · 음슴체 · honorific strip · 반말 default — Korean grammar primitives, not translated English compression
- **Safety auto-clarity in-rule**: every dial keeps a normal-prose escape for security / irreversible / ambiguous contexts
- **CLI benchmark**: real `output_tokens` from session JSONL (not tiktoken estimates)
- **i18n architecture**: language rules are data, not code

Scrooge now posts higher measured compression than `caveman:full` on Korean while keeping a Korean-native register. For English, caveman remains the stronger compression baseline; Scrooge's broader positioning is accessibility and per-language extensibility.

## License / attribution

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
