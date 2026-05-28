<p align="center">
  <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/1fa99/emoji.svg" width="120" alt="coin" />
</p>

<h1 align="center">scrooge</h1>

<p align="center">
  <strong>토큰은 돈 — 구두쇠처럼 써라</strong>
</p>

<p align="center">
  <a href="https://github.com/Kir93/scrooge-mode/stargazers"><img src="https://img.shields.io/github/stars/Kir93/scrooge-mode?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://github.com/Kir93/scrooge-mode/commits/main"><img src="https://img.shields.io/github/last-commit/Kir93/scrooge-mode?style=flat" alt="Last Commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Kir93/scrooge-mode?style=flat" alt="License"></a>
</p>

<p align="center">
  <a href="README.md">English</a> • 한국어
</p>

<p align="center">
  <a href="#설치">설치</a> •
  <a href="#before--after">Before/After</a> •
  <a href="#벤치마크">벤치마크</a> •
  <a href="#동작-방식">동작 방식</a> •
  <a href="#caveman과-비교">vs caveman</a>
</p>

---

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill / plugin (Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI도 지원). AI 코딩 에이전트가 압축 register로 응답하게 만들어 **한국어 출력 토큰을 약 67%, 영어를 약 65% 줄이면서** 기술적 정확성은 그대로 유지한다. **한국어를 1순위 언어**로 — 영어 압축 규칙의 번역이 아니라 한국어 문법 기반 설계.

## Before / After

같은 프롬프트, 같은 Claude 모델, 실제 벤치마크 출력. 프롬프트와 응답 모두 한국어 — `ko/full` register의 의도된 데모.

> Node.js로 만든 단일 모놀리스 서비스를 서비스 분리할 때 가장 먼저 봐야 할 측정 지표 3가지를 알려줘.

<table>
<tr>
<td width="50%" valign="top">

### 🗣️ Normal Claude (693 tokens)

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

</td>
<td width="50%" valign="top">

### 🪙 Scrooge `ko/full` (188 tokens)

```text
1. **모듈 간 결합도** — import 그래프, 순환 의존, cross-module 호출 빈도. 분리 경계 후보 식별.
2. **트래픽/부하 편차** — endpoint별 RPS·CPU·메모리 점유율. 스케일 요구 다른 영역이 1순위 분리 대상.
3. **DB 접근 패턴** — 테이블별 read/write 소유권, join 경계, 트랜잭션 스팬. 공유 테이블 많으면 분리 비용 폭증.
```

</td>
</tr>
</table>

**같은 3개 지표, 같은 기술 판단 — output token 약 73% 절감.**

```text
┌─────────────────────────────────────────┐
│  KOREAN OUTPUT SAVED   ██████░░  ~67%   │
│  ENGLISH OUTPUT SAVED  ██████░░  ~65%   │
│  TECHNICAL ACCURACY    ████████  100%   │
│  HONORIFICS            ░░░░░░░░  STRIP  │
└─────────────────────────────────────────┘
```

> [!IMPORTANT]
> Scrooge는 **출력** 토큰만 줄인다 — thinking/reasoning 토큰은 손대지 않고 정확성도 유지. 구두쇠는 지출을 아끼지, 생각을 아끼지 않는다.

## 설치

멀티 에이전트 설치기 — Claude Code, Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI를 자동 감지해 각각에 Scrooge를 연결.

```bash
# curl | bash (클론 불필요)
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash

# 또는 npx
npx -y github:Kir93/scrooge-mode

# 또는 로컬 클론에서
./install.sh
```

약 10초. Node ≥18 필요. 설치 안 된 에이전트는 건너뜀. 재실행 안전. 미리보기(적용 없이 확인): `--dry-run`. 특정 에이전트만: `--only claude`. 제거: `-u` 또는 `uninstall.sh`.

**Claude Code plugin 경로** (이 저장소에서 직접 해석, `v0.1.0` tag 이후):

```bash
claude plugin marketplace add Kir93/scrooge-mode
claude plugin install scrooge@scrooge
```

**활성화.** `/scrooge ko full` (또는 `/scrooge en lite` 등)로 register on. `/scrooge off`로 상태 해제. 전체 옵션은 `scrooge --help`.

## 제공 기능

| 구성 | 설명 |
| --- | --- |
| `/scrooge [lang] [dial]` | register 활성화. 2축 — `ko`/`en` × `lite`/`full`. 세션 단위 지속. |
| `/scrooge off` | 상태 해제, 일반 prose 복귀. |
| `UserPromptSubmit` hook | 매 turn마다 register 재주입으로 dial drift 차단. |
| Safety auto-clarity | 보안 경고, 되돌릴 수 없는 동작 확인, 다단계 절차에서는 압축 해제. 양 언어 · 모든 dial. |
| `registry.json` | `언어 × dial → 규칙 파일 경로` 1:1 매핑. 언어 추가 = 규칙 파일 1개 + 레지스트리 항목 1줄. |
| 토큰 절감 statusline | Claude Code 세션 JSONL의 실제 output 토큰 — tokenizer 추정 아님. |
| CLI 벤치마크 하네스 | 재현 가능한 runner (`benchmarks/run.py`) — [`benchmarks/`](./benchmarks/) 참조. |

