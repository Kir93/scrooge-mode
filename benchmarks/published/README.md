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
| [`results-ko-persistence.jsonl`](./results-ko-persistence.jsonl) | KO **register persistence**: 0/7 `## Boundaries` violations in a 20-turn hooked session past a compaction, register live 5/5 on the liveness control | `claude-opus-5` | v0.23.1 | 2026-08-25 | `prompts/ko-outbound.txt` probes + `prompts/ko-docgen.txt` filler | bench `CLAUDE_CONFIG_DIR` + `--setting-sources project` (real hooks, host plugin off) |
| [`results-ko-report-v025.jsonl`](./results-ko-report-v025.jsonl) | KO held-out **+55.3%** ratio-of-medians (per-prompt median 60.4%, 95% CI +51.0–+65.5%, N=18) | `claude-opus-5` | v0.25.0 | 2026-09-16 | `prompts/ko-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-en-report-v025.jsonl`](./results-en-report-v025.jsonl) | EN held-out **+66.2%** ratio-of-medians (per-prompt median 62.1%, 95% CI +48.6–+69.5%, N=19) | `claude-opus-5` | v0.25.0 | 2026-09-16 | `prompts/en-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-ja-report-v025.jsonl`](./results-ja-report-v025.jsonl) | JA held-out **+51.1%** ratio-of-medians (per-prompt median 60.1%, 95% CI +40.8–+67.5%, N=11) | `claude-opus-5` | v0.25.0 | 2026-09-16 | `prompts/ja-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-hi-report-v025.jsonl`](./results-hi-report-v025.jsonl) | HI held-out **+52.6%** ratio-of-medians (per-prompt median 52.6%, 95% CI +47.9–+60.7%, N=11) | `claude-opus-5` | v0.25.0 | 2026-09-16 | `prompts/hi-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |
| [`results-zh-report-v025.jsonl`](./results-zh-report-v025.jsonl) | ZH held-out **+51.3%** ratio-of-medians (per-prompt median 52.6%, 95% CI +37.0–+62.2%, N=11) — least-resolved of the five: lowest CI floor, the only non-unanimous sign test (10/11), and by far the largest MDE (46.5pp vs 8.2–11.9pp) | `claude-opus-5` | v0.25.0 | 2026-09-16 | `prompts/zh-report.txt` | `--cwd` empty + global CLAUDE.md aside + `ultracode` off |

`results-ko-persistence.jsonl` is the one file here that **cannot** be re-scored by
its own scorer: `persistence-score.py` reads `output_text`, and D2 removes it. The
verdict travels in the row instead (`violated`, `violation_count`, `violations` on
probe rows; `liveness_compressed` on the liveness control; `compactions` and
`injections` on every row), so the headline is re-derivable without the prose:

```python
import json
rows = [json.loads(l) for l in open("benchmarks/published/results-ko-persistence.jsonl")]
for arm in ("scrooge:ko/full", "normal"):
    a = [r for r in rows if r["arm"] == arm]
    pr = [r for r in a if r["kind"] == "probe"]
    lv = [r for r in a if r["kind"] == "liveness"]
    print(arm, f"violations={sum(1 for r in pr if r['violated'])}/{len(pr)}",
          f"liveness={sum(1 for r in lv if r['liveness_compressed'])}/{len(lv)}",
          f"compactions={max(r['compactions'] or 0 for r in a)}",
          f"injections={max(r['injections'] or 0 for r in a)}")
```

Read `injections` before the violation count. Two per session (`SessionStart:startup`
plus one per compaction) is the persistence shape; one per turn would mean the rule
was re-asserted every turn and the run measured re-injection instead. This file
records 2 for the register arm against 1 compaction, and 0 for the baseline — which
is also what shows the baseline had no register rather than a quiet one.

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
has now been re-run on the **v0.23.0 register** — the `-opus5` rows below — so the
disclosure is discharged rather than carried forward. (A later drift note follows;
it does not reopen this one.)

**What the re-measure found: the drop is the model, not the register.** Every
language fell on claim-preservation (KO 0.68→0.42, EN 0.72→0.50, JA 0.60→0.40,
HI 0.76→0.42, ZH 0.72→0.40) while output saved rose (+4 to +15pp). That reads like
a register regression until you check English: `rules/en/full.md` is **byte-identical
between v0.21.0 and v0.23.1** (`git show v0.21.0:rules/en/full.md | shasum` matches
`git show v0.23.1:rules/en/full.md | shasum`), yet EN fell 0.22 on the same 11 prompts — inside the −0.20…−0.34 range of
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

**Register drift 2026-08-25 — disclosed, then closed by the 2026-09-16 re-measure.**
(That re-measure ran on a register containing this edit, so it discharges this note
too. The reasoning below is kept as the record of why it shipped disclosed.)
Version: **v0.24.0.**
`rules/{ko,en,ja,hi,zh}/full.md` all changed:
the `## Boundaries` Docs/prose item now names outbound drafts (Slack, DM,
announcements, email) as part of the class it already covered. That is an edit to a
boundary clause, so [`RELEASE.md`](../../RELEASE.md) §1a counts it as substantive
and the CI re-measurement marker fires on it.

