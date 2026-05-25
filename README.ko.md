# Scrooge 🪙

[English](README.md) | 한국어

> 토큰은 돈이다. 그래서 아낀다.

🚧 **초기 개발 단계.** 구현됨: i18n 레지스트리, 압축 register, 멀티 에이전트 설치기, 활성화 hook, 절감 통계. 진행 중: npm / Claude Code marketplace 배포(아직 `claude plugin install` 미동작 — `--dry-run`으로 미리보기)와 벤치마크.

**Scrooge**는 AI 코딩 에이전트가 **기술적 정확성을 온전히 유지하면서** 압축된 register로 응답하게 만들어 **출력 토큰**을 줄이는 것을 목표로 합니다 — 영어와 함께 **한국어를 1순위 언어**로.

## 왜 Scrooge인가 — 포지셔닝은 "접근성"

기존 압축 도구는 영어·한문 소양을 전제로 합니다. Scrooge는 한국어를 1순위 언어로 두어, 그런 배경 없이도 모국어로 토큰을 아낄 수 있게 합니다.

## i18n 아키텍처

현재 구현된 것: `언어 × dial → 규칙 파일 경로`를 1:1로 해석하는 레지스트리. 언어 규칙을 core 로직에 하드코딩하지 않아, 언어 추가는 두 단계입니다.

1. `rules/{lang}/{lite,full}.md` 규칙 파일 작성
2. [registry.json](registry.json)에 항목 1개 추가:

```json
{
  "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
}
```

## 라이선스 / 출처

MIT © 2026 Kir93. 자세한 내용은 [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — 컨셉만 차용, 코드는 i18n-first로 독립 재구현(verbatim 복사 없음).
