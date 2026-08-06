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
  <a href="#caveman과-비교">caveman 비교</a> ·
  <a href="#메커니즘">메커니즘</a>
</p>

---

> AI 코딩 에이전트 응답의 출력 토큰을 줄이는 skill — 같은 답, 적은 토큰.

AI 코딩 에이전트용 한국어 1순위 다중언어(KO/EN/JA/HI/ZH) 출력 압축 skill. [Claude Code](https://docs.anthropic.com/en/docs/claude-code) full 지원, Codex는 hook+stats, Cursor·Windsurf·Cline·Continue·Gemini CLI는 skill-only([호스트 지원](#호스트-지원) 참고). 한국어 register는 한국어 문법 primitive(개조식 · 음슴체 · 존댓말 제거 · 반말 default) 기반 설계 — 영어 압축 규칙의 번역 **아님**.

**`~70% KO · ~67% EN · ~65% JA · ~63% HI · ~67% ZH · 단일턴 chat prose · 출력만 압축`** — `claude-opus-4-8`; KO/EN N=21–24 paired median, JA/HI/ZH held-out N=10–11. **agentic 세션 수치 아님** — agentic 작업은 별도 측정(10 태스크 코퍼스에서 총 output 52% 절감, 실세션에서 register가 닿는 범위는 billed output의 ~14~30%). [측정 조건](#벤치마크).

<p align="center">
  <a href="#벤치마크"><img src="assets/benchmark.svg" alt="턴당 대표 output tokens (claude-opus-4-8, paired median): 한국어 scrooge:ko/full 1042 vs normal 3413 (−70%); 영어 scrooge:en/full 773 vs normal 2344 (−67%)" width="760"></a>
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

## 왜 setting이 아니라 register인가

이걸 해주는 설정이 없고, 벤더가 그렇게 말하고 있음.

- **Anthropic이 문제와 처방을 모두 문서화함.** Opus 5 프롬프팅 가이드가 현재 Claude Code 기본 모델의 verbosity 회귀 3종(사용자 응답 길어짐·agentic 세션 메시지당 출력 길어짐·디스크에 쓰는 파일 길어짐)을 기록하고, 처방으로 **prompt 레벨 brevity register**를 제시함 — 권장 문구(`<tone_preference>Keep outputs reasonably concise.</tone_preference>`)까지 명시. Scrooge는 Anthropic이 스스로 권장한 그 메커니즘의 측정된·다국어·안전 게이트 구현임.
- **이걸 하는 파라미터가 없음.** Messages API에 `verbosity` 파라미터 없음(`output_config` = `effort` + `format` + `task_budget`). effort 문서는 Opus 5에서 *"effort를 바꿔도 응답이 확실히 짧아지지 않으니 길이는 프롬프트로 지시하라"*고 명시. `max_tokens`는 압축이 아니라 절단이고, `task_budget`은 Claude Code 미지원으로 명시됨.
- **이걸 하는 hook도 없음.** `MessageDisplay`는 화면 렌더링만 바꿈 — transcript와 Claude가 보는 텍스트는 원문 그대로라 청구 토큰을 못 줄임. 그게 가능한 hook 요청(`updatedAssistantMessage`/`PreRender`, anthropics/claude-code#61152)은 duplicate로 close됨. **청구되는 output을 실제로 줄이는 레버는 system-prompt 주입뿐임.** Scrooge가 `UserPromptSubmit`에 주입하는 이유가 그것이고, 그 주입 비용을 공짜인 척하지 않고 `/scrooge-stats`에서 input으로 되청구하는 이유도 그것임.
- **Claude Code에 terse output style이 없음.** 출하되는 커스텀 스타일 둘(Explanatory·Learning)은 문서상 출력을 오히려 *늘림*. `/output-style` 자체는 v2.1.91에서 제거됨.

## 설치

권장 quick-start:

```bash
npx -y github:Kir93/scrooge-mode
```

재현 가능한 설치를 위해 release 버전 핀(원하는 release tag로 교체):

```bash
npx -y github:Kir93/scrooge-mode#v0.21.0
```

**업데이트.** quick-start를 다시 실행하면 감지된 전 호스트가 그 자리에서 최신화됨. Scrooge는 재실행 안전. Claude Code는 이제 skip 대신 marketplace를 새로고침하고 `claude plugin update` 실행(적용은 Claude 재시작); Codex·skill-only 호스트는 재실행 시 payload overwrite. latest 대신 특정 버전 핀은 위와 동일한 `--tag`/`#ref` 사용. Scrooge는 하루 1회 GitHub를 확인해 새 릴리스가 있으면 세션 시작 시 한 줄로 알림(Claude는 `↑vX` statusline 마커도) — 끄기는 `SCROOGE_NO_UPDATE_CHECK=1`, 수동 확인은 `scrooge --version`.

상세 setup, Claude Code plugin 설치, Codex `skills` 설치, troubleshooting, uninstall 절차는 [INSTALL.ko.md](INSTALL.ko.md). English install guide는 [INSTALL.md](INSTALL.md).

**활성화.** `/scrooge ko full` (또는 `/scrooge en`, `/scrooge ja` 등)로 register on. `/scrooge off`로 상태 해제. 전체 옵션은 `scrooge --help`. Claude Code hook에선 자연어도 동작 — "스크루지처럼 답해줘" / "talk like scrooge" / "スクルージみたいに答えて"로 활성화, "스크루지 꺼" / "stop scrooge"로 해제. 부정문("스크루지처럼 말하지 마" / "don't talk like scrooge")은 무시.

### 호스트 지원

installer가 감지된 호스트를 각 기능 tier로 설치함:

| Host | 설치 | Reinject hook | Stats | Statusline |
| ---- | ---- | :-----------: | :---: | :--------: |
| Claude Code | plugin | ✓ | ✓ | ✓ |
| Codex | skills + `config.toml` hook | ✓ | ✓ | — |
| Cursor · Windsurf · Cline · Continue | skills (skill-only) | — | — | — |
| Gemini CLI (**opt-in**, `--only gemini`) | skills (skill-only) | — | — | — |

**`SKILL.md` 하나, 런타임 7개.** Agent Skills는 Agentic AI Foundation(Linux Foundation) 산하 공개 표준으로 `name`·`description`만 필수이고, 인식 못 하는 frontmatter 키는 무시하도록 규정한다 — [`skills/scrooge/SKILL.md`](skills/scrooge/SKILL.md)이 정확히 그 두 필드만 갖고 있다. 따라서 register는 파일 하나로 Claude Code·Codex·Cursor·Windsurf·Cline·Continue·Gemini CLI에 닿으며, 위 표는 포팅 개수가 아니라 호스트별로 얼마나 *자동화*가 감싸는지를 나타낸다.

tier의 의미: skill-only 호스트는 register를 로드하지만 활성화가 수동 — 턴마다 reinject hook 없음, 토큰 stats 없음. Codex는 `UserPromptSubmit`만 배선(`SessionStart` 없음)하므로 업데이트 알림·`↑vX` 마커는 Claude 전용이고 업그레이드는 재설치([Update](INSTALL.ko.md#update)). statusline `✓`는 보이는 것보다 좁다 — one-line installer가 배선하며 **`/plugin install` 경로는 배선하지 않음**. 수동 `settings.json` 항목은 [INSTALL.ko.md](INSTALL.ko.md#statusline).

표에 없는 호스트는 표준의 수렴 위치인 `~/.agents/skills/`를 쓰면 된다 — `npx skills add … -g`가 이미 쓰는 경로다.

## 표면

| 구성                     | 설명                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `/scrooge [lang] [dial]` | register 활성화. 언어 축 — `ko`/`en`/`ja`/`hi`/`zh`, dial은 `full`. 세션 단위 지속 + 글로벌 기본값으로 저장돼 새 세션 자동 활성. dial은 `full` 하나뿐: `lite`는 v0.22.1까지 출하됐으나 측정 결과 **두 축 모두** 열위 — `full`보다 덜 압축하고 보존도 낮음 — 이라 자체 벤치마크가 기각한 dial을 계속 출하하는 대신 v0.23.0에서 제거함([측정](./benchmarks/README.md#the-lite-dial--measured-then-removed)). `lite`로 저장된 상태는 `full`로 마이그레이션됨. |
| `/scrooge … [flag]`      | dial과 직교인 행동 플래그: `lean`(코드 산출물 최소주의)은 **기본 on**(`full` 위에서 KO·EN 모두 ~+18%, est — 근거·재현 명령은 [`benchmarks/README.md`](./benchmarks/README.md#the-lean-flag-numbers)). `nolean`(세션) 또는 `SCROOGE_DEFAULT_FLAGS`(전역)로 토글. |
| `/scrooge off`           | 상태 + 글로벌 기본값 해제(전역 off), 일반 prose 복귀.                                     |
| 자연어 (hook)            | "스크루지처럼 답해줘" / "talk like scrooge" / "スクルージみたいに答えて" / "स्क्रूज की तरह जवाब दो" / "像斯克鲁奇一样回答"로 활성화, "스크루지 꺼" / "stop scrooge"로 해제. 부정문 무시, slash 우선. 언어는 구문 기준, dial `full`. |
| `UserPromptSubmit` hook  | 매 turn마다 register 재주입으로 dial drift 차단.                                          |
| Safety auto-clarity      | 보안 경고, 되돌릴 수 없는 동작 확인, 다단계 절차에서는 압축 해제. 전 언어. **측정:** 잘못된 전제 질문에서 KO 19/20·EN 10/10 반박(비압축 baseline은 19/19·9/9) — 재현되는 KO 실패 1건이 있으나 표본이 가려낼 수 있는 격차는 아님([상세](./benchmarks/README.md#false-premises--one-demonstrated-failure-no-measurable-deficit)). |
| `registry.json`          | `언어 × dial → 규칙 파일 경로` 1:1 매핑이자 `VALID_LANGS`가 derive하는 키 목록의 원천. 언어 추가 = 규칙 파일 1개 + 레지스트리 항목 1줄 + `hooks/lang-meta.js` 1행. |
| `scrooge-stats` skill    | Claude/Codex에서 발견 가능한 stats 표면. session JSONL의 측정된 input + output 토큰 표시, 모델 추정 금지. |
| 토큰 절감 statusline     | Claude Code 세션 JSONL의 실제 output 토큰 — tokenizer 추정 아님.                          |
| CLI 벤치마크 하네스      | 재현 가능한 runner (`benchmarks/run.py`) — [`benchmarks/`](./benchmarks/) 참조.           |

**왜 한국어가 중요한가.** 문법적 이유 외에 경제적 이유도 있음: Claude 토크나이저는 같은 뜻의 영어 대비 한국어에 약 **1.88배** 토큰을 매김(OpenAI o200k는 1.38배) — 언어별 register 논거가 Scrooge가 full tier로 도는 바로 그 호스트에서 가장 강한 이유. 기존 출력 압축 skill 대부분은 영어 1순위거나 한문을 유일한 비영어 타깃으로 가정함. Scrooge는 한국어를 1순위 언어로 두고, register 자체를 한국어 문법 primitive(개조식 · 음슴체 · 존댓말 제거 · 반말 default)로 설계함. 영어 압축 규칙의 번역이 아님. 아키텍처는 i18n pluggable — rule 엔진은 `registry.json`에서 모든 언어를 수술 없이 로드함. 일본어는 3번째 언어로 출하하며 영어 번역이 아니라 한국어 메커니즘을 사상함(keigo 제거 · 体言止め · 助詞 드롭). CJK 토큰 비효율이 압축 타깃으로 자연스러움. 힌디어는 4번째로 출하 — 동일 메커니즘(경어 평어화 · 명사형 종결 · 후치사 드롭)을 Devanagari(또 다른 토큰 비효율 문자)에 사상. 중국어는 5번째로 출하하되 JA/HI와 달리 한국어 메커니즘 이식 **아님**: 중국어는 고립어라 제거할 경어 형태소·격조사가 없어 register를 **zh-native**로 신설계함(정중어 `请`/`您` 제거, 잉여 구조조사 `的`/`了`/`着`·양사 보수적 드롭, 연결어 filler 제거). caveman의 wenyan과 달리 현대 간결체.

## 벤치마크

**`claude-opus-4-8`** 측정. 전체 방법론·재현 명령은 [`benchmarks/`](./benchmarks/). 아래 모든 headline 수치는 [`benchmarks/published/`](./benchmarks/published/)의 scrubbed raw rows로 뒷받침되어 median을 직접 재계산할 수 있음. 파일별 model·register 버전·측정일은 [provenance manifest](./benchmarks/published/README.md).

**측정 조건**(숫자 인용 전 필독):

- **chat-prose workload 전용 — 여기서 가장 큰 한계.** 공개된 모든 행이 `tool_use_output_tokens: 0`·`turns: 1`임 — 코퍼스가 tool 호출 없는 단일턴 대화형 Q&A. 실제 agentic 세션에서 register가 닿는 건 billed output 중 prose 부분뿐이고, 그 비율이 작음 — 유지보수자 자신의 scrooge 활성 세션 930개 실측 기준 prose는 **billed output token의 pooled 13.8%(35.3M 중 4.87M), 세션 중앙값 29.5%**([`session-evidence/`](./benchmarks/session-evidence/), [`results.json`](./benchmarks/session-evidence/results.json)의 `reach.*`로 커밋). 나머지는 diff·파일 쓰기·정확한 error 문자열 등 register가 설계상 원문 그대로 두는 tool 호출 payload. *당신의* 세션 전체 절감은 여전히 주장하지 않음 — 실세션엔 verbose counterfactual이 없음(ADR-003). 측정한 것은 **별도의 agentic 벤치마크**임: 고정 scratch repo 위 held-out 10 태스크에서 `scrooge:en/full`이 총 billed output을 **52%** 절감(paired median, 95% CI +38.7~+55.8, 10/10에서 더 작음, p=0.002), 그러면서 턴은 baseline보다 *더* 썼고, 작업이 실제로 완료됐음을 spot check로 확인함. 그 코퍼스의 prose share는 18.7%로 위 실세션 pooled·median 사이에 있으므로 더 무거운 세션은 구조상 천장이 더 낮음. 대조로 JetBrains는 SkillsBench 87개 중 86개 태스크(~240 billed trial, 품질 통계적 무변, 2026-07)에서 `caveman`을 **8.5%**로 측정함 — 훨씬 크고 무거운 코퍼스. 두 수치와 차이의 이유: [Agentic workload](./benchmarks/README.md#agentic-workload--measured).
- **N=21–24 프롬프트 × 1회 실행, paired median.** 헤드라인은 1 유효숫자 추정(`~70%`이지 "69.5%"가 아님). 단 각 헤드라인 arm은 paired 프롬프트 **전부**에서 더 작았고(exact sign test p ≤ 1e-3) 95% bootstrap CI 하한도 56% 위에 머묾 — 1 유효숫자라는 단서는 둘째 자리에 대한 것이지 효과의 실재 여부가 아님. `report.py --paired`가 공개된 어느 파일에 대해서든 구간·sign test·해상 가능 최소 효과를 출력함.
- **tool을 사용한 행은 전 arm에서 제외됨(v0.23.0 변경).** 일부 행이 인라인 답변 대신 tool 호출로 응답 — 한 건은 prose 119 토큰 옆에 tool 7,645 토큰. 이런 행을 prose 기준으로 인라인 답변과 비교하면 동등 비교가 아니므로, `--drop-tool-rows`가 해당 prompt/run 키를 전 arm에서 함께 버림. 기존에는 ZH에만 적용된 수동 예외였고 산문으로만 설명돼 인쇄된 재현 명령에는 빠져 있었음 — 그 명령이 바로 위 표와 다른 수치를 내던 원인. **공개: 제외된 행이 주로 `normal` baseline 쪽이라 규칙 적용으로 헤드라인 둘이 올라감 — EN 66%→67%, JA 64%→65%, 반대로 KO held-out은 71%→70%.** 규칙은 양방향 동일하며 결과적으로 두 번 우리에게 유리했을 뿐임.
- **Register-clean run.** register hook 둘(scrooge·caveman)을 중립화해 baseline에 주입되지 않게 함. 토큰은 `message.id` dedup(prose-only).
- **Held-out cross-check.** 겹치지 않는 프롬프트셋(각 N=10–11)에서 KO ~70%, EN ~68%, JA ~65%, HI ~63%, ZH ~67% — 위 headline과 일치하므로 튜닝셋 overfit 아님. 산출 방식·per-prompt 중앙값: [`benchmarks/README.md`](./benchmarks/README.md#reproducing-a-published-number).
- **Register-only isolation.** 각 arm은 `claude --print --system-prompt <rule>`로 실행하며 Claude Code 기본 system prompt를 **대체**함. register 효과는 깔끔히 분리되지만 실제 세션은 전체 system prompt 위에 register가 얹히므로 실측 절감이 헤드라인과 다를 수 있음. register **유지**는 실세션 근거가 있음: dogfood 세션 drift 분석(scrooge 활성 930개 중 conclusive 188개, 2026-08-05, [`benchmarks/session-evidence/`](./benchmarks/session-evidence/))에서 후반부 prose output이 초반 대비 평탄 — 후반/전반 median ratio 0.83, conclusive의 77% retained. 집계는 [`results.json`](./benchmarks/session-evidence/results.json)으로 커밋되어 위 네 개 수치를 파일과 대조 가능함. 다만 입력이 사설 세션 로그라 제3자 재현은 불가. 유지 축만 — 실세션 _절감_은 여전히 측정 불가(verbose counterfactual 부재, ADR-003). 전체 caveat: [`benchmarks/README.md`](./benchmarks/README.md).
- **실측 `output_tokens`.** 숫자는 세션 JSONL의 `output_tokens` 필드 — tokenizer 추정이 아니라 API가 실제 청구한 값.
- **safety register를 잘못된 전제로 시험했고, 재현되는 실패 1건이 있음.** 간결성 강조 지시가 hallucination 저항을 깎는다는 건 알려진 사실이라(Giskard Phare, 2025-04-30: 최대 20%), 올바른 답이 질문의 가정 자체를 거부하는 것인 문항으로 시험함. EN 10/10(judge N=3, 만장일치). KO **19/20**, 비압축 baseline은 19/19 — **Fisher exact p=1.000으로 이 표본에서 둘은 구분되지 않음**. KO의 miss 1건은 실재하고 만장일치이며, 같은 문항을 일반 `terse` 통제군이 통과했으므로 짧음이 아니라 이 register에 귀속됨. 여기서 안전 주장을 하지 않으며 규칙도 고치지 않음 — 실패 문항·메커니즘·그 판단 근거: [False premises](./benchmarks/README.md#false-premises--one-demonstrated-failure-no-measurable-deficit).
- **`claude-opus-4-8` 고정이며 이후 재측정하지 않음.** Claude Code 기본 모델은 2026-07-24(v2.1.219)에 Opus 5로 바뀜. Anthropic 자체 Opus 5 프롬프팅 가이드가 기본 응답이 이전 Opus보다 길어졌다고 기록하므로 비압축 baseline이 움직였을 가능성이 큼 — **다만 절감률이 어느 방향으로 움직이는지는 미측정이며 주장하지 않음.**

### 한국어

`normal`은 모델 기본 답변, `terse`는 "간결하게 답해" control, `caveman:full`은 비교 baseline — Scrooge 모드 아님.

| Mode                  | 대표 output tokens (N=21) | normal 대비 절감 |
| --------------------- | ------------------------: | ---------------: |
| `normal`              |                      3413 |       (baseline) |
| `terse`               |                      2242 |             ~34% |
| **`scrooge:ko/full`** |                  **1042** |         **~70%** |
| `caveman:full`        |                      1005 |             ~71% |

`terse`보다도 짧으므로 단순 brevity가 아니라 register 효과임. `caveman:full`은 비슷한 token 수(**1005** vs **1042**)지만 문법을 깨고 그럼. 주장 보존은 두 파일의 median만 보면 0.68 vs 0.60이나, 두 arm이 **같은 프롬프트**를 답했으므로 paired가 옳은 통계량 — paired 차이는 **+0.01, 95% CI −0.02~+0.10(8승 4무 4패)**. 한국어에서는 이 코퍼스로 두 도구가 **구분되지 않음**. median 격차는 두 표본을 따로 비교한 데서 온 착시였고, v0.22.1까지 이 repo는 그것을 자기 fidelity 근거 중 강한 쪽으로 인용했음. safety prose 보존은 양쪽 동일(각 12/16). 손실은 breadth이지 오정보가 아님. 현재 모델 pin(`claude-opus-5`, 2026-08-06)에서 같은 코퍼스는 **0.42 · safety 13/19**, 절감은 **+78.3%**로 더 큼 — opus-5가 같은 rule text를 더 공격적으로 적용해 더 많이 압축하고 그만큼 더 버림([근거](./benchmarks/published/README.md#fidelity-judge-scored-n3)). [caveman fidelity](./benchmarks/README.md#caveman-fidelity--the-differentiation-measured). rows: [토큰](./benchmarks/published/results-ko-clean-opus48.jsonl) · judge [opus-4-8](./benchmarks/published/results-ko-fidelity.jsonl) · [opus-5](./benchmarks/published/results-ko-fidelity-opus5.jsonl).

### 영어

| Mode                  | 대표 output tokens (N=25) | normal 대비 절감 |
| --------------------- | ------------------------: | ---------------: |
| `normal`              |                      2344 |       (baseline) |
| `terse`               |                      1796 |             ~23% |
| **`scrooge:en/full`** |                   **773** |         **~67%** |
| `caveman:full`        |                       649 |             ~72% |

`caveman:full`은 raw token이 더 적음(**649** vs **773**). fidelity 차이가 실제로 드러나는 쪽은 영어임: scrooge가 **11개 중 9개**에서 앞서고 paired median **+0.09(95% CI +0.04~+0.11)**. 구간은 0을 제외하나 n=11 exact sign test는 p=0.065라 "방향은 일관되나 확정은 아님"으로 읽어야 함. safety 보존은 동일(각 9/11) — [caveman fidelity](./benchmarks/README.md#caveman-fidelity--the-differentiation-measured). 현재 pin(`claude-opus-5`, 2026-08-06)에서는 **0.50 · safety 15/19**, 절감 **+71.7%**. 영어가 원인을 특정하는 통제군임 — `rules/en/full.md`는 v0.21.0 이후 바이트 단위로 안 바뀌었는데도 같은 폭으로 하락했으므로 register 회귀가 아니라 모델 pin 효과임([전체 논증](./benchmarks/published/README.md#fidelity-judge-scored-n3)). rows: [토큰](./benchmarks/published/results-en-clean-opus48.jsonl) · judge [opus-4-8](./benchmarks/published/results-en-fidelity.jsonl) · [opus-5](./benchmarks/published/results-en-fidelity-opus5.jsonl).

### 일본어 · 힌디어 · 중국어

셋 다 held-out 전용(N=11)이라 별도 튜닝 표가 없음. JA·HI는 한국어 메커니즘을 각 언어 문법에 사상, ZH는 zh-native 신설계임(중국어엔 제거할 경어 형태소·격조사가 없음).

| Register | `normal` | `scrooge` | normal 대비 절감 | fidelity (judge N=3) |
| -------- | -------: | --------: | ---------------: | -------------------: |
| `scrooge:ja/full` | 2399 | **833** | **~65%** (per-prompt 69.6%) | 0.60, safety 11/11 |
| `scrooge:hi/full` | 2436 | **897** | **~63%** (per-prompt 66.6%) | 0.76, safety 10/11 |
| `scrooge:zh/full` | 2703 | **897** | **~67%** (per-prompt 62.9%) | 0.72, safety 11/11 |

`claude-opus-4-8` 측정치이며 표는 측정된 모델을 그대로 유지함. 현재 pin(`claude-opus-5`, 2026-08-06, 같은 코퍼스·N) 재측정: JA **+77.4%**·0.40·safety 10/11, HI **+79.1%**·0.42·10/11, ZH **+72.9%**·0.40·11/11 — KO·EN 절과 같은 교환이고 원인도 같음.

register별 설계 노트·격리 caveat·전체 fidelity 판독: [`benchmarks/README.md`](./benchmarks/README.md#per-language-detail). Raw rows는 [`published/`](./benchmarks/published/).

### 문서 생성

위 표는 대화형 답변 측정. 문서 압축 규칙은 **생성 문서**(README·명세·릴리스 노트)도 대상이며, 각 arm이 전달할 사실을 고정한 held-out corpus로 측정함.

| 언어 | `normal` | `terse` | `scrooge` | prompt당 절감 중앙값 | scrooge < `normal` |
| ---- | -------: | ------: | --------: | -------------------: | :----------------: |
| 한국어 (N=10) | 3554 | 2460 | **1420** | **~48%** | 10 / 10 |
| 영어 (N=11)   | 2772 | 1504 |  **852** | **~55%** | 11 / 11 |

scrooge가 **모든** 프롬프트에서 baseline보다 작았고 `terse` control도 9/10(KO)·11/11(EN)로 이김. 다만 단일 실행·편차가 커서 대화형 headline보다 노이즈가 큼 — 안정적 신호는 승률임. 방법론·분산 caveat·before/after: [`benchmarks/README.md`](./benchmarks/README.md#document-generation-corpus), [`docgen-results.md`](./benchmarks/examples/docgen-results.md).

## caveman과 비교

[caveman](https://github.com/JuliusBrussee/caveman)은 영감을 준 프로젝트. Scrooge는 fork나 README/code 복붙이 아니라, caveman을 명시적 benchmark/reference로 두는 KO-first 독립 구현. **caveman alternative**(caveman 대안), **Korean caveman**(한국어 caveman)을 찾아왔다면 바로 그 자리. 같은 token-miser 아이디어를 번역이 아니라 한국어 1순위로 재구축함.

| 축                | caveman                            | Scrooge                                                |
| ----------------- | ---------------------------------- | ------------------------------------------------------ |
| 1차 목표          | 공격적 영어 압축                   | Korean-native 이중언어 압축                            |
| 언어              | EN (+ wenyan 한문)                 | KO, EN, JA, HI, ZH; `registry.json` 기반 i18n          |
| 한국어 register   | 없음                               | native — 개조식 · 음슴체 · 존댓말 제거 · 반말 default  |
| 이번 영어 결과    | `649` median tokens (telegraphic)  | `773` median tokens — 약간 많고 주장 보존 점수가 소폭 높음 |
| 정면 비교 fidelity (`claude-opus-4-8`) | 0.60 KO · 0.69 EN                  | 0.68 KO · 0.72 EN — 단 **paired**로는 KO 무승부(+0.01, CI가 0 포함), EN만 분리됨(+0.09, 11개 중 9개). 같은 코퍼스·judge N=3, safety는 양쪽 동률. `claude-opus-5`에서는 정면 비교 미실시 — scrooge arm만 재측정했으므로 현재 pin의 caveman 대조군은 없음 |
| 여기서의 벤치마크 | 비교 arm (`caveman:full`)          | 실측 `output_tokens` runner, paired reports            |
| 입력측 압축       | `caveman-shrink`(npm MCP 미들웨어) | 없음 — 출력 register 전용. v0.22.1까지 있던 opt-in `memory-compress` CLI는 자체 측정(floor 7.7%, 실현 가능 ~3~4%)과 prompt cache 요금 구조상 표면 값어치가 없어 제거 |

Scrooge는 caveman에 한국어만 덧댄 문서/구현으로 보이면 안 됨. 핵심은 한국어 1순위 register 설계이고, caveman은 출처와 가장 강한 영어 비교 baseline으로 명시함.

## 메커니즘

1. `/scrooge [lang] [dial]` 명령으로 모드 활성화. 토큰 순서 무관 — `/scrooge ko`, `/scrooge full`, `/scrooge ko full` 등.
2. `UserPromptSubmit` hook이 명령 파싱 → 상태 파일에 `{lang, dial}` 저장 → [`registry.json`](registry.json)으로 규칙 경로 해석 → `additionalContext`로 주입.
3. 이후 매 turn마다 경량 reminder 재주입으로 register drift 방지.
4. `/scrooge off`로 상태 + 글로벌 기본값 삭제(전역 off, 아래 참조). 규칙 자체의 auto-clarity가 안전 컨텍스트(보안 경고, 되돌릴 수 없는 동작 확인, 다단계 절차)에서는 압축 해제 — 사용자가 opt-out할 필요 없음.

**글로벌 기본값.** 아무 세션에서 활성화하면 그 선택이 글로벌 기본값(`~/.claude/.scrooge/default`)으로 저장됨. 모든 새 세션이 같은 lang/dial/flags로 자동 활성 — 한 번만, 어디서든. `SessionStart` hook이 새 세션을 기본값으로 seed하고 full rule을 재주입. `/scrooge off`는 기본값도 삭제(전역 off); 이미 떠 있는 세션은 재시작 전까지 register 유지 — 한 worktree의 off가 동시 세션을 끊지 않음.

**플래그.** lang/dial 외에 행동 플래그가 직교 조합. `lean`(코드 산출물 최소주의)은 **기본 on** — `/scrooge`가 과설계·해설을 덜되 정확성은 절대 안 건드림(fragment가 안전 바닥 고정). `full` 위에서 같은 register의 flag 없는 arm과 paired 측정: **KO +17.6%**(95% CI 10.2–43.7%), **EN +18.1%**(95% CI 10.7–28.3%), est·prose-only·`claude-opus-4-8`, 각 8 prompt × 3 run. 두 CI 모두 0을 제외하고 sign test도 p<0.05를 통과해 방향은 확정. 다만 구간이 넓으므로 `lean`은 정밀 수치가 아니라 "대략 5분의 1 절감"으로 읽어야 함. 재현: `python3 benchmarks/report.py --input results-lean2-{ko,en}.jsonl --baseline scrooge:{ko,en}/full --paired --drop-tool-rows`. 이 수치는 v0.22.1까지 발표한 KO +34.6% / EN +10.3%를 대체 — 기존 수치는 corpus 구조를 오독했고 양쪽에 tool 사용 행이 섞여 있었음([근거](./benchmarks/README.md#the-lean-flag-numbers)). 세션 단위 `/scrooge … nolean` 또는 전역 `SCROOGE_DEFAULT_FLAGS`(쉼표 구분 집합, 또는 빈 값으로 전체 해제)로 토글. 활성 플래그는 각자의 register fragment(`rules/{lang}/fragments/{flag}.md`)를 주입 규칙에 덧붙임.

**언어 추가** (registry-driven dispatch — 분기 추가 아닌 데이터 추가):

1. `rules/{lang}/full.md` 규칙 파일 작성.
2. [`registry.json`](registry.json)에 항목 1개 추가 — `VALID_LANGS`가 이 키에서 derive되므로 slash parser·rule loader가 코드 수정 없이 언어 인식:

   ```json
   {
     "ja": { "full": "rules/ja/full.md" }
   }
   ```

3. [`hooks/lang-meta.js`](hooks/lang-meta.js)에 `LANG_META` 1행 추가 — `reminder`, `countermand`, `flagHint`, `nlCue` — per-turn reminder·off countermand·자연어 활성화 구동. registry 언어에 행이 없으면 `test_registry_parity.js`가 fail.
4. 5건 sample 출력을 QA checklist ([CONTRIBUTING.md](CONTRIBUTING.md)) 기준 self-check → PR.

## 기여

개발 setup, parity 규칙, 언어 추가 절차, PR check, branch protection 지침은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md). English contributing guide는 [CONTRIBUTING.md](CONTRIBUTING.md).

## 라이선스 / 출처

MIT © 2026 Kir93. 자세한 내용은 [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — 컨셉만 차용, i18n-first로 독립 재구현(verbatim 복사 없음).

제작 이야기: [Scrooge 작업기 시리즈](https://kir93.co.kr/tag/scrooge) — 측정하는 압축을 만든 과정 기록.
