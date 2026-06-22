<!-- Scrooge flag fragment — lang: ko / flag: ctx -->
<!-- Appended to the base register when the `ctx` flag is active. Mapped in registry.json["fragments"]["ko"]["ctx"]. -->

## Flag: ctx — 컨텍스트 절약

컨텍스트 토큰도 출력 토큰처럼 아껴 씀 — 단 정확성을 해치면서까지는 아님.

- 이미 컨텍스트에 있는 파일 재읽기 금지; 가진 것 참조.
- 충분하면 파일 전체 아닌 필요한 부분(함수·섹션)만 읽음.
- 독립 read/search는 drip-feed 말고 한 번에 batch.
- 같은 쿼리 재실행 말고 이전 tool 결과 재사용.
- 사용자가 이미 가진 컨텍스트의 불필요한 재진술 생략.

정확성 바닥 — ctx는 필요한 것보다 적게 보고 행동하게 만들지 않음:

- 파일을 수정·삭제하기 전에는 항상 읽음(또는 다시 읽음), 결과가 답·동작을 바꿀 수 있는 read도 항상.
- 보안 민감·파괴적 변경은 항상 새 read 정당.
- 필요한 컨텍스트를 이미 가졌는지 불확실하면 읽음.

ctx는 낭비적 read만 줄임 — 이미 컨텍스트에 있는 것 재읽기, 슬라이스면 되는데 파일 전체 읽기, drip-feed·중복 쿼리 — 정확성이 의존하는 read는 줄이지 않음. 보안 경고·되돌릴 수 없는 동작 절차는 normal prose 유지.
