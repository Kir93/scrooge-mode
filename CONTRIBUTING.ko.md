# 기여 가이드

[English](CONTRIBUTING.md) · 한국어

Scrooge는 docs-and-rules product. 변경은 작게, user-facing 문서는 이중언어로, registry contract는 [CLAUDE.md](CLAUDE.md#conventions) 기준으로 유지.

## Dev Setup

요구사항:

- Node.js 18 이상.
- Git.
- markdownlint 실행용 `npx` 접근.
- 벤치마크 테스트 실행용 Python 3 (표준 라이브러리만, 패키지 없음).

Setup:

```bash
git clone https://github.com/Kir93/scrooge-mode.git
cd scrooge-mode
npm ci
```

별도 build step 없음. 출하 대상은 `rules/**`, `registry.json`, `skills/**`, `hooks/**`, `bin/**`, `.claude-plugin/**`.

## Test & Lint

PR 전 실행:

```bash
npm test
npx markdownlint-cli2 "**/*.md"
python3 -m unittest discover -s benchmarks -p 'test_*.py'
```

JSON 파일 검증:

```bash
node -e "for (const f of ['package.json','registry.json','.claude-plugin/marketplace.json','.claude-plugin/plugin.json']) JSON.parse(require('fs').readFileSync(f))"
```

registry reachability 검증 — 양방향(`registry.json`의 모든 경로가 `rules/` 아래 실재 파일을 가리키는지, `rules/**/*.md`가 전부 registry에서 도달 가능한지, `fragments.{lang}.{flag}` 포함):

```bash
node --test tests/test_registry_parity.js
```

`npm test`가 이미 이 파일을 실행함. `tests/test_registry_parity.js`가 이 검사의 단일 정본 — `registry ↔ LANG_META ↔ VALID_DIALS` 완전성도 함께 가드하므로, 검사를 추가할 때 문서나 workflow에 사본을 만들지 말고 이 파일에 넣을 것.

GitHub branch protection은 `main` merge 전 세 체크를 필수로 설정: `verify (18)`, `verify (22)`, `markdown-lint`. 이름을 정확히 쓸 것 — `verify`는 node 버전 matrix라 GitHub이 항목마다 체크를 하나씩 발행하고, `verify`라는 이름의 체크는 존재하지 않아 선택할 수 없음. `markdown-lint`는 별 job(node>=20 필요, 버전 matrix 밖에 둬야 낮은 matrix 항목이 깨뜨리거나 matrix 편집이 조용히 누락시키지 않음)이라 `verify` 쌍만 걸면 markdownlint 실패가 merge됨. 셋을 함께 걸어야 test(registry reachability 포함)·markdownlint·JSON 실패가 merge를 차단함. matrix 항목을 추가하면 체크 이름도 늘어남 — 같이 필수로 걸지 않으면 그 버전 실패가 차단을 멈춤.

## Bilingual + Dial Parity

Source of truth는 [CLAUDE.md Conventions](CLAUDE.md#conventions). 요약:

- User-facing docs는 English/Korean mirror 유지. 일본어·중국어는 경량 `README.ja.md`·`README.zh.md` 랜딩(가치 + 설치 + 예시 1개)으로 출하 — 풀 미러 아님, canonical은 영문/국문.
- **JA/ZH 랜딩은 벤치마크 수치를 싣지 않으며, 앞으로도 싣지 않음.** mirror 의무 없이 정직성을 유지하는 방법이 그것 — 수치가 들어가는 순간 측정이 바뀔 때마다 조용히 stale해지고, 이를 막는 가드가 없음. 가치·설치·활성화·before/after 예시 1개까지만 두고 모든 수치는 canonical README로 링크.
- **힌디어는 register만 출하하며 README 랜딩이 없음.** 누락이 아니라 결정임: `rules/hi/*`와 `LANG_META.hi` 행은 완비돼 다른 언어와 동일한 테스트로 가드되지만, `README.hi.md`는 없고 수요가 생기기 전까지 만들지 않음. parity 수정 명목으로 추가 PR을 열지 말 것.
- 실질 rule 변경은 `ko`/`en`/`ja`/`hi`/`zh` mirror 유지. 의도적 비동기면 PR에 이유 명시.
- `rules/**` rename/move는 같은 PR에서 `registry.json` 수정.
- Safety auto-clarity는 모든 dial에 유지.
- Docs/prose 압축 경계와 Docs escape도 모든 dial에 유지. `test_doc_boundaries.js`·`test_safety_escape.js`가 `ko`/`en`/`ja`/`hi`/`zh`를 순회하고, `test_registry_parity.js`가 `registry ↔ LANG_META ↔ VALID_DIALS` 완전성 + rule 도달성을 가드 — 신규 언어는 registry·`LANG_META`·해당 루프에 합류하면 rule 파일과 활성화 메타가 자동 보증됨.

## Adding a Language

활성화는 registry-driven dispatch라 새 언어는 분기 추가가 아니라 데이터 추가:

1. `rules/{lang}/full.md` 신규 작성.
2. `registry.json[lang]`에 `full` path 추가. `VALID_LANGS`가 이 키에서 derive되므로 slash parser·rule loader가 코드 수정 없이 언어 인식.
3. `hooks/lang-meta.js`에 `LANG_META[lang]` 1행 추가 — `reminder`(full body), `countermand`, `flagHint`, `nlCue`(activate/off/negate/meta/strong). per-turn reminder·off countermand·자연어 활성화를 구동; 없으면 rule은 로드되나 reminder·NL cue 부재. `test_registry_parity.js`가 행 누락 언어를 fail 처리.
4. sample output 5건 생성 후 [docs/ko-qa-checklist.md](docs/ko-qa-checklist.md)와 같은 QA checklist로 self-check: register 일관, code/error/technical term 원문, safety prose, 조사 드롭 명확성, honorific policy.
5. README, INSTALL, CONTRIBUTING mirror 검토. 새 언어가 설치/활성화/기여 흐름을 바꾸면 user-facing docs 갱신.
6. sample self-check 요약과 [Test & Lint](#test--lint) 명령 결과 포함해 PR open.

registry parity check가 registry 누락·unreachable rule file·`LANG_META` 행 누락 언어를 자동 catch.

## PR Conventions

- PR 하나에 behavioral 또는 documentation concern 하나.
- bilingual parity 유지 여부 명시.
- verification command와 결과 포함.
- `.claude/`, `.agents/`, `skills-lock.json`, `node_modules/` 같은 local agent/generated file 커밋 금지.
- required branch protection check `verify (18)`·`verify (22)`·`markdown-lint` 셋 다 통과 전 merge 금지.

## Code of Conduct

직접적이고 기술적으로, 존중 있게 소통. 비판은 변경과 결과에 집중. security-sensitive issue는 public issue 대신 maintainer에게 private report.