The judge was **not** re-run, and this note is the disposition §1a requires instead.
The reason is that the change is a wording alignment to measured behavior rather
than a behavioral change: under register-only isolation the model already wrote
Slack announcements and DM drafts in polite prose — 0 violations in 14 — before the
clause named them. A 355-call subscription judge run over the held-out corpus would
be measuring a class already observed at 0/14.

That 0/14 is **not** published here: it was measured before the harness existed, so
there are no rows to copy. What is committed is the way to re-run it —
`benchmarks/iso-single.py` over `benchmarks/prompts/{ko,en}-outbound.txt`, scored by
`benchmarks/persistence-score.py` (see [Register persistence](../README.md#register-persistence-boundary-survival)).
Treat the figure as the reason the judge was skipped, not as a published number.

**What this means for the numbers above: every `-opus5` fidelity row is a
measurement of the v0.23.0 register, i.e. the register BEFORE this edit.** The EN
control-group argument above is unaffected — it rests on `rules/en/full.md` being
byte-identical from v0.21.0 through v0.23.1, which the tag comparison it cites still
shows — but a future re-measure should compare against the post-edit register, not
treat these rows as current.

**Register drift 2026-09-16 — disposition: judge RE-RUN.** This one is discharged by
measurement, not disclosed. It also discharges the 2026-08-25 disclosure above: the
re-measure below ran on the current register, which contains that edit too.
Version: **v0.25.0.**

**All five** `rules/*/full.md` registers changed, plus one surface outside the CI
marker's `rules/**` scope: `skills/scrooge/SKILL.md`, the abridged register that is the
whole register for skill-only hosts (Cursor, Windsurf, Cline, Continue, Gemini CLI).
`rules/{ko,ja,hi,zh}/full.md` received all three clauses below, ported from EN which
already stated them; `rules/en/full.md` received only the second clause's added
sentence — see the behaviour check, which is why EN moved at all.

Three EN-only clauses were ported. Each reached both surfaces:

- the `hedging:` drop item now carries the replacement obligation EN already
  stated — assert, or label the claim unverified (`미검증` / `未検証` /
  `असत्यापित` / `未验证`). New to `SKILL.md`, whose abridged drop list had no
  hedging row at all;
- the Auto-Clarity trigger list now includes a user who repeats a question.
  `SKILL.md` already stated the other three triggers and was completed here;
- the one-short-clause-per-bullet rule now applies to any list, not only a list of
  causes. New to `SKILL.md`, which stated no bullet-scope rule.

All three add or change the meaning of an instruction, so
[`RELEASE.md`](../../RELEASE.md) §1a counts them as substantive and the CI
re-measurement marker fires on this change.

### The re-measure

`--judge-runs 3` over the held-out report corpus, all five languages, `claude-opus-5`
(the same pin the `-opus5` rows used), same isolation. Rows in `results-*-v025.jsonl`.

| Lang | Savings (ratio-of-medians) | was | Fidelity (median claim-preservation) | was |
| ---- | -------------------------: | --: | -----------------------------------: | --: |
| KO | +55.3% | +77.3% | 0.53 | 0.42 |
| EN | +66.2% | +71.2% | 0.60 | 0.50 |
| JA | +51.1% | +77.4% | 0.60 | 0.40 |
| HI | +52.6% | +79.1% | 0.60 | 0.42 |
| ZH | +51.3% | +72.9% | 0.55 | 0.40 |

**Savings down 5–26pp, fidelity up 0.10–0.20, in every language.** All five prior
per-prompt medians fall outside the new 95% CIs, so the move is not sampling noise.
That is the 2026-08 trade — "higher savings and lower claim-preservation are the same
fact seen twice" — running backwards: the registers compress less and keep more.

**What moved it is NOT established.** Two candidates, and this run cannot separate them:

- *Model drift.* `claude-opus-5` is an alias, and six weeks separate the two runs. EN is
  the closest thing to a control — the only EN change is the repeat-question sentence,
  and the held-out corpus is single-turn, so that clause cannot fire on it. EN still
  fell 9.6pp on the per-prompt median. An effectively unchanged register cannot cause
  its own move.
- *The clauses.* The other four fell further (KO 17.9, JA 13.9, ZH 18.1, HI 28.5pp). The
  hedge clause adds a marker and so plausibly costs savings, but the bullet-scope clause
  should push the other way, and three small clauses do not obviously account for 28pp.

Read the new rows as the current register's numbers, not as an attribution. Note also
that **EN is no longer available as an unmoved control** for a future re-measure — the
tag-window argument above still holds for what it claims (byte-identity v0.21.0 through
v0.23.1, which an edit today cannot reach back into), but the next re-measure compares
every language against a register that has moved.

### Two findings the re-measure surfaced

**ZH had been unmeasurable, silently.** `rules/zh/full.md` names the competing register
to contrast with it ("caveman 走文言方向,scrooge zh 不走"). The transcript records the
injected `--system-prompt` verbatim at `attachment.systemPrompt`, and the per-row
contamination detector matched the bare word there — excluding 11 of 11 `scrooge:zh/full`
rows and leaving zero pairs.

**When this broke is NOT established, and it is not what it looks like.** The detector has
been unchanged since `e6e217b` (2026-06-17), the zh rule's caveman sentence since `c005b42`
(2026-07-01), and the `--system-prompt` injection channel since `be5163a` (2026-05-28) — all
three predate the 2026-08-06 zh run, and
[`results-zh-report-opus5.jsonl`](./results-zh-report-opus5.jsonl) records that run as 22
rows with `contaminated` false on every one. So the detector scanned that transcript and
cleared it: zh **was** measurable on 2026-08-06. The remaining variable is what the CLI
writes into the transcript — the injected prompt is now recorded verbatim at
`attachment.systemPrompt` (measured 2026-09-16) — so the breakage window opens somewhere
after 2026-08-06 and its start is not established from anything in this repo.
`benchmarks/run.py` now subtracts the harness's own injected system prompt before
scanning (the same self-trigger `_NOISE_KEYS` already guarded for cwd/gitBranch), and
only that slice — anything else in the field is still scanned.
`benchmarks/test_contamination_scan.py` pins both directions.

**The repeat-question clause shipped inert and needed a second edit.** A
register-isolated behaviour probe put a verbatim repeated question, with no confusion
marker, to each surface. As first written — a trailing "or repeats a question" inside the
existing trigger list — it did not reliably fire: `SKILL.md` answered in the compressed
register, `rules/ko/full.md` escaped on 3 of 6 runs, and `rules/en/full.md` on **0 of 6**,
recognising the repeat each time and re-compressing anyway (`Already answered:`, `Same as
before:`). All six surfaces therefore carry an added sentence saying a repeat counts even
when the user shows no confusion; after it, 24 of 24. Those rows are **not published
here** — the probe corpus is not the held-out one, a few runs per cell is a smoke check,
and it is one-sided: the `normal` control writes polite prose for a repeated question
anyway, so the probe can show a register failing to escape but cannot credit a successful
escape to the clause. Re-run it with `benchmarks/run.py --arms
"scrooge:en/full,scrooge:ko/full,skillonly=skills/scrooge/SKILL.md,normal"` over a prompt
that repeats an already-answered question verbatim.

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
| [`results-ko-fidelity-opus5.jsonl`](./results-ko-fidelity-opus5.jsonl) | KO fidelity **0.42**, safety 13/19 — v0.23.0 register on the current model pin | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-en-fidelity-opus5.jsonl`](./results-en-fidelity-opus5.jsonl) | EN fidelity **0.50**, safety 15/19 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-ja-fidelity-opus5.jsonl`](./results-ja-fidelity-opus5.jsonl) | JA fidelity **0.40**, safety 10/11 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-hi-fidelity-opus5.jsonl`](./results-hi-fidelity-opus5.jsonl) | HI fidelity **0.42**, safety 10/11 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-zh-fidelity-opus5.jsonl`](./results-zh-fidelity-opus5.jsonl) | ZH fidelity **0.40**, safety 11/11 | `claude-opus-5` | 3 | 2026-08-06 |
| [`results-ko-fidelity-v025.jsonl`](./results-ko-fidelity-v025.jsonl) | KO fidelity **0.53**, safety 12/18 — v0.25.0 register, same model pin as the `-opus5` rows above | `claude-opus-5` | 3 | 2026-09-16 |
| [`results-en-fidelity-v025.jsonl`](./results-en-fidelity-v025.jsonl) | EN fidelity **0.60**, safety 16/19 | `claude-opus-5` | 3 | 2026-09-16 |
| [`results-ja-fidelity-v025.jsonl`](./results-ja-fidelity-v025.jsonl) | JA fidelity **0.60**, safety 9/11 | `claude-opus-5` | 3 | 2026-09-16 |
| [`results-hi-fidelity-v025.jsonl`](./results-hi-fidelity-v025.jsonl) | HI fidelity **0.60**, safety 9/11 | `claude-opus-5` | 3 | 2026-09-16 |
| [`results-zh-fidelity-v025.jsonl`](./results-zh-fidelity-v025.jsonl) | ZH fidelity **0.55**, safety 10/11 — first zh re-measure since the contamination detector landed; see the 2026-09-16 note | `claude-opus-5` | 3 | 2026-09-16 |

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
