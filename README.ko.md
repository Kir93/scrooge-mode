<p align="center">
  <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f4b0/emoji.svg" width="120" alt="money bag" />
</p>

<h1 align="center">scrooge</h1>

<p align="center">
  <code>토큰은 돈 — 구두쇠처럼 써라</code>
</p>

<p align="center">
  <a href="https://github.com/Kir93/scrooge-mode/stargazers"><img src="https://img.shields.io/github/stars/Kir93/scrooge-mode?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://github.com/Kir93/scrooge-mode/commits/main"><img src="https://img.shields.io/github/last-commit/Kir93/scrooge-mode?style=flat" alt="Last Commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Kir93/scrooge-mode?style=flat" alt="License"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 한국어 · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="#데모">데모</a> ·
  <a href="#설치">설치</a> ·
  <a href="#표면">표면</a> ·
  <a href="#벤치마크">벤치마크</a> ·
  <a href="#메커니즘">메커니즘</a> ·
  <a href="#caveman과-비교">caveman 비교</a>
</p>

---

> AI 코딩 에이전트 응답의 출력 토큰을 줄이는 skill — 같은 답, 적은 토큰.

AI 코딩 에이전트용 한국어 1순위 다중언어(KO/EN/JA/HI/ZH) 출력 압축 skill — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) full 지원, Codex는 hook+stats, Cursor·Windsurf·Cline·Continue·Gemini CLI는 skill-only([호스트 지원](#호스트-지원) 참고). 한국어 register는 한국어 문법 primitive(개조식 · 음슴체 · 존댓말 제거 · 반말 default) 기반 설계 — 영어 압축 규칙의 번역 **아님**.

**`~70% KO · ~66% EN · ~70% JA · ~66% HI · ~63% ZH · 출력만 압축 · 존대 제거`** — `claude-opus-4-8`; KO/EN/JA N=16–25 paired median, HI/ZH held-out N=11.

<p align="center">
  <a href="#벤치마크"><img src="assets/benchmark.svg" alt="턴당 대표 output tokens (claude-opus-4-8, paired median): 한국어 scrooge:ko/full 1042 vs normal 3413 (−70%); 영어 scrooge:en/full 816 vs normal 2397 (−66%)" width="760"></a>
</p>

## 데모

같은 프롬프트, 같은 Claude 모델, 실제 벤치마크 출력. 프롬프트·응답 모두 한국어 — `ko/full` register의 의도된 데모. 영문 프롬프트 코퍼스는 [`benchmarks/prompts/en.txt`](./benchmarks/prompts/en.txt).

> Node.js로 만든 단일 모놀리스 서비스를 서비스 분리할 때 가장 먼저 봐야 할 측정 지표 3가지를 알려줘.

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

같은 3개 지표, 같은 기술 판단 모양 — 이 프롬프트에서 **output token 약 73% 절감**.

> [!IMPORTANT]
> Output만 줄임. Reasoning · thinking · 정확성은 그대로. 구두쇠는 지출만 장부에 적지, 생각은 적지 않음.

## 설치

권장 quick-start:

```bash
npx -y github:Kir93/scrooge-mode
```

재현 가능한 설치를 위해 release 버전 핀(원하는 release tag로 교체):

```bash
npx -y github:Kir93/scrooge-mode#v0.6.1
```

**업데이트.** quick-start를 다시 실행하면 감지된 전 호스트가 그 자리에서 최신화됨 — Scrooge는 재실행 안전. Claude Code는 이제 skip 대신 marketplace를 새로고침하고 `claude plugin update` 실행(적용은 Claude 재시작); Codex·skill-only 호스트는 재실행 시 payload overwrite. latest 대신 특정 버전 핀은 위와 동일한 `--tag`/`#ref` 사용. Scrooge는 하루 1회 GitHub를 확인해 새 릴리스가 있으면 세션 시작 시 한 줄로 알림(Claude는 `↑vX` statusline 마커도) — 끄기는 `SCROOGE_NO_UPDATE_CHECK=1`, 수동 확인은 `scrooge --version`.

상세 setup, Claude Code plugin 설치, Codex `skills` 설치, troubleshooting, uninstall 절차는 [INSTALL.ko.md](INSTALL.ko.md). English install guide는 [INSTALL.md](INSTALL.md).

**활성화.** `/scrooge ko full` (또는 `/scrooge en lite`, `/scrooge ja full` 등)로 register on. `/scrooge off`로 상태 해제. 전체 옵션은 `scrooge --help`. Claude Code hook에선 자연어도 동작 — "스크루지처럼 답해줘" / "talk like scrooge" / "スクルージみたいに答えて"로 활성화, "스크루지 꺼" / "stop scrooge"로 해제. 부정문("스크루지처럼 말하지 마" / "don't talk like scrooge")은 무시.

### 호스트 지원

installer가 감지된 호스트를 각 기능 tier로 설치함:

| Host | 설치 | Reinject hook | Stats | Statusline |
| ---- | ---- | :-----------: | :---: | :--------: |
| Claude Code | plugin | ✓ | ✓ | ✓ |
| Codex | skills + `config.toml` hook | ✓ | ✓ | — |
| Cursor · Windsurf · Cline · Continue · Gemini CLI | skills (skill-only) | — | — | — |

skill-only 호스트는 register 규칙을 skill로 받지만 활성화는 수동 — 턴마다 reinject hook 없음, 토큰 stats 없음. 완전한 hook+stats+statusline은 Claude Code, Codex는 `~/.codex/config.toml`로 hook+stats 제공.

## 표면

| 구성                     | 설명                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `/scrooge [lang] [dial]` | register 활성화. 2축 — `ko`/`en`/`ja`/`hi`/`zh` × `lite`/`full`. 세션 단위 지속 + 글로벌 기본값으로 저장돼 새 세션 자동 활성. |
| `/scrooge … [flag]`      | dial과 직교인 행동 플래그: `lean`(코드 산출물 최소주의)은 **기본 on**(코드 ~21%↓). `nolean`(세션) 또는 `SCROOGE_DEFAULT_FLAGS`(전역)로 토글. |
| `/scrooge off`           | 상태 + 글로벌 기본값 해제(전역 off), 일반 prose 복귀.                                     |
| 자연어 (hook)            | "스크루지처럼 답해줘" / "talk like scrooge" / "スクルージみたいに答えて" / "स्क्रूज की तरह जवाब दो" / "像斯克鲁奇一样回答"로 활성화, "스크루지 꺼" / "stop scrooge"로 해제. 부정문 무시, slash 우선. 언어는 구문 기준, dial `full`. |
| `UserPromptSubmit` hook  | 매 turn마다 register 재주입으로 dial drift 차단.                                          |
| Safety auto-clarity      | 보안 경고, 되돌릴 수 없는 동작 확인, 다단계 절차에서는 압축 해제. 모든 언어 · 모든 dial.    |
| `registry.json`          | `언어 × dial → 규칙 파일 경로` 1:1 매핑이자 `VALID_LANGS`가 derive하는 키 목록의 원천. 언어 추가 = 규칙 파일 1개 + 레지스트리 항목 1줄 + `hooks/lang-meta.js` 1행. |
| `scrooge-stats` skill    | Claude/Codex에서 발견 가능한 stats 표면. session JSONL의 측정된 input + output 토큰 표시, 모델 추정 금지. |
| 토큰 절감 statusline     | Claude Code 세션 JSONL의 실제 output 토큰 — tokenizer 추정 아님.                          |
| CLI 벤치마크 하네스      | 재현 가능한 runner (`benchmarks/run.py`) — [`benchmarks/`](./benchmarks/) 참조.           |

**왜 한국어가 중요한가.** 기존 출력 압축 skill 대부분은 영어 1순위거나 한문을 유일한 비영어 타깃으로 가정함. Scrooge는 한국어를 1순위 언어로 — register가 한국어 문법 primitive(개조식 · 음슴체 · 존댓말 제거 · 반말 default) 기반 설계됨, 영어의 번역 아님. 아키텍처는 i18n pluggable — rule 엔진은 `registry.json`에서 모든 언어를 수술 없이 로드함. 일본어는 3번째 언어로 출하 — 영어 번역이 아니라 한국어 메커니즘 사상(keigo 제거 · 体言止め · 助詞 드롭); CJK 토큰 비효율이 압축 타깃으로 자연스러움. 힌디어는 4번째로 출하 — 동일 메커니즘(경어 평어화 · 명사형 종결 · 후치사 드롭)을 Devanagari(또 다른 토큰 비효율 문자)에 사상. 중국어는 5번째로 출하 — 단 JA/HI와 달리 한국어 메커니즘 이식 **아님**: 중국어는 고립어라 제거할 경어 형태소·격조사가 없어 register를 **zh-native**로 신설계(정중어 `请`/`您` 제거, 잉여 구조조사 `的`/`了`/`着`·양사 보수적 드롭, 연결어 filler 제거), caveman의 wenyan이 아닌 현대 간결체.

## 벤치마크

**`claude-opus-4-8`** 측정. 전체 방법론·재현 명령은 [`benchmarks/`](./benchmarks/). 아래 모든 headline 수치는 [`benchmarks/published/`](./benchmarks/published/)의 scrubbed raw rows로 뒷받침됨 — median을 직접 재계산 가능; 파일별 model·register 버전·측정일은 [provenance manifest](./benchmarks/published/README.md).

**측정 조건** (숫자 인용 전 반드시 읽을 것):

- **N=21–25 프롬프트 × 1회 실행, paired median.** 단일 실행 결과 · 분산 추정 없음(구독 timeout으로 몇 프롬프트 누락). 재실행 시 각 셀이 몇 퍼센트 흔들릴 수 있음. 헤드라인 퍼센트는 1 유효숫자 추정으로 취급(`~70%`이지 "69.5%"가 아님).
- **Register-clean run.** register hook 둘(scrooge 자체 활성화 hook·caveman)을 측정 동안 중립화해 `normal`/`terse` baseline에 주입 못 하게 함. 토큰은 `message.id` dedup(prose-only 기준). baseline이 호스트 scrooge hook에 몰래 압축된 이전 run은 폐기함.
- **Held-out cross-check.** 튜닝 corpus와 겹치지 않는 held-out 프롬프트셋(`prompts/{ko,en,ja,hi}-report.txt`)으로 재측정: KO ~71%, EN ~68%, JA ~65%, HI ~63%(각 N=11; HI per-prompt median 67%). 위 headline과 일치 → savings가 튜닝셋 overfit 아티팩트 아님. HI는 held-out 전용 — 별도 튜닝 corpus 미측정. Raw rows: [`benchmarks/published/`](./benchmarks/published/).
- **Register-only isolation.** 하네스는 `claude --print --system-prompt <rule>`로 각 arm 실행 — Claude Code 기본 system prompt를 **대체**함. register 효과를 깔끔히 분리하지만, 실제 `/scrooge` 세션은 Claude Code 전체 system prompt 위에 register가 얹히므로 verbose 세션 대비 실측 절감은 헤드라인과 다를 수 있음. 전체 caveat는 [`benchmarks/README.md`](./benchmarks/README.md).
- **실측 `output_tokens` — tokenizer 추정 아님.** 숫자는 Claude Code 세션 JSONL의 `output_tokens` 필드 — API가 실제 청구한 값.

### 한국어

`normal`은 모델 기본 답변, `terse`는 "간결하게 답해"만 적용한 control, `scrooge:*`는 우리가 출하하는 규칙. `caveman:full`은 비교 baseline이며 Scrooge 모드 아님.

| Mode                  | 대표 output tokens (N=21) | normal 대비 절감 |
| --------------------- | ------------------------: | ---------------: |
| `normal`              |                      3413 |       (baseline) |
| `terse`               |                      2242 |             ~34% |
| **`scrooge:ko/full`** |                  **1042** |         **~70%** |
| `caveman:full`        |                      1005 |             ~71% |

`scrooge:ko/full`은 한국어 출력을 verbose default 대비 **~70%** 줄이고, `terse`보다도 짧음 → 단순 brevity 아니라 register 효과. `caveman:full`은 비슷한 token 수(**1005** vs **1042**)에 도달하나 문법을 깨고 정보를 버려서 그럼 — scrooge는 답을 온전히 보존함. 축은 raw token이 아니라 그 fidelity 차이. fidelity(held-out, judge N=3): **claim-preservation 중앙값 0.68, safety 12/16 보존** — 손실은 breadth(강압축으로 부차 디테일 누락)이지 오정보 아님; 핵심 기술 답·안전 prose 보존. Raw rows: [`results-ko-clean-opus48.jsonl`](./benchmarks/published/results-ko-clean-opus48.jsonl) (v0.19.1).

### 영어

| Mode                  | 대표 output tokens (N=25) | normal 대비 절감 |
| --------------------- | ------------------------: | ---------------: |
| `normal`              |                      2397 |       (baseline) |
| `terse`               |                      1803 |             ~25% |
| **`scrooge:en/full`** |                   **816** |         **~66%** |
| `caveman:full`        |                       703 |             ~71% |

`scrooge:en/full`은 영어 출력을 verbose default 대비 **~66%** 줄이고 `terse`보다 짧음. `caveman:full`은 raw token이 더 적음(**703** vs **816**) — telegraphic하게 압축하며 정보를 버리기 때문; scrooge는 그 token을 답 보존에 씀. fidelity 차이가 핵심. fidelity(held-out, judge N=3): **claim-preservation 중앙값 0.72, safety 9/11 보존** — JA보다 claim 보존 높음; 손실은 breadth이지 오정보 아님; 핵심 기술 답·안전 prose 보존. Raw rows: [`results-en-clean-opus48.jsonl`](./benchmarks/published/results-en-clean-opus48.jsonl) (v0.19.1).

### 일본어

`scrooge:ja/full`은 한국어 메커니즘을 일본어로 사상 — keigo 제거, 体言止め(명사형 종결), 助詞(조사) 드롭 — 단 한자는 통상 표기 유지(KO의 Hangul-only와 반대). `claude-opus-4-8` 측정.

| Mode                  | 대표 output tokens (N=15) | normal 대비 절감 |
| --------------------- | ------------------------: | ---------------: |
| `normal`              |                      2930 |       (baseline) |
| `terse`               |                      1551 |             ~47% |
| **`scrooge:ja/full`** |                   **877** |         **~70%** |

`scrooge:ja/full`은 일본어 출력을 verbose default 대비 **~70%** 줄이고, `terse`("간결하게 답해") control도 **+43%**(15/15 우세) 능가 — 절감은 register 자체. held-out 교차검증(`prompts/ja-report.txt`, N=11): **~65%**. fidelity(held-out, judge N=3): **claim-preservation 중앙값 0.60, corruption 0, safety 11/11 보존** — 손실은 breadth(강압축으로 부차 디테일 누락)이지 오정보 아님; 핵심 기술 답·안전 prose는 보존. Raw rows: [`results-ja-report.jsonl`](./benchmarks/published/results-ja-report.jsonl) · [`results-ja-fidelity.jsonl`](./benchmarks/published/results-ja-fidelity.jsonl).

> **측정 주의**: `normal` baseline은 host 메모리 파일(`~/.claude/CLAUDE.md`, project `CLAUDE.local.md`)을 격리하고 측정 — prompt 언어(일본어)로 답하게 함. 격리 없으면 host "한국어로 답하라" 지시로 baseline이 한국어로 답해, 다른 토큰 효율 탓에 savings가 부풀려짐.

### 힌디어

`scrooge:hi/full`은 한국어 메커니즘을 힌디어로 사상 — 경어 평어화(`कीजिए` → `करो`), 명사형/체언 종결, 후치사 선택 드롭(`को`/`में`/`से`; `ने` 능격 표지는 의미 변화 위험으로 유지) — 단 본문은 Devanagari, 영어 기술용어는 code-mix 원문.

| Mode                  | Median output tokens (held-out N=11) | Savings vs `normal` |
| --------------------- | -----------------------------------: | ------------------: |
| `normal`              |                                 2436 |          (baseline) |
| **`scrooge:hi/full`** |                              **897** |            **~63%** |

`scrooge:hi/full`은 힌디어 출력을 verbose default 대비 **per-prompt 중앙값 66.6%**(median 비 ~63%) 줄이고, held-out **11/11** 우세. fidelity(held-out, judge N=3): **claim-preservation 중앙값 0.76, safety 10/11 보존** — JA보다 claim 보존 높음; safety 1건 미달은 보안/되돌릴 수 없는 동작 없는 rate-limiting 프롬프트에서의 checks.js 휴리스틱 false-positive(압축 답도 기술 캐비엇 유지), 나머지 손실은 breadth이지 오정보 아님. held-out 전용 측정 — 별도 튜닝 corpus·`normal`/`terse` 표는 아직 없음. Raw rows: [`results-hi-report.jsonl`](./benchmarks/published/results-hi-report.jsonl) · [`results-hi-fidelity.jsonl`](./benchmarks/published/results-hi-fidelity.jsonl).

> **측정 주의**: 일본어와 동일 cwd 격리 — `normal` baseline은 host 메모리 파일(`~/.claude/CLAUDE.md`) 격리로 힌디어로 답하게 함. 격리 없으면 host "한국어로 답하라" 기본값 탓에 savings 부풀려짐.

### 중국어

`scrooge:zh/full`은 **zh-native** register — 한국어 메커니즘 이식 아님: 중국어는 고립어라 제거할 경어·격조사가 없어 정중어(`请`/`您`) 제거, 잉여 구조조사(`的`/`了`/`着`)·양사 보수적 드롭, 연결어 filler 제거로 압축 — 본문은 简体, 영어 기술용어는 code-mix 원문. caveman의 wenyan이 아닌 현대 간결체.

| Mode | Median output tokens (held-out N=11) | Savings vs `normal` |
| --- | ---: | ---: |
| `normal` | 2703 | (baseline) |
| **`scrooge:zh/full`** | **897** | **~67%** |

`scrooge:zh/full`은 중국어 출력을 verbose default 대비 **per-prompt 중앙값 62.9%**(median 비 ~67%) 줄이고, held-out **11/11** 우세. fidelity(held-out, judge N=3): **claim-preservation 중앙값 0.72, safety 11/11 보존** — JA보다 claim 보존 높고 safety 미달 0; 손실은 breadth(강압축으로 부차 디테일 누락)이지 오정보 아님(fully-equivalent 0은 독립 생성의 예상 신호이지 손상 아님). held-out 전용 측정 — 별도 튜닝 corpus·`normal`/`terse` 표는 아직 없음. before/after: [`benchmarks/examples/zh-foreach-async.*`](./benchmarks/examples/) (`normal` 1221 → `scrooge` 466 tokens, 동일 forEach-async 진단). Raw rows: [`results-zh-report.jsonl`](./benchmarks/published/results-zh-report.jsonl) · [`results-zh-fidelity.jsonl`](./benchmarks/published/results-zh-fidelity.jsonl).

> **측정 주의**: 일본어/힌디어와 동일 cwd 격리 — `normal` baseline은 host 메모리 파일(`~/.claude/CLAUDE.md`) 격리로 중국어로 답하게 함. 격리 없으면 host "한국어로 답하라" 기본값 탓에 savings 부풀려짐.

### 문서 생성

위 표는 대화형 답변 측정. Scrooge의 문서 압축 규칙(`## Boundaries`의 "docs / prose artifacts" 항목)은 **생성 문서** — README·명세·API 레퍼런스·릴리스 노트·런북 — 도 대상으로 함. 별도 held-out corpus([`prompts/{ko,en}-docgen.txt`](./benchmarks/prompts/ko-docgen.txt) — 포함할 사실을 고정해 모든 arm이 _같은 정보_를 전달하는 문서 생성 과제 12개)로, inline 전용(`--disallow-tools` — 모델이 문서를 파일로 쓰지 않고 prose로 출력)으로 측정:

| 언어 | `normal` | `terse` | `scrooge` | prompt당 절감 중앙값 | scrooge < `normal` |
| ---- | -------: | ------: | --------: | -------------------: | :----------------: |
| 한국어 (N=10)  | 3554 | 2460 | **1420** | **~48%** | 10 / 10 |
| 영어 (N=11)    | 2772 | 1504 |  **852** | **~55%** | 11 / 11 |

arm별 대표 output tokens. 절감 열은 **각 프롬프트 감소율의 중앙값** — 표의 두 중앙값 토큰을 나누면 더 큰 60%(KO)/69%(EN)가 나오는데, heavy-tail 분포라 normal·scrooge 중앙값이 서로 다른 프롬프트에 떨어지기 때문(prompt당 중앙값이 대표값). scrooge는 **모든** 프롬프트에서 verbose baseline보다 작았고, `terse`("간결하게 답해") control도 9/10(KO)·11/11(EN)로 능가 — 절감은 register 자체이지 일반 brevity 아님. 절감은 메타 프롤로그("릴리스 노트입니다…")·종결 제안("원하시면 다른 형식으로도…")·항목별 과설명 제거에서 나오며, 문서 본문(모든 사실·코드 블록·절차)은 보존. before/after 쌍과 수치 근거인 per-prompt 토큰 표는 [`benchmarks/examples/`](./benchmarks/examples/)에 커밋([`docgen-results.md`](./benchmarks/examples/docgen-results.md); 예: 한국어 릴리스 노트, `normal` 1839 → `scrooge` 776 tokens, 동일 6개 변경).

이 문서 생성 수치는 **대화형 헤드라인보다 noisy** — 추정치로 취급:

- **단일 실행, 분산 큼.** 문서 길이는 run마다 크게 변동 — 여기서 prompt당 절감은 7%(밀도 높은 기능 명세 — 대부분 필수 내용)부터 92%(장황한 baseline)까지. 안정적 신호는 exact %가 아니라 prompt당 win-rate.
- **보수적.** 일부 `normal`/`terse` 프롬프트는 문서가 너무 길어 timeout 내 미완료라 paired set에서 제외 — 즉 _가장 장황한_ baseline이 빠진 것.
- **Clean baseline.** 대화형 헤드라인과 달리 host `CLAUDE.md`까지 중립화하고 inline 출력을 강제 — baseline이 로컬 `CLAUDE.md`나 파일쓰기 tool에 영향받지 않은 기본 assistant. (per-machine `settings.json` hook/plugin은 로드되나 모든 arm에 동일 적용.) 전체 방법론은 [`benchmarks/README.md`](./benchmarks/README.md).

## 메커니즘

1. `/scrooge [lang] [dial]` 명령으로 모드 활성화. 토큰은 2개 독립 축으로 조합 — `/scrooge ko`, `/scrooge full`, `/scrooge ko lite` 등.
2. `UserPromptSubmit` hook이 명령 파싱 → 상태 파일에 `{lang, dial}` 저장 → [`registry.json`](registry.json)으로 규칙 경로 해석 → `additionalContext`로 주입.
3. 이후 매 turn마다 경량 reminder 재주입으로 register drift 방지.
4. `/scrooge off`로 상태 + 글로벌 기본값 삭제(전역 off, 아래 참조). 규칙 자체의 auto-clarity가 안전 컨텍스트(보안 경고, 되돌릴 수 없는 동작 확인, 다단계 절차)에서는 압축 해제 — 사용자가 opt-out할 필요 없음.

**글로벌 기본값.** 아무 세션에서 활성화하면 그 선택이 글로벌 기본값(`~/.claude/.scrooge/default`)으로 저장돼, 모든 새 세션이 같은 lang/dial/flags로 자동 활성 — 한 번만, 어디서든. `SessionStart` hook이 새 세션을 기본값으로 seed하고 full rule을 재주입. `/scrooge off`는 기본값도 삭제(전역 off); 이미 떠 있는 세션은 재시작 전까지 register 유지 — 한 worktree의 off가 동시 세션을 끊지 않음.

**플래그.** lang/dial 외에 행동 플래그가 직교 조합. `lean`(코드 산출물 최소주의)은 **기본 on** — `/scrooge`가 과설계·해설을 덜어 ~21% 더 깎되 정확성은 절대 안 건드림(fragment가 안전 바닥 고정). 세션 단위 `/scrooge … nolean` 또는 전역 `SCROOGE_DEFAULT_FLAGS`(쉼표 구분 집합, 또는 빈 값으로 전체 해제)로 토글. 활성 플래그는 각자의 register fragment(`rules/{lang}/fragments/{flag}.md`)를 주입 규칙에 덧붙임.

**언어 추가** (registry-driven dispatch — 분기 추가 아닌 데이터 추가):

1. `rules/{lang}/{lite,full}.md` 규칙 파일 작성.
2. [`registry.json`](registry.json)에 항목 1개 추가 — `VALID_LANGS`가 이 키에서 derive되므로 slash parser·rule loader가 코드 수정 없이 언어 인식:

   ```json
   {
     "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
   }
   ```

3. [`hooks/lang-meta.js`](hooks/lang-meta.js)에 `LANG_META` 1행 추가 — `reminder`, `countermand`, `flagHint`, `nlCue` — per-turn reminder·off countermand·자연어 활성화 구동. registry 언어에 행이 없으면 `test_registry_parity.js`가 fail.
4. 5건 sample 출력을 QA checklist ([CONTRIBUTING.md](CONTRIBUTING.md)) 기준 self-check → PR.

## caveman과 비교

[caveman](https://github.com/JuliusBrussee/caveman)은 영감을 준 프로젝트. Scrooge는 fork나 README/code 복붙이 아니라, caveman을 명시적 benchmark/reference로 두는 KO-first 독립 구현. **caveman alternative**(caveman 대안) — 또는 **Korean caveman**(한국어 caveman) — 을 찾아왔다면 바로 그 자리: 같은 token-miser 아이디어를 번역이 아니라 한국어 1순위로 재구축한 것.

| 축                | caveman                            | Scrooge                                                |
| ----------------- | ---------------------------------- | ------------------------------------------------------ |
| 1차 목표          | 공격적 영어 압축                   | Korean-native 이중언어 압축                            |
| 언어              | EN (+ wenyan 한문)                 | KO, EN; `registry.json` 기반 i18n                      |
| 한국어 register   | 없음                               | native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default  |
| 이번 영어 결과    | `703` median tokens (telegraphic·lossy) | `816` median tokens — 약간 많으나 답 보존 (fidelity 0.72) |
| 여기서의 벤치마크 | 비교 arm (`caveman:full`)          | 실측 `output_tokens` runner, paired reports            |

요약: Scrooge는 caveman에 한국어만 덧댄 문서/구현으로 보이면 안 됨. 핵심은 한국어 1순위 register 설계이고, caveman은 출처와 가장 강한 영어 비교 baseline으로 명시함.

## 기여

개발 setup, parity 규칙, 언어 추가 절차, PR check, branch protection 지침은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md). English contributing guide는 [CONTRIBUTING.md](CONTRIBUTING.md).

## 라이선스 / 출처

MIT © 2026 Kir93. 자세한 내용은 [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — 컨셉만 차용, i18n-first로 독립 재구현(verbatim 복사 없음).

제작 이야기: [Scrooge 작업기 시리즈](https://kir93.co.kr/tag/scrooge) — 측정하는 압축을 만든 과정 기록.
