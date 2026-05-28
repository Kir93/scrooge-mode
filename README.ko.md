# Scrooge 🪙

> 같은 답을 더 적은 토큰으로 — 한국어 그대로.

[English](README.md) | 한국어

🪙 **v0.1.0.** 설치기(`curl | bash` · `npx` · 로컬 클론), 활성화 hook, 토큰 절감 stats, 다국어 register, 벤치마크 하네스 모두 landed. `claude plugin install`은 이 저장소에서 직접 해석 — 중앙 제출 불필요.

**Scrooge**는 AI 코딩 에이전트가 **기술적 정확성을 온전히 유지하면서** 압축된 register로 응답하게 만들어 **출력 토큰**을 줄입니다 — 영어와 함께 **한국어를 1순위 언어**로 지원합니다.

## 설치

멀티 에이전트 설치기 — Claude Code, Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI를 자동 감지해 각각에 Scrooge를 연결합니다.

```bash
# curl | bash (클론 불필요)
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash

# 또는 npx
npx -y github:Kir93/scrooge-mode

# 또는 로컬 클론에서
./install.sh
```

미리보기(적용 없이 확인): `--dry-run` 추가. 특정 에이전트만 설치: `--only claude`. 제거: `-u` 옵션 또는 `uninstall.sh` 실행.

Claude Code plugin 경로 (v0.1.0 tag 발행 후 해석):

```bash
claude plugin marketplace add Kir93/scrooge-mode
claude plugin install scrooge@scrooge
```

활성화는 `/scrooge ko full` (또는 `/scrooge en lite` 등). `/scrooge off`로 상태 해제. 전체 옵션은 `scrooge --help`.

## 왜 Scrooge인가 — 포지셔닝은 "접근성"

기존 압축 도구는 영어·한문 소양을 전제로 합니다. Scrooge는 한국어를 1순위로 두어, 한국어 문법(개조식 · 음슴체 · 존댓말 제거)을 기반으로 설계된 register를 제공합니다. 영어/한문 배경 없이도 모국어로 토큰을 아낄 수 있습니다.

## Before / After

같은 프롬프트, 같은 Claude 모델, 실제 벤치마크 출력입니다.

> Node.js로 만든 단일 모놀리스 서비스를 서비스 분리할 때 가장 먼저 봐야 할 측정 지표 3가지를 알려줘.

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

같은 3개 지표와 같은 기술 판단을 유지하면서 **output token 약 73% 절감**.

## 벤치마크

**claude-opus-4-7**로 측정. 전체 방법론과 재현 명령은 [benchmarks/](./benchmarks/)에 정리되어 있습니다.

**측정 조건** (수치 인용 전 확인):

- **N=24 prompt × 1회 실행, paired median.** 단일 측정이라 분산 추정 없음. 재실행 시 셀마다 수 % 편차 가능. 헤드라인 절감률은 1자리 유효숫자 추정값(`~67%`)으로 읽을 것 (정확히 67.4%가 아님).
- **Register 단독 격리 조건.** 하네스는 `claude --print --system-prompt <rule>`로 각 arm을 실행 — Claude Code 기본 system prompt를 통째 *대체*함. register 효과만 깔끔히 분리되지만, 실제 `/scrooge` 세션은 CC 기본 system prompt가 그대로 살아 있어 실 사용 시 절감률은 다를 수 있음. 전체 주의사항은 [`benchmarks/README.md`](./benchmarks/README.md) 참조.

### 한국어

Mode 설명: `normal`은 기본 모델 답변, `terse`는 Scrooge/caveman 규칙 없이 "간결하게 답해"만 적용한 비교군, `scrooge:*`/`caveman:*`은 각 압축 규칙입니다.

| Mode | Median output tokens (N=24) | normal 대비 절감 |
| --- | --------------------------: | ---------------: |
| `normal` | 1567 | (baseline) |
| `terse` | 1145 | ~27% |
| **`scrooge:ko/full`** | **511** | **~67%** |
| `caveman:full` | 901 | ~43% |

`scrooge:ko/full`은 한국어 출력을 verbose default 대비 **~67%**, `caveman:full` 대비 **~43%** 더 줄입니다. `terse`보다도 짧아 단순 brevity 효과가 아님을 보여줍니다.

### 영어

영어는 아직 `full` dial에서 caveman보다 낮으며, 1차 배포 목표는 한국어입니다.

| Mode | Median output tokens (N=24) | normal 대비 절감 |
| --- | --------------------------: | ---------------: |
| `normal` | 2235 | (baseline) |
| **`scrooge:en/full`** | **774** | **~65%** |
| `caveman:full` | 396 | ~82% |

`scrooge:en/full`은 영어 출력을 **~65%** 줄여, caveman의 full 절감률의 ~80% 수준에 도달합니다.

## 제공 기능

- **i18n 아키텍처** — `registry.json`이 `언어 × dial → 규칙 파일 경로`를 1:1 매핑. 언어 추가는 두 단계 (규칙 파일 + 레지스트리 항목 1줄)
- **2 언어, 2 dial** — KO/EN × lite/full
- **한국어 native register** — 영어 압축 규칙의 번역이 아니라 한국어 문법 기반 설계
- **Safety auto-clarity** — 보안 경고, 되돌릴 수 없는 동작 확인, 다단계 절차에서는 압축 해제 (양 언어 공통)
- **CLI 벤치마크 하네스** — output-token 절감을 재현 가능하게 측정
- **토큰 절감 statusline** — tokenizer 추정 아닌 실제 세션 output 토큰

## 동작 방식

1. `/scrooge [lang] [dial]` 명령으로 모드 활성화. 토큰은 2개 독립 축으로 조합 (`/scrooge ko`, `/scrooge full`, `/scrooge ko lite` 등)
2. `UserPromptSubmit` hook이 명령 파싱 → 상태 파일에 `{lang,dial}` 저장 → `registry.json`으로 규칙 경로 해석 → `additionalContext`로 주입
3. 이후 매 turn마다 경량 reminder 재주입으로 register drift 방지
4. `/scrooge off`로 상태 삭제. 안전 컨텍스트는 규칙 자체의 auto-clarity가 normal prose로 복귀시킴

언어 추가:

1. `rules/{lang}/{lite,full}.md` 규칙 파일 작성
2. [registry.json](registry.json)에 항목 1개 추가:

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

## caveman과 비교

[caveman](https://github.com/JuliusBrussee/caveman)은 영감을 준 프로젝트입니다. Scrooge 차이점:

- **Bilingual + dial**: KO와 EN, lite와 full, 총 4 register
- **한국어 native register**: 개조식 · 음슴체 · 존댓말 제거 · 반말 default — 한국어 문법 그 자체에서 설계, 영어 압축의 번역 아님
- **In-rule safety auto-clarity**: 모든 dial이 보안 / 되돌릴 수 없는 동작 / 다단계 절차에서 normal prose escape 유지
- **CLI 벤치마크**: 세션 JSONL의 실측 `output_tokens` (tiktoken 추정 아님)
- **i18n 아키텍처**: 언어 규칙이 데이터, 코드 아님

Scrooge는 한국어에서 `caveman:full`보다 높은 실측 압축률을 냅니다. 영어에서는 caveman이 여전히 더 강한 compression baseline이며, Scrooge의 더 넓은 포지셔닝은 접근성 — 한국어 native 압축 register + per-language 확장 가능한 아키텍처입니다.

## 라이선스 / 출처

MIT © 2026 Kir93. 자세한 내용은 [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — 컨셉만 차용, i18n-first로 독립 재구현(verbatim 복사 없음).
