# Scrooge 🪙

[English](README.md) | 한국어

> 토큰은 돈이다. 그래서 아낀다.

**Scrooge**는 AI 코딩 에이전트가 **기술적 정확성을 온전히 유지하면서** 압축된 register로
응답하게 만들어 **출력 토큰**을 줄이는 한국어 우선 이중언어(KO/EN) skill입니다.
페르소나는 토큰을 한 푼도 허투루 안 쓰는 구두쇠(스크루지).

## 왜 Scrooge인가 — 포지셔닝은 "접근성"

기존 압축 도구는 영어·한문 소양을 전제로 합니다. Scrooge는 **한국어를 1순위 언어**로 두어,
한문/영어에 익숙하지 않아도 자연스러운 압축 출력을 쓸 수 있게 합니다.
**누구나 모국어로 토큰을 아낄 수 있다**는 접근성이 목표입니다.

## Register: 언어 × 강도(dial)

출시 시점에 **KO + EN** 각각 **두 강도**(`lite` / `full`)를 제공합니다.

| Lang | Dial   | 규칙 요약 |
| ---- | ------ | --------- |
| KO   | `lite` | 다듬은 존댓말 — 존대 종결 유지, filler·빈 인사·hedging 드롭 |
| KO   | `full` | 개조식 + 음슴체 — 명사형/`~함`·`~됨`, 조사 드롭, 주어 pro-drop |
| EN   | `lite` | filler/pleasantry/hedging 드롭, 완전 문법 + article 유지 |
| EN   | `full` | Caveman 스타일 — article·filler 드롭, fragment 허용, 짧은 동의어 |

모든 dial 공통: **code block·error·기술 용어는 원문 유지**, **압축보다 명료성 우선**.
보안 경고·되돌릴 수 없는 동작 확인 등 안전 관련 내용은 dial 무관 항상 normal prose로 복귀합니다.

## 설치

```bash
curl -fsSL https://raw.githubusercontent.com/Kir93/scrooge-mode/main/install.sh | bash
```

설치기가 머신에 깔린 AI 코딩 에이전트(Claude Code, Codex 등)를 자동 감지해 각각에 Scrooge를 설치합니다.
없는 에이전트는 에러 없이 건너뜁니다.

## 사용

Scrooge는 **독립적인 두 축**을 가집니다 — 언어 `{ko, en}`, 강도 `{lite, full}`.
각 축은 따로 지속되며, 지정하지 않은 축은 현재 값을 유지합니다. 순서는 무관합니다.

```text
/scrooge            # 기본 register (en / full)
/scrooge lite       # 강도 → lite   (언어 유지)
/scrooge full       # 강도 → full   (언어 유지)
/scrooge ko         # 언어 → ko     (강도 유지)
/scrooge en         # 언어 → en     (강도 유지)
/scrooge ko lite    # 둘 다 설정     (순서 무관)
```

두 축의 값 집합이 겹치지 않아, 각 토큰이 어느 축인지 모호함 없이 결정됩니다.
모드는 변경하거나 세션이 끝날 때까지 지속됩니다.
scrooge 모드로 turn이 진행되면 statusline에 세션 누적 절감 토큰이 표시됩니다
(에이전트 세션 로그에서 읽은 실측치, 추정 아님).

## 새 언어 추가 (i18n-first)

Scrooge는 언어 규칙을 core 로직에 하드코딩하지 않습니다. 새 언어 추가는 **두 가지만** 하면 됩니다.

1. `rules/{lang}/{lite,full}.md` 규칙 파일 작성
2. [registry.json](registry.json)에 항목 1개 추가:

```json
{
  "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
}
```

activation·stats·installer 등 core 코드 수정은 필요 없습니다. `registry.json`이 `언어 × dial → 규칙 파일 경로`를 1:1로 해석합니다.

## 라이선스 / 출처

MIT © 2026 Kir93. 자세한 내용은 [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — 컨셉만 차용, 코드는 i18n-first로 독립 재구현(verbatim 복사 없음).