**왜 한국어가 중요한가.** 기존 압축 도구는 영어·한문 소양을 전제로 한다. Scrooge는 한국어를 1순위 언어로 — 한국어 문법 primitive(개조식 · 음슴체 · 존댓말 제거 · 반말 default) 기반 설계, 영어 압축의 번역 아님.

## 벤치마크

**claude-opus-4-7**로 측정. 전체 방법론과 재현 명령은 [`benchmarks/`](./benchmarks/)에 있음.

**측정 조건** (숫자 인용 전 반드시 읽을 것):

- **N=24 프롬프트 × 1회 실행, paired median.** 단일 실행 결과 · 분산 추정 없음. 재실행 시 각 셀이 몇 퍼센트 흔들릴 수 있음. 헤드라인 퍼센트는 1 유효숫자 추정으로 취급(`~67%`이지 "67.4%"가 아님).
- **Register-only isolation.** 하네스는 `claude --print --system-prompt <rule>`로 각 arm을 실행 — 이는 Claude Code 기본 system prompt를 **대체**한다. register 효과를 깔끔히 분리하지만, 실제 `/scrooge` 세션은 Claude Code 전체 system prompt 위에 register가 얹히므로 verbose 세션 대비 실측 절감은 헤드라인과 다를 수 있음. 전체 caveat는 [`benchmarks/README.md`](./benchmarks/README.md).

### 한국어

Mode 설명: `normal`은 모델 기본 답변, `terse`는 "간결하게 답해"만 적용한 control, `scrooge:*`/`caveman:*`은 각 압축 규칙.

| Mode | 대표 output tokens (N=24) | normal 대비 절감 |
| --- | -----------------------: | ---------------: |
| `normal` | 1567 | (baseline) |
| `terse` | 1145 | ~27% |
| **`scrooge:ko/full`** | **511** | **~67%** |
| `caveman:full` | 901 | ~43% |

`scrooge:ko/full`은 한국어 출력을 verbose default 대비 **~67%**, `caveman:full` 대비 **~43%** 더 줄임. `terse`보다도 짧아 단순 brevity 효과가 아님.

### 영어

영어는 아직 `full` dial에서 caveman보다 낮으며, 1차 배포 목표는 한국어.

| Mode | 대표 output tokens (N=24) | normal 대비 절감 |
| --- | -----------------------: | ---------------: |
| `normal` | 2235 | (baseline) |
| **`scrooge:en/full`** | **774** | **~65%** |
| `caveman:full` | 396 | ~82% |

`scrooge:en/full`은 영어 출력을 **~65%** 줄여, caveman의 full 절감률의 ~80% 수준에 도달.

## 동작 방식

1. `/scrooge [lang] [dial]` 명령으로 모드 활성화. 토큰은 2개 독립 축으로 조합 (`/scrooge ko`, `/scrooge full`, `/scrooge ko lite` …).
2. `UserPromptSubmit` hook이 명령 파싱 → 상태 파일에 `{lang, dial}` 저장 → `registry.json`으로 규칙 경로 해석 → `additionalContext`로 주입.
3. 이후 매 turn마다 경량 reminder 재주입으로 register drift 방지.
4. `/scrooge off`로 상태 삭제. 안전 컨텍스트는 규칙 자체의 auto-clarity가 normal prose로 복귀시킴.

**언어 추가:**

1. `rules/{lang}/{lite,full}.md` 규칙 파일 작성.
2. [`registry.json`](registry.json)에 항목 1개 추가:

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

## caveman과 비교

[caveman](https://github.com/JuliusBrussee/caveman)은 영감을 준 프로젝트. Scrooge 차이점:

| Axis | caveman | scrooge |
| --- | --- | --- |
| Languages | EN (+ wenyan 한문) | EN, KO (i18n pluggable) |
| Korean register | 없음 | native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default |
| Safety escape | 묵시적 | rule 안에 명시적 auto-clarity, 모든 dial |
| Benchmark | tiktoken 추정 | 세션 JSONL의 실측 `output_tokens` |
| Architecture | rules in code | rules as data (`registry.json`) |

Scrooge는 한국어에서 `caveman:full`보다 높은 실측 압축률을 내며 Korean-native register를 유지. 영어에서는 caveman이 여전히 더 강한 compression baseline이며, Scrooge의 더 넓은 포지셔닝은 **접근성**과 **언어별 확장성**.

## 라이선스 / 출처

MIT © 2026 Kir93. 자세한 내용은 [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — 컨셉만 차용, i18n-first로 독립 재구현(verbatim 복사 없음).

Hero coin glyph: [Noto Emoji](https://github.com/googlefonts/noto-emoji) (Google, [SIL OFL 1.1](https://scripts.sil.org/OFL)).
