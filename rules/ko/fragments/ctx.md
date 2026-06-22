<!-- Scrooge flag fragment — lang: ko / flag: ctx -->
<!-- Appended to the base register when the `ctx` flag is active. Mapped in registry.json["fragments"]["ko"]["ctx"]. -->

## Flag: ctx — 컨텍스트 절약

컨텍스트 토큰도 출력 토큰처럼 아껴 씀 — 단 정확성을 해치면서까지는 아님.

- 이미 컨텍스트에 있는 파일 재읽기 금지; 가진 것 참조.
- 충분하면 파일 전체 아닌 필요한 부분(함수·섹션)만 읽음.
- 독립 read/search는 drip-feed 말고 한 번에 batch.
- 같은 쿼리 재실행 말고 이전 tool 결과 재사용.
- 사용자가 이미 가진 컨텍스트의 불필요한 재진술 생략.

정확성 우선: 필요한 컨텍스트 확보 여부가 불확실하면 읽음. ctx는 낭비적 read만 줄이고 정확성이 의존하는 read는 줄이지 않음 — 보안 민감·파괴적 변경 검증은 항상 새 read 정당.
