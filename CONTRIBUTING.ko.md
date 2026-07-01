# 기여 가이드

[English](CONTRIBUTING.md) · 한국어

Scrooge는 docs-and-rules product. 변경은 작게, user-facing 문서는 이중언어로, registry contract는 [CLAUDE.md](CLAUDE.md#conventions) 기준으로 유지.

## Dev Setup

요구사항:

- Node.js 18 이상.
- Git.
- markdownlint 실행용 `npx` 접근.

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
```

JSON 파일 검증:

```bash
node -e "for (const f of ['package.json','registry.json','.claude-plugin/marketplace.json','.claude-plugin/plugin.json']) JSON.parse(require('fs').readFileSync(f))"
```

registry reachability 검증:

```bash
node --input-type=module <<'NODE'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const registry = JSON.parse(readFileSync('registry.json', 'utf8'));
const reachable = new Set();
const errors = [];

for (const [lang, dials] of Object.entries(registry)) {
  for (const [dial, rulePath] of Object.entries(dials)) {
    const normalized = String(rulePath).trim();
    if (!normalized.startsWith('rules/')) errors.push(`${lang}.${dial} outside rules/: ${normalized}`);
    else if (!existsSync(normalized) || !statSync(normalized).isFile()) errors.push(`${lang}.${dial} missing: ${normalized}`);
    else reachable.add(path.normalize(normalized));
  }
}

function listMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(filePath);
    if (entry.isFile() && entry.name.endsWith('.md')) return [filePath];
    return [];
  });
}

for (const filePath of listMarkdownFiles('rules')) {
  if (!reachable.has(path.normalize(filePath))) errors.push(`unreachable rule: ${filePath}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
NODE
```

GitHub branch protection은 `main` merge 전 `CI / verify` workflow 필수로 설정. test, markdownlint, registry, JSON 실패가 merge 차단하도록 함.

## Bilingual + Dial Parity

Source of truth는 [CLAUDE.md Conventions](CLAUDE.md#conventions). 요약:

- User-facing docs는 English/Korean mirror 유지. 일본어·중국어는 경량 `README.ja.md`·`README.zh.md` 랜딩(가치 + 설치 + 예시 1개)으로 출하 — 풀 미러 아님, canonical은 영문/국문.
- 실질 rule 변경은 `ko`/`en`/`ja`/`hi`/`zh`, `lite`/`full` mirror 유지. 의도적 비동기면 PR에 이유 명시.
- `rules/**` rename/move는 같은 PR에서 `registry.json` 수정.
- Safety auto-clarity는 모든 dial에 유지.
- Docs/prose 압축 경계와 Docs escape도 모든 dial에 유지. `test_doc_boundaries.js`·`test_safety_escape.js`가 `ko`/`en`/`ja`/`hi`/`zh`를 순회하고, `test_registry_parity.js`가 `registry ↔ LANG_META ↔ VALID_DIALS` 완전성 + rule 도달성을 가드 — 신규 언어는 registry·`LANG_META`·해당 루프에 합류하면 rule 파일과 활성화 메타가 자동 보증됨.

## Adding a Language

활성화는 registry-driven dispatch라 새 언어는 분기 추가가 아니라 데이터 추가:

1. `rules/{lang}/lite.md`, `rules/{lang}/full.md` 신규 작성.
2. `registry.json[lang]`에 `lite`, `full` path 추가. `VALID_LANGS`가 이 키에서 derive되므로 slash parser·rule loader가 코드 수정 없이 언어 인식.
3. `hooks/lang-meta.js`에 `LANG_META[lang]` 1행 추가 — `reminder`(lite/full body), `countermand`, `flagHint`, `nlCue`(activate/off/negate/meta/strong). per-turn reminder·off countermand·자연어 활성화를 구동; 없으면 rule은 로드되나 reminder·NL cue 부재. `test_registry_parity.js`가 행 누락 언어를 fail 처리.
4. sample output 5건 생성 후 [docs/ko-qa-checklist.md](docs/ko-qa-checklist.md)와 같은 QA checklist로 self-check: register 일관, code/error/technical term 원문, safety prose, 조사 드롭 명확성, honorific policy.
5. README, INSTALL, CONTRIBUTING mirror 검토. 새 언어가 설치/활성화/기여 흐름을 바꾸면 user-facing docs 갱신.
6. sample self-check 요약과 [Test & Lint](#test--lint) 명령 결과 포함해 PR open.

registry parity check가 registry 누락·unreachable rule file·`LANG_META` 행 누락 언어를 자동 catch.

## PR Conventions

- PR 하나에 behavioral 또는 documentation concern 하나.
- bilingual/dial parity 유지 여부 명시.
- verification command와 결과 포함.
- `.claude/`, `.agents/`, `skills-lock.json`, `node_modules/` 같은 local agent/generated file 커밋 금지.
- required `CI / verify` branch protection check 통과 전 merge 금지.

## Code of Conduct

직접적이고 기술적으로, 존중 있게 소통. 비판은 변경과 결과에 집중. security-sensitive issue는 public issue 대신 maintainer에게 private report.
