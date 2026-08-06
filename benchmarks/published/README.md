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
| [`results-en-clean-opus48.jsonl`](./results-en-clean-opus48.jsonl) | EN conversational ~67% (paired median, N=24) | `claude-opus-4-8` | v0.19.1 | 2026-07-09 | `prompts/en.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-ko-report-iso-opus48.jsonl`](./results-ko-report-iso-opus48.jsonl) | KO held-out ~70% (paired median, N=10) | `claude-opus-4-8` | ≈v0.7.0 | 2026-06-17 | `prompts/ko-report.txt` | cwd-isolated |
| [`results-en-report-iso-opus48.jsonl`](./results-en-report-iso-opus48.jsonl) | EN held-out ~68% (paired median, N=11) | `claude-opus-4-8` | ≈v0.7.0 | 2026-06-17 | `prompts/en-report.txt` | cwd-isolated |
| [`results-ja-report.jsonl`](./results-ja-report.jsonl) | JA table ~65% (ratio-of-medians, per-prompt median 69.6%, N=10) | `claude-opus-4-8` | ≈v0.14.0 | 2026-06-29 | `prompts/ja-report.txt` | cwd-isolated |
| [`results-hi-report.jsonl`](./results-hi-report.jsonl) | HI held-out ~63% ratio-of-medians (per-prompt median 66.6%, N=11) | `claude-opus-4-8` | ≈v0.15.0 | 2026-07-01 | `prompts/hi-report.txt` | cwd-isolated |
| [`results-zh-report.jsonl`](./results-zh-report.jsonl) | ZH held-out ~67% ratio-of-medians (per-prompt median 62.9%, N=11) | `claude-opus-4-8` | ≈v0.15.0 | 2026-07-01 | `prompts/zh-report.txt` | cwd-isolated |
| [`results-lean2-ko.jsonl`](./results-lean2-ko.jsonl) | KO `lean` +17.6% on top of `full` (per-prompt median, 8 prompts x 3 runs) | `claude-opus-4-8` | ≈v0.9.0 | 2026-06-22 | `prompts/ko.txt` | `--cwd` empty |
| [`results-lean2-en.jsonl`](./results-lean2-en.jsonl) | EN `lean` +18.1% on top of `full` (per-prompt median, 8 prompts x 3 runs) | `claude-opus-4-8` | ≈v0.9.0 | 2026-06-22 | `prompts/en.txt` | `--cwd` empty |
| [`results-hi-tuning.jsonl`](./results-hi-tuning.jsonl) | HI **tuning** corpus: +68.7% vs `normal`, +47.0% vs `terse` (n=16) | `claude-opus-4-8` | v0.21.0 | 2026-07-31 | `prompts/hi.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-zh-tuning.jsonl`](./results-zh-tuning.jsonl) | ZH **tuning** corpus: +75.6% vs `normal`, +49.0% vs `terse` (n=15) | `claude-opus-4-8` | v0.21.0 | 2026-07-31 | `prompts/zh.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-en-agentic.jsonl`](./results-en-agentic.jsonl) | EN **agentic** workload: `scrooge:en/full` +52.0% total output (paired median, N=10) — `append` mode, not comparable to the conversational tables | `claude-opus-4-8` | v0.23.0 | 2026-08-05 | `prompts/en-agentic.txt` over `agentic-fixture/` | `--cwd` fixture, reset per call + global CLAUDE.md aside |
| [`results-en-debunk.jsonl`](./results-en-debunk.jsonl) | EN false-premise: `scrooge:en/full` 10/10 debunked (judge N=3) | `claude-opus-4-8` | v0.23.0 | 2026-08-05 | `prompts/en-falsepremise.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-ko-debunk.jsonl`](./results-ko-debunk.jsonl) | KO false-premise: `scrooge:ko/full` **19/20** debunked (judge N=3), vs `normal` 19/19 — Fisher exact p=1.000 | `claude-opus-4-8` | v0.23.0 | 2026-08-05 | `prompts/ko-falsepremise.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-debunk-controls.jsonl`](./results-debunk-controls.jsonl) | `normal` / `terse` control arms for both false-premise corpora (judge N=1) | `claude-opus-4-8` | v0.23.0 | 2026-08-05 | `prompts/{en,ko}-falsepremise.txt` | `--cwd` empty + global CLAUDE.md aside |
| [`results-ko-report-opus5.jsonl`](./results-ko-report-opus5.jsonl) | KO held-out **+77.3%** ratio-of-medians (per-prompt median 78.3%, N=19) | `claude-opus-5` | v0.23.0 | 2026-08-06 | `prompts/ko-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-en-report-opus5.jsonl`](./results-en-report-opus5.jsonl) | EN held-out **+71.2%** ratio-of-medians (per-prompt median 71.7%, N=19) | `claude-opus-5` | v0.23.0 | 2026-08-06 | `prompts/en-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-ja-report-opus5.jsonl`](./results-ja-report-opus5.jsonl) | JA held-out **+77.4%** ratio-of-medians (per-prompt median 74.0%, N=11) | `claude-opus-5` | v0.23.0 | 2026-08-06 | `prompts/ja-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-hi-report-opus5.jsonl`](./results-hi-report-opus5.jsonl) | HI held-out **+79.1%** ratio-of-medians (per-prompt median 81.1%, N=11) | `claude-opus-5` | v0.23.0 | 2026-08-06 | `prompts/hi-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-zh-report-opus5.jsonl`](./results-zh-report-opus5.jsonl) | ZH held-out **+72.9%** ratio-of-medians (per-prompt median 70.7%, N=11) | `claude-opus-5` | v0.23.0 | 2026-08-06 | `prompts/zh-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |

The three `-debunk` files are the **safety axis**, not claim-preservation: each row
is one boolean — did the answer reject the false premise the question asserted.
They back [False premises](../README.md#false-premises--one-demonstrated-failure-no-measurable-deficit),
which reports one reproducible Korean failure at a rate the sample cannot separate from the baseline. They are published because a measurement you
might fail is only worth running if you publish it either way.

**Register drift 2026-08 — disclosed, then closed by re-measurement (2026-08-06).**
The `claude-opus-4-8` judge rows were measured against register v0.21.x. `rules/**`
then changed substantively in v0.22.0 (safety-guard and pro-drop porting across all
ten registers) and again in v0.23.0 (the `lite` dial removed), and v0.22.0/v0.22.1
shipped with the CI re-measurement marker firing and no record at all. v0.23.0 took
the `Disclose` disposition [`RELEASE.md`](../../RELEASE.md) §1a defines. The judge
has now been re-run on the current register — the `-opus5` rows below — so the
disclosure is discharged rather than carried forward.

**What the re-measure found: the drop is the model, not the register.** Every
language fell on claim-preservation (KO 0.68→0.42, EN 0.72→0.50, JA 0.60→0.40,
HI 0.76→0.42, ZH 0.72→0.40) while output saved rose (+4 to +15pp). That reads like
a register regression until you check English: `rules/en/full.md` is **byte-identical
between v0.21.0 and v0.23.0** (`git show v0.21.0:rules/en/full.md | shasum` matches
`HEAD`), yet EN fell 0.22 on the same 11 prompts — inside the −0.20…−0.34 range of
the four languages whose register *did* change. An unchanged register cannot cause
its own regression, so the common cause is the model pin, `claude-opus-4-8` →
`claude-opus-5`.

The mechanism is on the candidate side, not the baseline. Median `scrooge` output
fell in every language (KO 986→768, EN 1076→665, JA 880→750, HI 897→675,
ZH 897→702) while the `normal` baseline moved both ways (EN 2575→2311, ZH
2703→2594, KO 3285→3381, JA 2477→3313, HI 2436→3226). So opus-5 applies the same
rule text **more aggressively** — it compresses harder and drops more claims doing
it. Higher savings and lower claim-preservation are the same fact seen twice.
Fidelity is measured against whatever the baseline asserted, so these figures are
not comparable across model pins; both sets stay published side by side rather than
one replacing the other.

Both `-opus5` sets ran with `ultracode` disabled in the host `settings.json`. Left
on, it tells every `claude --print` child to author a multi-agent workflow; the child
announces the delegation and dies mid-response, and it hits the `normal` baseline far
harder than the compressed arms (measured: `normal` completed 8/19 with it on,
19/19 with it off). That is a selection effect on the baseline, not noise, so
`benchmarks/run.py` host isolation now switches the flag off for the duration of a
run and restores it afterwards.

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

**Generalised in v0.23.0.** That exclusion was hand-applied and ZH-only, so the
reproduce command printed next to the ZH table returned different numbers than the
table. `report.py --drop-tool-rows` now drops any prompt/run key whose row used
tools (`tool_use_output_tokens > 0` or `turns > 1`) **from every arm**, and it
reproduces the published ZH figures exactly. Re-deriving the other files under the
same rule found the same defect in four more places, all previously unnoticed:

| File | Row | Effect of the fix |
| ---- | --- | ----------------- |
| `results-en-clean-opus48.jsonl` | `normal` pid=5 — 2,649 prose beside 3,153 tool tokens | EN 66% → **67%** |
| `results-ja-report.jsonl` | `normal` pid=9 — 7,351 prose, 4,622 tool, `turns=5` | JA 64% → **65%** |
| `results-ko-report-iso-opus48.jsonl` | `normal` pid=7 — 3,676 prose, 4,754 tool, `turns=4` | KO held-out 71% → **70%** |
| `results-lean2-en.jsonl` | `scrooge:en/full` pid=1 run=0 — 119 prose beside 7,645 tool tokens | EN `lean` +10.3% → **+18.1%** |
| `results-lean2-ko.jsonl` | `scrooge:ko/full+lean` pid=4 run=0 — 569 prose, 3,060 tool | KO `lean` +34.6% → **+17.6%** |

Three of the five sat in a baseline arm, so the correction moved two language
headlines up and one down. The underlying JSONL is unchanged — every row is still
published, including the dropped ones, so any reader can re-run with and without
the flag and see both numbers.

The `lean` restatement is the larger one: those two files are **8 prompts × 3
runs**, and the superseded figures quoted the 21–22 paired-key count as though it
were the prompt count. Corrected, the two languages agree (+17.6% / +18.1%) instead
of differing by 24pp. See
[The `lean` flag numbers](../README.md#the-lean-flag-numbers).

The two `lean` files are flag A/B rows, not language headlines: each pairs
`scrooge:{lang}/full+lean` against `scrooge:{lang}/full` on the same prompt, so
the baseline is the register itself rather than `normal`. Each corpus is **8
prompts run 3 times** (24 prompt/run pairs; the usable count drops to 21/20 on
failed runs and the tool-row exclusion above). The bootstrap resamples the 8
prompts rather than the pairs — repeated runs of one prompt are correlated, so
treating them as independent draws would understate the interval.

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
| [`results-ko-fidelity-opus5.jsonl`](./results-ko-fidelity-opus5.jsonl) | KO fidelity **0.42**, safety 13/19 — current register on the current model pin | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-en-fidelity-opus5.jsonl`](./results-en-fidelity-opus5.jsonl) | EN fidelity **0.50**, safety 15/19 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-ja-fidelity-opus5.jsonl`](./results-ja-fidelity-opus5.jsonl) | JA fidelity **0.40**, safety 10/11 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-hi-fidelity-opus5.jsonl`](./results-hi-fidelity-opus5.jsonl) | HI fidelity **0.42**, safety 10/11 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-zh-fidelity-opus5.jsonl`](./results-zh-fidelity-opus5.jsonl) | ZH fidelity **0.40**, safety 11/11 | `claude-opus-5` | 3 | 2026-08-06 |

The `-opus5` rows are the v0.23.0 register re-measure; their paired token rows are
the `-report-opus5` files in the provenance table above. They supersede nothing —
the `claude-opus-4-8` rows above stay, because they are what the KO/EN/JA/HI/ZH
tables were measured on and a table keeps the model it was measured on
([`benchmarks/README.md`](../README.md#pin-the-model-and-isolate-the-host)).

### Not published

| Source | Why |
| ------ | --- |
| `results-ko-codex-*.jsonl` | Codex runs (pre-opus48), a different harness/tokenizer — **stale**, not cited in any README headline, not re-measured. |
| docgen | Already tracked and scrubbed at [`benchmarks/examples/docgen-results.md`](../examples/docgen-results.md); no raw JSONL layer is duplicated here. |
