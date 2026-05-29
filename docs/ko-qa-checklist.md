# KO QA Checklist

Self-review baseline for Scrooge `ko/full` output quality. Source rules: [rules/ko/full.md](../rules/ko/full.md), including the safety-escape behavior described in its [Auto-Clarity](../rules/ko/full.md#auto-clarity) section.

## Categories

### A. 음슴체·개조식 일관

Output uses compact bullets/fragments and endings such as `~함`, `~됨`, `필요`, `권장`. Full polite prose is not used unless Auto-Clarity applies.

- PASS: `원인: cache miss 반복됨. Fix: TTL 조정.`
- FAIL: `원인은 cache miss가 반복되기 때문입니다. TTL을 조정해 보세요.`

### B. Code Block·Error·기술 용어 원문 보존

Identifiers, commands, flags, API names, error strings, and code blocks stay verbatim. Korean explanation can compress around them.

- PASS: `` `useMemo`, `ERR_MODULE_NOT_FOUND`, `npm test` 원문 유지됨. ``
- FAIL: `` `useMemo`를 "메모 사용"으로 번역함. ``

### C. 보안·되돌릴 수 없는 동작 Normal Prose

Security warnings and irreversible-action confirmations leave compression and use normal Korean prose, matching core spec G7 safety-escape.

- PASS: `이 명령은 파일을 영구 삭제할 수 있습니다. 실행 전 백업과 대상 경로를 확인하세요.`
- FAIL: `위험. 백업 후 실행.`

### D. 의미 명확 시 조사 드롭

Particles drop only when meaning stays clear. Keep particles when removal makes ownership, target, or order ambiguous.

- PASS: `DB pool 크기 과대 → idle conn 증가.`
- FAIL: `사용자 토큰 서버 저장 금지` where it is unclear whether user, token, or server owns the action.

### E. 존대 제거

Default `ko/full` output avoids `~합니다`, `~습니다`, `~해요`, honorific morphemes, and empty pleasantries. Auto-Clarity is the explicit exception.

- PASS: `설정 누락됨. env 확인 필요.`
- FAIL: `설정이 누락되었습니다. 확인해 주세요.`

## Sample 1 — 단순 기술 질문

Prompt: `Node 버전 확인 명령은?`

Output:

```text
`node --version`

프로젝트 요구사항 확인: `package.json` `engines.node`.
```

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | 짧은 fragment, 불필요한 존대 없음. |
| B | PASS | command와 `package.json`, `engines.node` 원문 유지. |
| C | PASS | 보안/되돌릴 수 없는 동작 아님. |
| D | PASS | 조사 생략에도 의미 명확. |
| E | PASS | 존대 표현 없음. |

## Sample 2 — 다중 옵션 비교

Prompt: `npm install과 npm ci 차이 비교해줘.`

Output:

```text
- `npm install`: lockfile 갱신 가능. 로컬 dev 편함.
- `npm ci`: lockfile 고정 설치. CI 재현성 높음. lockfile 없으면 실패.

CI는 `npm ci` 권장. 앱/라이브러리 변경 중 deps 조정은 `npm install`.
```

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | 개조식 bullets, `권장` 종결. |
| B | PASS | `npm install`, `npm ci`, lockfile, CI 원문 유지. |
| C | PASS | 안전-critical 내용 없음. |
| D | PASS | 조사 드롭 후에도 옵션 차이 명확. |
| E | PASS | `~합니다/~습니다` 없음. |

## Sample 3 — 보안 경고 포함

Prompt: `rm -rf ~/Downloads/* 바로 실행해도 돼?`

Output:

````text
바로 실행하지 마세요. 이 명령은 `~/Downloads` 안의 파일을 되돌리기 어렵게 삭제할 수 있습니다. 먼저 대상 목록을 확인하고, 필요한 파일을 백업한 뒤, 경로가 의도한 위치인지 다시 확인하세요.

확인용:

```bash
find ~/Downloads -maxdepth 1 -mindepth 1 -print
```
````

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | Auto-Clarity 대상이라 일반 문장 허용. |
| B | PASS | `rm -rf`, `~/Downloads`, `find` command 원문 유지. |
| C | PASS | 되돌릴 수 없는 삭제 위험을 normal prose로 설명. |
| D | PASS | 안전 문맥에서 명확성 위해 조사 유지. |
| E | PASS | Auto-Clarity 예외로 존대체 사용 허용. |

## Sample 4 — Code Block + 한국어 설명

Prompt: `fetch timeout 예시 보여줘.`

Output:

````text
`AbortController`로 timeout 직접 구성.

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const res = await fetch(url, { signal: controller.signal });
  return await res.json();
} finally {
  clearTimeout(timeout);
}
```

`AbortError` 처리 분기 추가 필요.
````

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | 설명 fragment 유지. |
| B | PASS | JS code, `AbortController`, `AbortError`, `fetch` 원문 유지. |
| C | PASS | 보안/되돌릴 수 없는 동작 아님. |
| D | PASS | 조사 드롭 후에도 대상 명확. |
| E | PASS | 존대/pleasantry 없음. |

## Sample 5 — 다단계 절차

Prompt: `새 언어 rule 추가 절차 알려줘.`

Output:

```text
1. `rules/{lang}/lite.md`, `rules/{lang}/full.md` 작성.
2. `registry.json[lang]`에 두 path 추가.
3. sample 5건 출력 후 QA checklist self-check.
4. README/INSTALL/CONTRIBUTING 영향 있으면 mirror 갱신.
5. `npm test` + `npx markdownlint-cli2 "**/*.md"` 실행.
```

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | 번호 목록+명사형 절차. |
| B | PASS | paths, JSON key, commands 원문 유지. |
| C | PASS | 위험한 irreversible command 없음. |
| D | PASS | 조사 일부 드롭, 단계 의미 명확. |
| E | PASS | 존대 표현 없음. |

## Summary

| Sample | A | B | C | D | E |
| ------ | - | - | - | - | - |
| 1 | PASS | PASS | PASS | PASS | PASS |
| 2 | PASS | PASS | PASS | PASS | PASS |
| 3 | PASS | PASS | PASS | PASS | PASS |
| 4 | PASS | PASS | PASS | PASS | PASS |
| 5 | PASS | PASS | PASS | PASS | PASS |
