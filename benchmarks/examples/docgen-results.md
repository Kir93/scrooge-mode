# Doc-generation benchmark — per-prompt results (published run)

Tracked provenance for the **Document generation** numbers in [`../../README.md`](../../README.md).
These are the exact per-prompt `usage.output_tokens` (prose bucket) behind the published
medians and win-rates, so the headline is auditable from tracked data rather than only a
local JSONL.

- **Model**: `claude-opus-4-8`. **Run**: single run (`--runs 1`).
- **Clean baseline**: host `~/.claude/CLAUDE.md` moved aside + empty `--cwd` + `--disallow-tools`
  (inline output, no file offload). Register hooks isolated by `run.py` as usual.
- **Corpus**: [`../prompts/ko-docgen.txt`](../prompts/ko-docgen.txt) /
  [`en-docgen.txt`](../prompts/en-docgen.txt) (facts pinned; same information per arm).
- **Single-run + heavy-tailed**: these exact numbers are not reproducible turn-for-turn —
  re-running gives different per-cell values (the same prompt can land tens of points apart
  across runs). The within-run per-prompt reductions already span 7–75% (KO) and 34–92% (EN),
  so the stable signal is the **per-prompt win-rate**, not any single percentage. A few prompts show
  `— (timeout)` where a verbose arm could not finish inline within 600s and is excluded from
  the paired set (so the most verbose baselines are dropped — the savings are conservative).

## Korean

| # | 문서 종류 | `normal` | `terse` | `scrooge` | scrooge vs normal |
| - | --- | -: | -: | -: | -: |
| 0 | README 설치 섹션 | 1229 | 1195 | 685 | −44% |
| 1 | 기능 명세 | 10340 | 7123 | 9565 | −7% |
| 2 | API 레퍼런스 | 3528 | 2760 | 2411 | −32% |
| 3 | 마이그레이션 가이드 | 7407 | 7791 | 4113 | −44% |
| 4 | 아키텍처 개요 | — (timeout) | — (timeout) | — (timeout) | — |
| 5 | 릴리스 노트 | 1839 | 1309 | 776 | −58% |
| 6 | 트러블슈팅 가이드 | 4945 | 2542 | 1237 | −75% |
| 7 | 온보딩 문서 | 4360 | 4930 | 1602 | −63% |
| 8 | 설정 레퍼런스 | 3579 | 2379 | 1944 | −46% |
| 9 | ADR | 2999 | 1239 | 1010 | −66% |
| 10 | 컴포넌트 사용 문서 | 1413 | 1533 | 712 | −50% |
| 11 | 배포 런북 | — (timeout) | — (timeout) | 2164 | — |

- **Paired N=10** (prompts where all three arms completed): `[0, 1, 2, 3, 5, 6, 7, 8, 9, 10]`
- Median tokens — `normal` 3554 · `terse` 2460 · `scrooge` 1420
- **Median per-prompt savings vs `normal`: 48%** (median of each prompt's reduction; range 7–75%)
- Ratio of medians vs `normal`: 60% · vs `terse`: 42%
- scrooge produced fewer tokens than `normal` on **10/10** prompts, than `terse` on **9/10**

## English

| # | 문서 종류 | `normal` | `terse` | `scrooge` | scrooge vs normal |
| - | --- | -: | -: | -: | -: |
| 0 | README 설치 섹션 | 664 | 729 | 395 | −41% |
| 1 | 기능 명세 | 13287 | 6621 | 1334 | −90% |
| 2 | API 레퍼런스 | 3254 | 4658 | 1413 | −57% |
| 3 | 마이그레이션 가이드 | 4938 | 6299 | 2295 | −54% |
| 4 | 아키텍처 개요 | 8287 | 9806 | — (timeout) | — |
| 5 | 릴리스 노트 | 848 | 750 | 422 | −50% |
| 6 | 트러블슈팅 가이드 | 1264 | 990 | 574 | −55% |
| 7 | 온보딩 문서 | 9640 | 2204 | 772 | −92% |
| 8 | 설정 레퍼런스 | 1299 | 1504 | 852 | −34% |
| 9 | ADR | 3133 | 1099 | 927 | −70% |
| 10 | 컴포넌트 사용 문서 | 1128 | 808 | 540 | −52% |
| 11 | 배포 런북 | 2772 | 2127 | 928 | −67% |

- **Paired N=11** (prompts where all three arms completed): `[0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]`
- Median tokens — `normal` 2772 · `terse` 1504 · `scrooge` 852
- **Median per-prompt savings vs `normal`: 55%** (median of each prompt's reduction; range 34–92%)
- Ratio of medians vs `normal`: 69% · vs `terse`: 43%
- scrooge produced fewer tokens than `normal` on **11/11** prompts, than `terse` on **11/11**
