# Published benchmark evidence

Scrubbed, tracked copies of the measured rows behind every README headline
number — so you can recompute the medians instead of trusting them. Working
`benchmarks/results-*.jsonl` stay local (gitignored); these curated copies pass
the deterministic scrub gate (`benchmarks/scrub.js`) before commit: `output_text`
is removed entirely (decision D2) and any host-context leak (host-rule echo,
`/Users/` path, session-file path) is rejected.

Reproduce any number with the exact command in
[`benchmarks/README.md` § Reproducing a published number](../README.md#reproducing-a-published-number).

## Provenance

Measurement date is **mtime-derived** — the only available source, and an
unreliable one (copying or re-running resets it), so treat it as approximate
(±days). The register version is inferred from the `package.json` version tagged
nearest that date: the row schema records `model` but not the register version,
so this is a reconstruction, not a stored field. Numbers measured on an older
register version reflect that version's rule text — check out the matching tag to
reproduce them exactly.

| File | Backs (README) | Model | Register ver | Measured (approx) | Corpus | Isolation |
| ---- | -------------- | ----- | ------------ | ----------------- | ------ | --------- |
| [`results-ko-clean-opus48.jsonl`](./results-ko-clean-opus48.jsonl) | KO conversational ~70% (paired median, N=21) | `claude-opus-4-8` | v0.19.1 | 2026-07-09 | `prompts/ko.txt` | `--cwd` empty (no host CLAUDE.md) |
| [`results-en-clean-opus48.jsonl`](./results-en-clean-opus48.jsonl) | EN conversational ~66% (paired median, N=25) | `claude-opus-4-8` | v0.19.1 | 2026-07-09 | `prompts/en.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-ko-report-iso-opus48.jsonl`](./results-ko-report-iso-opus48.jsonl) | KO held-out ~71% (paired median, N=11) | `claude-opus-4-8` | ≈v0.7.0 | 2026-06-17 | `prompts/ko-report.txt` | cwd-isolated |
| [`results-en-report-iso-opus48.jsonl`](./results-en-report-iso-opus48.jsonl) | EN held-out ~68% (paired median, N=11) | `claude-opus-4-8` | ≈v0.7.0 | 2026-06-17 | `prompts/en-report.txt` | cwd-isolated |
| [`results-ja-report.jsonl`](./results-ja-report.jsonl) | JA table ~64% (ratio-of-medians, per-prompt median 69.6%, N=11) | `claude-opus-4-8` | ≈v0.14.0 | 2026-06-29 | `prompts/ja-report.txt` | cwd-isolated |
| [`results-hi-report.jsonl`](./results-hi-report.jsonl) | HI held-out ~63% ratio-of-medians (per-prompt median 66.6%, N=11) | `claude-opus-4-8` | ≈v0.15.0 | 2026-07-01 | `prompts/hi-report.txt` | cwd-isolated |
| [`results-zh-report.jsonl`](./results-zh-report.jsonl) | ZH held-out ~67% ratio-of-medians (per-prompt median 62.9%, N=11) | `claude-opus-4-8` | ≈v0.15.0 | 2026-07-01 | `prompts/zh-report.txt` | cwd-isolated |
| [`results-lean2-ko.jsonl`](./results-lean2-ko.jsonl) | KO `lean` +34.6% on top of `full` (paired median, n=22) | `claude-opus-4-8` | ≈v0.9.0 | 2026-06-22 | `prompts/ko.txt` | `--cwd` empty |
| [`results-lean2-en.jsonl`](./results-lean2-en.jsonl) | EN `lean` +10.3% on top of `full` (paired median, n=21) | `claude-opus-4-8` | ≈v0.9.0 | 2026-06-22 | `prompts/en.txt` | `--cwd` empty |
| [`results-hi-tuning.jsonl`](./results-hi-tuning.jsonl) | HI **tuning** corpus: +68.7% vs `normal`, +47.0% vs `terse` (n=16) | `claude-opus-4-8` | v0.21.0 | 2026-07-31 | `prompts/hi.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-zh-tuning.jsonl`](./results-zh-tuning.jsonl) | ZH **tuning** corpus: +75.6% vs `normal`, +49.0% vs `terse` (n=15) | `claude-opus-4-8` | v0.21.0 | 2026-07-31 | `prompts/zh.txt` | `--cwd` empty + global CLAUDE.md aside |

The two `-tuning` files are the **dev/tuning** corpus, not the held-out one every
language table quotes. ADR-003 keeps the two separate, so these numbers exist to
give HI and ZH the `terse` control the other three languages already had — they
are never promoted to a headline. Both ran with the global `~/.claude/CLAUDE.md`
moved aside; without it its "respond in Korean" line pulls the `normal` baseline
into Korean and inflates the saving. Verified after the run: zero Hangul in any
arm, Devanagari in 16/16 HI rows.

ZH excludes **prompt 15**: its `normal` and `terse` runs did not answer at all —
both delegated to a background workflow and returned a stub ("工作流已在后台启动…",
`turns=2`, 226 and 124 tokens against arm medians of 3305 and 1577). That is the
host's own behaviour leaking into the child process, not a register effect, and
the harness's contamination detector only looks for register-hook injection. The
row is kept in the published file so the exclusion is auditable rather than
invisible.

The two `lean` files are flag A/B rows, not language headlines: each pairs
`scrooge:{lang}/full+lean` against `scrooge:{lang}/full` on the same prompt, so
the baseline is the register itself rather than `normal`. Both corpora ran 24
prompt/run pairs; the usable n differs only because of failed runs (KO 2, EN 3).

KO/EN conversational rows were re-measured on 2026-07-09 (v0.19.1) under a pure
baseline — `--cwd` pointed at an empty dir so no project `CLAUDE.md` reaches any
arm, and for EN the global `~/.claude/CLAUDE.md` was set aside so its
"respond in Korean" instruction could not pull the `normal`/`caveman` baselines
into Korean. That pure baseline is why `caveman:full` reaches a slightly smaller
raw-token median than `scrooge` here (it discards information telegraphically);
scrooge's edge is fidelity, not raw tokens (see below).

### Fidelity (judge-scored, N=3)

The judged prose — the baseline/candidate answers and the judge's claim text
(`missing_claims`) — is excluded (D2). Published columns are the judge `score`,
the safety/equivalence flags (`safety_pass`, `equivalent`, `byte_exact_pass`), N
(`judge_runs`), and per-pair token counts. Recompute the median claim-preservation
(median of `score`) and the safety ratio (`safety_pass` true count / N) directly
from these rows.

| File | Backs (README) | Model | Judge N | Measured (approx) |
| ---- | -------------- | ----- | ------- | ----------------- |
| [`results-ko-fidelity.jsonl`](./results-ko-fidelity.jsonl) | KO fidelity 0.68, safety 12/16 — **over the 16 of 18 rows with `judge_runs == 3`**; all 18 rows give 0.69 / 13-of-18, so filter before recomputing | `claude-opus-4-8` | 3 (2 rows fewer) | 2026-07-09 |
| [`results-en-fidelity.jsonl`](./results-en-fidelity.jsonl) | EN fidelity 0.72, safety 9/11 (all 11 rows have `judge_runs == 3`) | `claude-opus-4-8` | 3 | 2026-07-09 |
| [`results-ko-caveman-fidelity.jsonl`](./results-ko-caveman-fidelity.jsonl) | KO `caveman:full` fidelity 0.60, safety 13/18 — the comparison arm for KO scrooge 0.68 | `claude-opus-4-8` | 3 | 2026-07-31 |
| [`results-en-caveman-fidelity.jsonl`](./results-en-caveman-fidelity.jsonl) | EN `caveman:full` fidelity 0.69, safety 10/12 — the comparison arm for EN scrooge 0.72 | `claude-opus-4-8` | 3 | 2026-07-31 |
| [`results-ja-fidelity.jsonl`](./results-ja-fidelity.jsonl) | JA fidelity 0.60 median claim-preservation, safety 11/11 | `claude-opus-4-8` | 3 | 2026-06-29 |
| [`results-hi-fidelity.jsonl`](./results-hi-fidelity.jsonl) | HI fidelity 0.76, safety 10/11 | `claude-opus-4-8` | 3 | 2026-07-01 |
| [`results-zh-fidelity.jsonl`](./results-zh-fidelity.jsonl) | ZH fidelity 0.72, safety 11/11 | `claude-opus-4-8` | 3 | 2026-07-01 |

### Not published

| Source | Why |
| ------ | --- |
| `results-ko-codex-*.jsonl` | Codex runs (pre-opus48), a different harness/tokenizer — **stale**, not cited in any README headline, not re-measured. |
| docgen | Already tracked and scrubbed at [`benchmarks/examples/docgen-results.md`](../examples/docgen-results.md); no raw JSONL layer is duplicated here. |
