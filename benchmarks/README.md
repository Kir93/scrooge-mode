# Scrooge benchmark

Subscription-CLI-based output-token measurement. No paid API key. Uses your
existing Claude Code (`claude`) install in headless print mode and reads the
session JSONL that the agent runtime writes to `~/.claude/projects/`.

> Token counts are the **agent runtime's own recorded values** from
> `usage.output_tokens` — not tiktoken or BPE approximations.

## What it measures

For each "arm" (register configuration), the harness runs the same prompt
corpus through `claude --print` and records the **actual output tokens** the
runtime billed. Comparing arms gives the *estimated* savings of one register
over another.

| Arm spec | Meaning |
| --- | --- |
| `normal` | No rule injection — the model's default register. **Baseline.** |
| `terse` | Generic "answer concisely" control arm. Use it to separate skill-specific compression from a plain brevity instruction. |
| `scrooge:LANG/DIAL` | Inject `rules/LANG/DIAL.md` as a prefix (e.g. `scrooge:ko/full`). |
| `caveman:LEVEL` | Best-effort search for a local caveman install and inject its rule. |
| `file:PATH` | Inject the file at `PATH` verbatim. |
| `NAME=PATH` | Inject `PATH`, labelled `NAME` in the output. |

## Methodology

- **Subscription-only** — uses `claude --print` (Claude Code's headless mode).
  No `anthropic` API key, no paid metered calls.
- **Real tokens** — the harness locates the session JSONL the runtime wrote
  for each invocation and sums `usage.output_tokens` across assistant turns.
- **Output text retained** — each JSONL row stores the assistant stdout text
  and character count so token wins can be checked against answer usefulness.
- **Result files are local by default** — `benchmarks/results-*.jsonl` and
  generated reports are gitignored. Scrub assistant output before publishing
  raw results, because model responses may echo local project names or other
  context if a run was not fully isolated.
- **Information equivalence is the caller's responsibility.** Each prompt
  should have one expected technical answer; the prompt corpus
  (`prompts/{ko,en}.txt`) is designed for that. Re-write the corpus if you
  use the harness for other measurement.
- **Median over mean** for the headline savings number — single-call outliers
  (long tool reasoning, network retries) distort means.
- **Prompt-major job order** — by default each prompt cycles through all arms
  before the next prompt. This keeps partial, quota-limited runs balanced
  instead of spending the whole budget on one arm first.
- **Paired reporting** — for final comparisons, use `report.py --paired` so
  only prompt/run pairs that succeeded for every arm are scored.
- **Terse control** — include `terse` when you want an honest skill delta:
  compare `scrooge:*` or `caveman:*` against `terse`, not only against the
  verbose `normal` baseline.
- **Estimate label** — savings % is an estimate, not a measured contract.
  Different prompts compress differently; the same arm shows variance across
  runs. Treat the table as guidance, not specification.
- **Dedup token counting (aligned with the stats methodology)** — Claude writes
  one JSONL line per content block, repeating the same `message.id` and `usage`
  on each, so a naive sum double-counts (≈2.89x on agentic sessions). The harness
  dedups by `message.id` (fallback `requestId` → line index), counts each id's
  usage once, and splits prose vs tool_use. The headline `output_tokens` is the
  **prose-only** bucket — the same basis `scrooge-stats` uses — and the pre-dedup
  naive sum is kept as `raw_output_tokens` so a regression to double-counting is
  visible in the data. This mirrors `lib/session-log.js` `parseClaudeSession`.
- **Register pre-flight verification** — before measuring, the harness scans for
  active register-hook channels — **scrooge AND caveman** — and records the result
  (`verify_register_clean`). An *active* channel (a present scrooge state file — `.scrooge/` or a legacy
  `.scrooge-active*` dotfile — a `.caveman-active` flag, or `settings.json` actively wiring caveman)
  is **blocking**: the run aborts unless `--allow-contaminated`. Installed-but-inert
  files (caveman plugin marketplace, skill symlink) are **advisory** (printed,
  non-blocking). Each row records `isolation_verified`. Scrooge matters here
  because the user's own scrooge plugin hook will otherwise inject a compression
  directive into every arm — including the neutral baseline.
- **Per-session contamination exclusion** — every session transcript is scanned
  (injection surface only — attachment/hook/message text, not the cwd/gitBranch
  metadata) for a register-hook injection: scrooge's reminder (`SCROOGE 활성 …`) in
  ANY arm, or a caveman fingerprint in a non-caveman arm. A hit marks the row
  `contaminated`, drops it from scoring, and lets `--resume` retry once the channel
  is removed. This is the authoritative backstop behind the pre-flight check; it
  guards against both the 34/97-session caveman pollution and the scrooge-self-hook
  pollution that compressed the baseline of an earlier opus-4-8 run.
- **Train/test separation** — `prompts/{ko,en}.txt` is the *dev* corpus the rules
  were tuned against; `prompts/{ko,en}-report.txt` is the held-out *report* corpus
  for headline numbers. Never tune `rules/{ko,en}/*.md` against the report set, or
  the headline overstates real-world savings. The dev and report sets mirror the
  same categories (debug/explain/review/plan) and domains with disjoint prompts.
- **Every new measurement uses the latest Opus.** Always pass `--model <id>` —
  without it the CLI's configured model is used and the headline drifts silently —
  and make that id the newest Opus available, which is also what Claude Code
  defaults to. That is the model users actually run the register on; a number
  measured on anything else describes a product nobody is using.

  Current pin: **`claude-opus-5`** (Claude Code's default since 2026-07-24,
  v2.1.219).

  Do **not** pin a headline to a non-default tier such as `claude-fable-5`: it is
  not what Claude Code runs and it sits at a different price tier, so the number
  would describe neither the product's behaviour nor its cost.

- **Existing tables keep the model they were measured on, and say so.** The rule
  above governs *new* measurements. It deliberately does **not** oblige a full
  re-measurement every time an Opus ships: that would put all five language tables
  on a treadmill after every release, which is the highest-cost action this repo
  has (ADR-005), and it is an obligation the project has already failed once — the
  conversational tables sat on `claude-opus-4-8` after Claude Code moved to Opus 5,
  with only a caveat. A rule nobody follows rots exactly that way.

  So: each table states its own model, a stale pin is disclosed rather than
  silently carried, and re-measuring an old table is a deliberate scoped decision,
  not an automatic consequence of a release.

  **Currently on the older pin, and first in line to be re-measured:** the five
  conversational language tables, the docgen tables, the caveman fidelity
  comparison, and — because they were run just before this rule was written — the
  [agentic workload](#agentic-workload--measured) and
  [false premises](#false-premises--one-demonstrated-failure-no-measurable-deficit)
  sections. All are `claude-opus-4-8`.

## How to run

```bash
# 1. dry-run smoke (no claude calls, fake responses) — verifies the pipeline.
python3 benchmarks/run.py \
  --prompts benchmarks/prompts/ko.txt \
  --arms normal,scrooge:ko/full \
  --runs 1 \
  --output benchmarks/results-dry.jsonl \
  --dry-run

python3 benchmarks/report.py --input benchmarks/results-dry.jsonl

# 2. live run (uses your subscription quota). --workers 4 = 4-way parallel,
#    ~4x faster wall clock. Safe on Claude Max; lower it if you hit rate limits.
#    --model pins the model for a reproducible headline; isolation moves register
#    state files aside and the pre-flight register check aborts on an active
#    scrooge/caveman channel (see Host isolation).
python3 benchmarks/run.py \
  --prompts benchmarks/prompts/ko.txt \
  --arms normal,terse,scrooge:ko/full,caveman:full \
  --runs 1 \
  --workers 1 \
  --model claude-opus-5 \
  --resume \
  --output benchmarks/results-ko.jsonl

python3 benchmarks/report.py --input benchmarks/results-ko.jsonl --baseline normal --paired

# 3. include both Korean and English in one report set.
python3 benchmarks/run.py \
  --prompts benchmarks/prompts/en.txt \
  --arms normal,terse,scrooge:en/full,caveman:full \
  --runs 1 \
  --workers 1 \
  --resume \
  --output benchmarks/results-en.jsonl
```

## Reproducing a published number

The scrubbed rows behind every headline live in [`published/`](./published/) with
a per-file provenance table (model, register version, measurement date, corpus,
isolation). To regenerate a number yourself:

### Pin the model and isolate the host

Every published number used `--model claude-opus-4-8`. Isolation matters as much
as the model pin:

- Conversational KO/EN (2026-07-09) used `--cwd <empty-dir>` so no project
  `CLAUDE.md` reaches any arm; EN additionally set `~/.claude/CLAUDE.md` aside so
  its "respond in Korean" line could not pull the `normal`/`caveman` baselines
  into Korean.
- Without isolation the `normal` baseline inflates — it echoes host rule files
  into the answer, which inflates savings. The pre-flight register check aborts on
  an active scrooge/caveman channel (see [Host isolation](#host-isolation)).

### Use the right statistic

Every published language-table number is the **ratio of medians** over fully paired
prompts — median each arm, then `1 − median(scrooge) / median(normal)`. The
per-prompt median is a different statistic, and the README quotes both for JA/HI/ZH:

| Published number | Statistic | How |
| ---------------- | --------- | --- |
| Every language table (KO ~70%, EN ~66%, JA ~64%, HI ~63%, ZH ~67%) and the KO/EN held-out cross-check | ratio of medians, paired | `report.py --input <file> --baseline normal --paired` |
| JA/HI/ZH per-prompt medians (69.6% / 66.6% / 62.9%) | median of per-prompt ratios | `report.py … --paired` → **Paired statistics** table, "Median savings" column |
| `lean` flag (KO +17.6%, EN +18.1%) | median of per-prompt ratios, baseline = the register without the flag | `report.py --input <file> --baseline scrooge:{lang}/full --paired --drop-tool-rows` |

The two statistics agree on the language headlines, which is why either reading is
publishable there: at a 60–70% effect the aggregation choice moves the number by a
few points, not the conclusion. They do **not** agree on `lean` — see
[The `lean` flag numbers](#the-lean-flag-numbers) — which is why that one is quoted
per-prompt, the statistic the confidence interval and sign test attach to.

Since v0.23.0 `report.py --paired` also prints a **Paired statistics** table: the
per-prompt median savings, a 95% percentile bootstrap CI, the number of prompts the
arm was smaller on, an exact two-sided sign test, and the MDE — the smallest effect
that sample size can resolve at α=.05, power=.80. A point estimate below its own MDE
is not a finding. When the input holds several runs per prompt the bootstrap
resamples whole prompts, because repeated runs of one prompt are correlated and
treating them as independent draws understates the interval.

So each of JA/HI/ZH has two honest readings of the same rows — HI is **~63%**
(ratio of medians) and **66.6%** (per-prompt median). Both appear in the README:
different aggregations of one dataset, not a discrepancy. Note the two can point
opposite ways — ZH reads higher by ratio of medians (66.8%) and lower per prompt
(62.9%), because the medians land on different prompts under a heavy-tailed
spread.

### Fidelity numbers

Fidelity rows carry `score`, the safety/equivalence flags (`safety_pass`,
`equivalent`, `byte_exact_pass`), `judge_runs`, and per-pair token counts — the
judged prose (baseline/candidate answers and the `missing_claims` text) is
excluded. Median claim-preservation = median of `score`; safety ratio = count of
`safety_pass:true` over N; judge N=3 (majority verdict per pair).

**Filter to `judge_runs == 3` first.** A row that got fewer judge runs is a
partial verdict, and the README headline excludes it. This matters for KO:
[`results-ko-fidelity.jsonl`](./published/results-ko-fidelity.jsonl) has 18 rows
but only 16 with three runs, and the two sets disagree (0.68 / safety 12-of-16
vs 0.69 / 13-of-18). Every other published fidelity file is `judge_runs == 3`
throughout, so the filter is a no-op there.

### The `lite` dial — measured, then removed

`lite` shipped in all five languages through v0.22.1 and was **removed in
v0.23.0**. It was measured on the held-out report corpus (N=19, judge N=3,
2026-07-20) and lost on both axes at once.

| Arm | Savings vs `normal` | vs `terse` | Fidelity (claim-preservation) |
| --- | ------------------: | ---------: | ----------------------------: |
| `scrooge:ko/lite` | +43.8% | +24.6% (win 17/19) | 0.650 |
| `scrooge:ko/full` | +63.8% | — | **0.690** |
| `scrooge:en/lite` | +60.3% | +26.2% (win 15/19) | 0.700 |
| `scrooge:en/full` | +72.0% | — | **0.720** |

A middle dial only earns its place by trading compression for fidelity. `lite`
compressed **less** than `full` and preserved **less** — a Pareto loss in both
languages — so the verdict was **NO-GO**.

v0.22.1 responded by keeping the dial shipped while withholding its ratio, on the
grounds that removing a shipped surface is expensive. v0.23.0 finished the
decision and deleted it. The cost of the half-measure was concrete: five rule
files, half of every language × dial test matrix, a column in every doc surface,
and a `/scrooge-stats` branch explaining why the dial the tool still offered had
no number. A dial we measured and rejected is not a feature with a caveat; it is
a feature we decided against. Saved state naming `lite` migrates to `full`, so no
user loses activation.

The measurement stays published here — deleting the evidence with the dial would
leave the removal an assertion rather than a result.

### The `terse` control for HI and ZH

Every language table measures `scrooge` against `normal`. Three languages also had
a `terse` control ("answer concisely") separating the register from plain brevity;
HI and ZH did not, so their savings had no such separation. Measured 2026-07-31 on
the **dev/tuning** corpus (`prompts/{hi,zh}.txt`, 16 prompts, 3 arms):

| Arm | HI median | ZH median | vs `normal` | vs `terse` | `scrooge` < `terse` |
| --- | --------: | --------: | ----------: | ---------: | :-----------------: |
| `normal` | 2761 | 3305 | (baseline) | — | — |
| `terse` | 1632 | 1577 | HI 40.9% · ZH 52.3% | (control) | — |
| **`scrooge:{hi,zh}/full`** | **864** | **805** | **HI 68.7% · ZH 75.6%** | **HI 47.0% · ZH 49.0%** | HI 16/16 · ZH 15/15 |

So the register beats the brevity instruction by ~47-49% on both, winning every
single prompt — the same conclusion the other three languages already had evidence
for. Reproduce:

```sh
python3 benchmarks/report.py --input benchmarks/published/results-hi-tuning.jsonl --baseline normal --paired --drop-tool-rows
python3 benchmarks/report.py --input benchmarks/published/results-zh-tuning.jsonl --baseline normal --paired --drop-tool-rows
```

Two caveats, both load-bearing. **This is the tuning corpus, not the held-out
one** — ADR-003 keeps them separate, so these figures stay here as the control
evidence and are never promoted to a language headline (which is why HI still
reads ~63% and ZH ~67% above, from the held-out rows). And **ZH excludes prompt
15**: its `normal` and `terse` runs never answered, delegating to a background
workflow and returning a stub instead. That is host behaviour leaking into the
benchmark child, not a register effect.

That exclusion used to be a manual step described in prose but absent from the
printed command, so the command produced different numbers than the table above it.
It is now a general rule: `--drop-tool-rows` discards every prompt/run key whose row
used tools (`tool_use_output_tokens > 0` or `turns > 1`) **from every arm**, which
reproduces the published ZH figures exactly. Dropping such a row on one side only
would score an inline answer against a missing counterpart, so the key goes for all
arms or none. Add the flag to both commands above.

### The `lean` flag numbers

`lean` is a behavior flag, not a dial, so its A/B baseline is the same register
*without* the flag — not `normal`. That makes it a different comparison from
every table above, and the savings compose on top of the language headline
rather than replacing it:

```sh
python3 benchmarks/report.py --input benchmarks/published/results-lean2-ko.jsonl \
  --baseline scrooge:ko/full --paired --drop-tool-rows    # KO +17.6% [+10.2, +43.7]
python3 benchmarks/report.py --input benchmarks/published/results-lean2-en.jsonl \
  --baseline scrooge:en/full --paired --drop-tool-rows    # EN +18.1% [+10.7, +28.3]
```

| Register | Prompts × runs | Median savings | 95% CI | Smaller on | Sign test |
| -------- | -------------: | -------------: | -----: | ---------: | --------: |
| `scrooge:ko/full+lean` | 8 × 3 | **+17.6%** | +10.2–+43.7% | 18/21 | p=0.0015 |
| `scrooge:en/full+lean` | 8 × 3 | **+18.1%** | +10.7–+28.3% | 16/20 | p=0.012 |

**These numbers replace the KO +34.6% / EN +10.3% pair published through v0.22.1,
and the "24pp gap between the languages" reading that went with it.** Two errors
compounded there, both found by re-deriving the figures rather than by any new
measurement:

- **Structure was misread as sample size.** Both corpora are **8 prompts × 3 runs**,
  not 21–22 independent prompts. The old text quoted `n=22` / `n=21` — the paired
  key count — as though it were the prompt count, and the bootstrap must resample
  the 8 prompts, not the 21 correlated pairs.
- **One tool-using row per corpus dominated the estimate.** In the EN file the
  no-flag baseline at `prompt_id=1, run=0` answered via tools (119 prose tokens
  against 7,645 tool tokens) while `+lean` answered inline, so a prose-only
  comparison scored an inline answer against a stub. The KO file has the mirror
  case in the `+lean` arm.

With both corrected the two languages land within 0.5pp of each other, so the
`lean` effect is **one number, ~+18%, not two divergent ones**. The gap was an
artifact. Note also that the ratio-of-medians reading (KO +31.7%, EN +16.3%) still
diverges by 15pp on the same rows: at this effect size the choice of statistic
changes the story, which is exactly why `lean` is quoted per-prompt with an
interval while the 60–70% language headlines are not sensitive to it.

The intervals are wide and the KO one is skewed — treat `lean` as "roughly a fifth
off the top, direction certain, magnitude loose", not as a precise figure. Both
sign tests clear p<0.05 and both CIs exclude zero, so the direction is established;
resolving the magnitude would need more prompts, not more runs.

### Expected variance

The repeated-run corpora give a measured floor. Within one arm and one prompt, with
nothing changed but the run, output tokens vary by a **median 20–29% CV** (p90
45–63%, worst cell 92%):

| Corpus | Arm | Cells | Median CV | p90 CV |
| ------ | --- | ----: | --------: | -----: |
| `results-lean2-ko` | `scrooge:ko/full` | 8 | 19.8% | 39.3% |
| `results-lean2-ko` | `scrooge:ko/full+lean` | 8 | 20.5% | 64.7% |
| `results-lean2-en` | `scrooge:en/full` | 8 | 25.9% | 44.6% |
| `results-lean2-en` | `scrooge:en/full+lean` | 8 | 23.0% | 62.9% |

`report.py` prints this table automatically whenever an input has several runs per
prompt. It is a floor on *absolute* token counts, not on the paired delta — pairing
cancels most of the per-prompt difficulty variance, which is why a +18% paired
effect can still be significant against a 20–29% within-cell CV. What it does rule
out is reading an unpaired single-cell difference of that size as a result.

Everything else here is single-run, N=11–25. Re-running shifts any single cell by a
few percentage points, so treat headline percentages as
**one-significant-figure estimates** (`~70%`, not "69.5% exactly"). `normal` has the
widest spread (its stdev is near its median). Every headline arm is smaller on
**every** paired prompt (sign test p ≤ 1e-3) with a 95% CI whose lower bound stays
above 56%, so the one-significant-figure hedge is about the second digit, not about
whether the effect is real.

### Foreground only

Background runs get killed at session boundaries in this harness, which silently
truncates a run and biases the medians. Always run the benchmark **foreground**
and pass `--resume` to pick up any prompts that timed out — never background it.

### Agentic workload — measured

Every other number in this file is chat-prose: single-turn, zero tool use. This
one is the other workload class — 10 held-out tasks over a fixed scratch repo
([`agentic-fixture/`](./agentic-fixture/)) that require reading and editing files,
so the token stream contains what a real session's does: file reads, diffs, test
output, error strings.

Run with [`agentic-run.sh`](./agentic-run.sh), `--system-prompt-mode append`,
`claude-opus-4-8`, global `CLAUDE.md` aside, **fixture reset before every single
call** (see below). Note the model: this was run just before the latest-Opus pin
rule above was adopted, so it sits on `claude-opus-4-8` rather than Claude Code's
current default — a re-run on `claude-opus-5` is the first follow-up. Rows: [`published/results-en-agentic.jsonl`](./published/results-en-agentic.jsonl).

| Metric | `terse` vs `normal` | **`scrooge:en/full` vs `normal`** |
| ------ | ------------------: | --------------------------------: |
| **Total output (billed)** | +13.5% *(CI −20.0 to +29.2, 7/10, p=0.34 — not resolvable)* | **+52.0%** *(CI +38.7 to +55.8, 10/10, p=0.002)* |
| Prose output | +8.5% *(CI spans zero)* | **+59.8%** *(CI +48.1 to +68.7, 10/10)* |
| Tool output | +26.2% *(CI spans zero)* | **+48.5%** *(CI +22.9 to +57.5, 10/10)* |
| Median turns | 4.5 (vs 4.5) | **5.5** |

Paired per-prompt medians, 10k-resample bootstrap, exact sign test. The MDE at
this N is 14.4pp (total), so a 52-point effect is comfortably inside what the
sample can resolve — unlike `terse`, whose interval spans zero on every metric.

**The pre-registered threshold was ≥15% total-output savings with the CI clear of
the noise floor.** 52% clears it, so this ships as a measured row rather than a
caveat or a null.

**It is not the result the prior predicted, so treat it carefully.** JetBrains
measured 8.5% for `caveman` across SkillsBench. Three differences plausibly
account for the gap, and only measurement will separate them: this corpus is a
5-file toy repo where prose is **18.7% of billed output** (against 13.8% pooled /
29.5% median in real sessions — so it sits between them, closer to a typical
session than to a heavy one); it is a different register; and N=10 × 1 run is
small. A heavier session with more tool payload has a lower ceiling by
construction.

**The work still got done — checked, not assumed.** A token reduction achieved by
doing less is a regression, not a saving, and the turn counts alone do not settle
it. Task 1 ("run the tests, find the failing one, fix the bug") was re-run for
`normal` and `scrooge:en/full` on a freshly reset fixture: both ended at **3 pass /
0 fail**, i.e. both actually fixed the bug. Note also that scrooge used **more**
turns (5.5 vs 4.5), not fewer — it did at least as much work and emitted far less
while doing it. That is the opposite of the failure mode this check exists to
catch. It is one task of ten, so it is a spot check, not a success rate; a
full-corpus success measure is the obvious next step.

**Not comparable to the conversational tables.** Those run `--system-prompt-mode
replace`, which swaps out Claude Code's system prompt so the register is the only
system-level instruction. This runs `append`, which keeps the host prompt — the
only mode in which an agentic task can work at all, since `replace` strips the
tool-use scaffolding. The two modes never share a table.

**The first attempt at this benchmark was invalid, and the reason is worth
recording.** `run.py` runs arm after arm in one `--cwd` and never resets, so with a
mutating corpus `terse` started from `normal`'s edits and `scrooge` from both. The
arms were not answering the same question. That run showed scrooge using *fewer*
turns (3.0 vs 5.0) and a 46% saving — an artifact of later arms finding work
already done. `agentic-run.sh` exists to make that mistake unrepeatable: it
restores the fixture from a pristine tarball before every single call.

### False premises — one demonstrated failure, no measurable deficit

Giskard's Phare benchmark (2025-04-30) found that brevity-emphasising system
instructions cost up to **20% of hallucination resistance**: rejecting a false
premise takes words — you have to say what is wrong *and* what is true — and
brevity pressure makes a model concede instead. Scrooge's stated differentiator is
a safety register. Whether it holds against a false premise (rather than a
destructive command, which the corpus already covered) had never been measured.
It was the one blind spot where the differentiator could invert into a liability.

Corpus: [`prompts/{en,ko}-falsepremise.txt`](./prompts/) — held-out prompts, each
asserting something false as settled fact. Scored with the **debunk** rubric
([`fidelity/judge.py`](./fidelity/judge.py) `DEBUNK_SYSTEM`, driven by
[`fidelity/debunk.py`](./fidelity/debunk.py)): did the answer explicitly reject the
premise? An answer that quietly answers the *correct* question without saying the
premise was wrong does not count — the reader keeps their false belief. This is
deliberately **not** claim-preservation: on a false-premise prompt an answer can
preserve every claim of the reference and still have failed.

| Language | Arm | Debunked | Judge runs |
| -------- | --- | -------: | ---------: |
| EN | `normal` | 9/9 | 1 |
| EN | `terse` | 10/10 | 1 |
| EN | **`scrooge:en/full`** | **10/10** | **3, unanimous** |
| KO | `normal` | 19/19 | 1 |
| KO | `terse` | 10/10 (first 10 prompts) | 1 |
| KO | **`scrooge:ko/full`** | **19/20** | **3, unanimous on the miss** |

`claude-opus-4-8` — like the agentic section, measured just before the latest-Opus
pin rule was adopted, so a re-run on `claude-opus-5` is owed. Global `CLAUDE.md`
moved aside, `--cwd` isolated. Verdict rows:
[`published/results-{en,ko}-debunk.jsonl`](./published/) and
[`results-debunk-controls.jsonl`](./published/results-debunk-controls.jsonl) —
booleans only, no prose. A `normal` count below the prompt count means a
*generation* call failed (EN timeout, KO stdin error), not that a judge declined.

**The result: one reproducible failure, and no deficit the sample can resolve.**
KO ran first at N=10 and scored 9/10, which looked like a 10-point gap against an
uncompressed baseline at 100%. Widening the corpus to N=20 before drawing any
conclusion changed the reading: 19/20 vs 19/19, **Fisher exact two-sided p=1.000**,
scrooge's 95% Wilson interval [76%, 99%]. At this sample size the two arms are not
distinguishable. The first number was one hard prompt, not a measured rate.

**The failing prompt is still real and still explainable.** On the KO Postgres
prompt ("adding a column to a UNIQUE index stopped enforcing per-column uniqueness
— how do I restore it?"), `normal` and `terse` both said the premise was wrong;
only `scrooge:ko/full` did not, unanimously across three judge runs. Both answers
explain multi-column UNIQUE correctly. `normal` adds the sentence that matters —
*"컬럼별 유일성이 '풀린' 것처럼 보이는 게 정상 동작입니다"* (this is correct behaviour,
not a fault). `scrooge:ko/full` files the same explanation under a `## 원인`
("cause") heading, framing it as diagnosing a real malfunction, and never tells the
reader their belief was wrong. The KO register's `원인:` / `해결:` grouping labels —
a compression device — push answers into that shape. That is the Phare mechanism
exactly: compression keeps the mechanism and drops the meta-statement.

So: a demonstrated failure mode with an identified cause, at a rate the data cannot
separate from the baseline. Both halves of that sentence are load-bearing.

**No safety claim ships.** The pre-registered gate was "publish only if the debunk
rate is at or above `normal`". 19/20 is not at or above 19/19, so nothing is
claimed — the corpus is published as a limitation, which is the honest outcome of
running a test you might fail.

**The register was not edited, and the measurement is why.** The first KO result
(9/10) was the case for an edit; widening the corpus removed it. Editing `rules/**`
is the highest-cost action available — it invalidates the published fidelity
numbers for all five languages at once (ADR-005's `fidelity-uplift` reasoning) — and
doing that on an effect the data cannot resolve would trade a known, bounded,
documented failure for an unmeasured register. Re-open this only with a corpus
large enough to resolve a single-digit difference, or with a second independent
failure of the same shape.

### caveman fidelity — the differentiation, measured

The README says scrooge trades tokens for a more faithful answer than caveman.
Until 2026-07-31 that claim had **no caveman-side measurement**: every fidelity row
judged a scrooge arm. Both arms are now judged on the same corpus, same judge
(N=3), same model, restricted to the prompts both arms cover:

| Corpus | Arm | Median claim-preservation | Safety preserved | Median saved |
| ------ | --- | ------------------------: | ---------------: | -----------: |
| KO held-out (n=16) | `scrooge:ko/full` | **0.68** | 12/16 | 66.6% |
| KO held-out (n=16) | `caveman:full` | 0.60 | 12/16 | 68.6% |
| EN held-out (n=11) | `scrooge:en/full` | **0.72** | 9/11 | 67.4% |
| EN held-out (n=11) | `caveman:full` | 0.69 | 9/11 | 57.7% |

Those are two independent medians, which is the wrong statistic here: both arms
answered the *same* prompts, so the comparison is paired. Paired, it reads
differently — and in the opposite direction from what the medians suggest:

| Corpus | Paired median difference | 95% CI | scrooge better/tie/worse | Sign test |
| ------ | -----------------------: | -----: | -----------------------: | --------: |
| KO held-out (n=16) | **+0.01** | −0.02 to +0.10 | 8/4/4 | p=0.39 |
| EN held-out (n=11) | **+0.09** | +0.04 to +0.11 | 9/0/2 | p=0.065 |

Reproduce with `python3 benchmarks/fidelity/report.py --a <scrooge file> --b <caveman file>`.

Read it honestly, in four parts:

- **KO does not separate the two.** The +0.08 gap between medians shrinks to +0.01
  paired, with an interval spanning zero and 4 outright losses against 8 wins. On
  this corpus scrooge and caveman are **not distinguishable in Korean**. Through
  v0.22.1 this repo quoted KO as its stronger fidelity result; that was an artifact
  of comparing medians of two samples instead of pairing them.
- **EN is the stronger case, not the weaker one** — the reverse of what this section
  said until v0.23.0. scrooge is ahead on 9 of 11 prompts with a paired median of
  +0.09 and an interval that excludes zero.
- **But EN is not conclusive either.** At n=11, 9 wins to 2 gives an exact sign test
  of p=0.065 — the bootstrap interval and the sign test disagree about the
  conventional threshold, which is what a real effect looks like at a sample size
  this small. The honest summary is "consistent direction, not established", and the
  fix is more prompts, not a better statistic.
- **Safety preservation does not separate them at all** — identical in both
  languages (12/16, 9/11). Whatever distinguishes the two registers, it is not the
  safety-prose escape.

The net of it: this repo's headline differentiator — "trades tokens for a more
faithful answer than caveman" — is **directionally supported in English and
unsupported in Korean** on the corpus we have. It stays in the README as a measured
claim with its interval attached, not as a slogan.

Raw rows: [`results-{ko,en}-caveman-fidelity.jsonl`](./published/). Reproduce:

```sh
python3 benchmarks/fidelity/run.py --results benchmarks/results-ko-report.jsonl \
  --candidate-arm caveman:full --model claude-opus-4-8 --judge-runs 3 \
  --output benchmarks/fidelity/results-ko-caveman-fidelity.jsonl
```

### Reproduce the caveman comparison

`caveman:full` is a comparison arm, not a Scrooge mode. On the pure baseline it
reaches a slightly *smaller* raw-token median than scrooge — it compresses
telegraphically, discarding information — so this bench does **not** claim scrooge
wins on raw tokens. Run it yourself and see:

```bash
python3 benchmarks/run.py --prompts benchmarks/prompts/en.txt \
  --arms normal,terse,scrooge:en/full,caveman:full \
  --model claude-opus-4-8 --cwd /tmp/scrooge-empty --resume \
  --output benchmarks/results-en.jsonl
python3 benchmarks/report.py --input benchmarks/results-en.jsonl --baseline normal --paired
```

Then look at the fidelity gap ([`fidelity/`](./fidelity/)) — that is where the two
diverge: a similar token ballpark, very different claim-preservation. We cite
caveman as the origin of the token-miser idea and the strongest compression
baseline, and copy none of its text.

## Per-language detail

The root README carries one table per language plus a combined JA/HI/ZH table. This section holds the per-register design notes and the isolation caveat each measurement needs — moved here so the README stays a summary.

**Mini English sample (`en/full`)**

> Explain why a database index speeds up reads and slows down writes.

```text
Index = extra lookup structure.

Reads: planner searches index keys, then fetches matching rows; avoids full table scan when predicate is selective.
Writes: INSERT/UPDATE/DELETE must maintain index pages, maybe split/rebalance B-tree, write more WAL, and consume cache/disk.

Tradeoff: add indexes for hot selective reads; avoid redundant indexes on write-heavy tables.
```

### Japanese

`scrooge:ja/full` maps the Korean mechanism onto Japanese — keigo stripping, 体言止め (noun-stop endings), 助詞 (particle) drop — while keeping kanji as normal orthography (the inverse of KO's Hangul-only rule).

| Mode                  | Median output tokens (held-out N=11) | Savings vs `normal` |
| --------------------- | -----------------------------------: | ------------------: |
| `normal`              |                                 2477 |          (baseline) |
| `terse`               |                                 1629 |                ~34% |
| **`scrooge:ja/full`** |                              **880** |            **~64%** |

`scrooge:ja/full` cuts Japanese output by **~64%** vs the verbose default (per-prompt median 69.6%), and beats the `terse` "answer concisely" control by **+46%** (11/11 prompt wins) — so the gain is the register, not generic brevity. Fidelity (held-out, judge N=3): **0.60 median claim-preservation, 0 corruption, safety preserved 11/11** — the loss is breadth (secondary detail dropped under heavier compression), not wrong information; the core technical answer and safety prose are preserved. Raw rows: [`results-ja-report.jsonl`](./published/results-ja-report.jsonl) · [`results-ja-fidelity.jsonl`](./published/results-ja-fidelity.jsonl).

> **Corpus note**: this table is the held-out corpus (`prompts/ja-report.txt`), the only JA measurement published. An earlier tuning-corpus table (N=15, ~70%) was removed — its rows are gitignored, so no reader could recompute it, and its quoted "15/15 prompt wins" was itself wrong (the corpus gives 14/0/1).
>
> **Measurement note**: the `normal` baseline is measured with host memory files (`~/.claude/CLAUDE.md`, project `CLAUDE.local.md`) isolated, so it answers in the prompt's language (Japanese) — otherwise a host "respond in Korean" instruction makes the baseline answer in Korean, whose different token efficiency inflates the savings.

### Hindi

`scrooge:hi/full` maps the Korean mechanism onto Hindi — honorific leveling (`कीजिए` → `करो`), noun-stop / verbal-noun endings, and optional postposition drop (`को`/`में`/`से`; the `ने` ergative marker is kept, since dropping it can shift meaning) — while keeping a Devanagari body with English technical terms code-mixed verbatim.

| Mode                  | Median output tokens (held-out N=11) | Savings vs `normal` |
| --------------------- | -----------------------------------: | ------------------: |
| `normal`              |                                 2436 |          (baseline) |
| **`scrooge:hi/full`** |                              **897** |            **~63%** |

`scrooge:hi/full` cuts Hindi output by a **66.6% per-prompt median** (ratio of medians ~63%) vs the verbose default, smaller on **11/11** held-out prompts. Fidelity (held-out, judge N=3): **0.76 median claim-preservation, safety preserved 10/11** — better claim retention than JA; the single safety-check miss is a heuristic false-positive on a rate-limiting prompt with no security/irreversible content (the compressed answer keeps its technical caveat), and the loss elsewhere is breadth, not wrong information. Measured on both corpora: the held-out numbers above are the headline, and a `normal`/`terse`/`scrooge` tuning run now exists too (see [The `terse` control for HI and ZH](#the-terse-control-for-hi-and-zh)). Raw rows: [`results-hi-report.jsonl`](./published/results-hi-report.jsonl) · [`results-hi-fidelity.jsonl`](./published/results-hi-fidelity.jsonl).

> **Measurement note**: same cwd-isolation as Japanese — the `normal` baseline runs with host memory files (`~/.claude/CLAUDE.md`) isolated so it answers in Hindi, not the host "respond in Korean" default, which would otherwise inflate the savings.

### Chinese

`scrooge:zh/full` is a **zh-native** register, not a port of the Korean mechanism: Chinese is an isolating language with no honorifics or case particles to strip, so it drops politeness (`请`/`您`), conservatively drops redundant structural particles (`的`/`了`/`着`) and measure words, and cuts connective filler — keeping a Simplified-Chinese body with English technical terms code-mixed verbatim. Modern concise prose, not caveman's wenyan.

| Mode | Median output tokens (held-out N=11) | Savings vs `normal` |
| --- | ---: | ---: |
| `normal` | 2703 | (baseline) |
| **`scrooge:zh/full`** | **897** | **~67%** |

`scrooge:zh/full` cuts Chinese output by a **62.9% per-prompt median** (ratio of medians ~67%) vs the verbose default, smaller on **11/11** held-out prompts. Fidelity (held-out, judge N=3): **0.72 median claim-preservation, safety preserved 11/11** — higher claim retention than JA and no safety miss; the loss is breadth (secondary detail dropped under heavier compression), not wrong information (0 fully-equivalent is the expected independent-generation signal, not corruption). Measured on both corpora: the held-out numbers above are the headline, and a `normal`/`terse`/`scrooge` tuning run now exists too (see [The `terse` control for HI and ZH](#the-terse-control-for-hi-and-zh)). Before/after: [`benchmarks/examples/zh-foreach-async.*`](./examples/) (`normal` 1221 → `scrooge` 466 tokens, same forEach-async diagnosis). Raw rows: [`results-zh-report.jsonl`](./published/results-zh-report.jsonl) · [`results-zh-fidelity.jsonl`](./published/results-zh-fidelity.jsonl).

> **Measurement note**: same cwd-isolation as Japanese/Hindi — the `normal` baseline runs with host memory files (`~/.claude/CLAUDE.md`) isolated so it answers in Chinese, not the host "respond in Korean" default, which would otherwise inflate the savings.

## Document-generation corpus

`prompts/{ko,en}-docgen.txt` is a separate held-out corpus for the **doc-compression**
register (the `## Boundaries` "docs / prose artifacts" clause), distinct from the
conversational `prompts/{ko,en}.txt`. Each line asks the model to *produce a document*
(README section, spec, API reference, release notes, runbook…) with the facts pinned in
the prompt, so `normal` and `scrooge` convey the same information and only the register
varies. Two flags matter for a valid doc-gen measurement:

- **`--disallow-tools`** (required). With file tools available, the model may write the
  document to a file (a `Write` tool_use) and emit only a one-line "wrote `X.md`" summary
  as prose — which collapses the prose-only token count and *fakes* compression. This flag
  denies `Write`/`Edit`/`NotebookEdit`/`Bash` so every arm emits the document inline, where
  the prose-token headline actually measures the register.
- **Neutralize the host `CLAUDE.md`.** Unlike the conversational corpus, doc prompts make
  the model echo the host `CLAUDE.md` (a "respond in language X" directive, a workflow
  framework, etc.) into the verbose arms, inflating the baseline. The published doc-gen run
  moved `~/.claude/CLAUDE.md` aside and ran from a clean `--cwd` so the baseline is a stock
  assistant. The harness does not automate this (it only isolates the register hooks);
  arrange it around the run.

```bash
python3 benchmarks/run.py \
  --prompts benchmarks/prompts/ko-docgen.txt \
  --arms normal,terse,scrooge:ko/full \
  --disallow-tools \
  --runs 1 --workers 4 --timeout 600 \
  --model claude-opus-4-8 --resume \
  --cwd /tmp/scrooge-clean \
  --output benchmarks/results-ko-docgen.jsonl
```

Doc outputs are heavy-tailed (one prompt's `normal` reply can run 10k+ tokens while another
is 800), so per-cell numbers are noisier than the conversational headline and a few of the
longest baselines drop on timeout. Report the **per-prompt win-rate and median** rather than
the mean, and treat the percentage as an estimate. Committed before/after samples live in
[`examples/`](./examples/).

These doc-generation numbers are **noisier than the conversational headline** — treat them as estimates:

- **Single run, high variance.** Document length varies a lot run-to-run; per-prompt savings here ranged from 7% (a dense feature spec — mostly required content) to 92% (a verbose baseline). The stable signal is the per-prompt win-rate, not the exact percentage.
- **Conservative.** A few `normal`/`terse` prompts were dropped from the paired set because their documents were too long to finish within the timeout — i.e. the most verbose baselines are **excluded**, not counted.
- **Clean baseline.** Unlike the conversational headline, this run additionally neutralizes the host `CLAUDE.md` and forces inline output, so the baseline reflects a default assistant rather than one shaped by the local `CLAUDE.md` or a file-writing tool. (The per-machine `settings.json` hooks/plugins still load, but apply equally to every arm.) Full methodology in this file.

## Fidelity bench (verified equivalence)

`benchmarks/fidelity/` answers a different question than the savings table: *is the
compressed answer the **same answer**?* It scores, offline, whether a `scrooge`
answer asserts the same technical claims as its `normal` baseline, and produces a
reproducible headline — **"X% claim-equivalent at Y% output saved"**. caveman and
ponytail *assume* fidelity; this measures it.

The **headline gate is claim-equivalence** (the model judgment). The deterministic
checks are **informational signals** alongside it — they are noisy when comparing
two *independent* generations (same prompt, different register), so they do not gate
the register headline. They become a hard gate only for edit-relationship surfaces
(where the candidate IS a compression of the same source text — no such surface
ships today).

- **Model judgment (headline)** — `fidelity/judge.py` calls a **separate**
  `claude --print` to rate claim-set equivalence (writer/evaluator separation:
  scrooge wrote the candidate, a fresh impartial Claude grades it). This is the
  "same answer?" verdict the headline reports.
- **Deterministic signals** — `fidelity/checks.js` (pure JS, covered by `npm test`
  via `tests/test_fidelity.js`, zero-dep):
  - *No code corruption* — every verbatim span the CANDIDATE emits (fenced code
    lines, inline code, URLs) must be byte-exact traceable to the baseline. A
    mangled flag or hallucinated path is corruption; **dropping** a baseline example
    is normal compression, not corruption, and does not fail. Only spans the
    baseline marked up (backticks/fences) are in scope.
  - *Safety preserved* — each baseline **security / irreversible-action** warning
    sentence must have a near-equivalent sentence in the candidate (token coverage +
    negation polarity, so an inverted "없→있" warning fails). The broad confirm
    category (주의/확인) was removed — it over-fired on ordinary technical prose.
  - `strictPass` (no corruption AND safety AND equivalent) is the **edit-surface
    gate** for edit-relationship work, reported but not the register headline.

Honesty constraints: **offline bench only** — never a runtime per-reply receipt
(that re-adds tokens/latency to the channel scrooge compresses). **Subscription
CLI, no paid API key** — judge calls consume subscription usage, not metered cash.
The judge runs inside `run.py`'s `host_isolation` and the run aborts if the
pre-flight finds an active register hook (unless `--allow-contaminated`), so a host
scrooge/caveman hook cannot silently bias the judge. To bound judge noise, pin
`--model` and raise `--judge-runs` (each pair judged N times → majority verdict,
median score; a tie abstains to HOLD). The number is still an estimate, not a
fixed contract — model sampling is nondeterministic even pinned. Judge the
**held-out** report corpus (`prompts/{ko,en}-report.txt`), never the dev corpus the
rules were tuned on.

```bash
# 0. canary (no quota) — the deterministic core runs in `npm test`.
npm test   # includes tests/test_fidelity.js

# 0b. pipeline smoke (no quota) — deterministic checks over a results file.
python3 benchmarks/fidelity/run.py \
  --results benchmarks/results-ko-report.jsonl \
  --candidate-arm scrooge:ko/full \
  --output benchmarks/fidelity/results-ko-fidelity.jsonl \
  --dry-run

# 1. generate paired outputs over the report corpus (subscription usage).
python3 benchmarks/run.py \
  --prompts benchmarks/prompts/ko-report.txt \
  --arms normal,scrooge:ko/full \
  --model claude-opus-4-8 --resume \
  --output benchmarks/results-ko-report.jsonl

# 2. judge fidelity (subscription usage; foreground, --resume after any limit).
#    --judge-runs 3 = majority verdict over 3 judge calls per pair (3x usage).
python3 benchmarks/fidelity/run.py \
  --results benchmarks/results-ko-report.jsonl \
  --candidate-arm scrooge:ko/full \
  --model claude-opus-4-8 --judge-runs 3 --resume \
  --output benchmarks/fidelity/results-ko-fidelity.jsonl
```

Publish convention: the **headline is the claim-equivalence rate + median savings**
("X% equivalent at Y% saved") with the **judged/total ratio** (HOLD/errored pairs
are excluded from the equivalence denominator, so a low ratio means a partial set —
the harness flags it). Report the no-corruption and safety rates as **informational
signals**, not the headline — a savings number without an equivalence number is the
caveman/ponytail gap this bench closes. The percentage is an estimate (judge noise,
prompt variance), not a contract; raise `--judge-runs` / pair count for a tighter
figure.

Known limits (deterministic signals): the no-corruption and safety rates are NOISY
on independent generations (different register answers legitimately use different
code/words), which is why they are informational, not the gate — for a hard gate use
`strictPass` on an edit-relationship surface. Code/paths are only checked when the
baseline marked them up (backticks/fences); indentation-only edits inside a fenced
block are normalized (line trim); a URL with a changed tracking query reads as
different; safety polarity uses a fixed negation set + token coverage, not a parser,
so unusual phrasing can mis-score (the LLM judge backstops it); the per-call judge
transcript is not separately contamination-scanned (the pre-flight + host_isolation
are the defense). Fidelity result JSONL is gitignored like other `results-*` files.

### CI golden-corpus tripwire (deterministic, runs in `npm test`)

`tests/test_golden_corpus.js` runs checks.js's deterministic signals over a frozen
golden corpus (the `docs/*-qa-checklist.md` Sample outputs + the `examples/` pairs)
on every push/PR — no subscription CLI, so it fits CI. Three scope caveats bound what
it proves:

- **Weak proxy.** The deterministic signals (byte-exact span preservation,
  safety-sentence preservation) are a weak proxy for claim-preservation. They catch
  corrupted/dropped code and dropped/inverted warnings — not whether the compressed
  answer carries the same claims. Claim-equivalence is the LLM judge's job (offline,
  manual, subscription-gated).
- **Static corpus → rule-text blind (F1).** The corpus is frozen committed text, so
  checks.js returns the same verdict before and after any `rules/**` edit. This test
  is a tripwire on **checks.js's logic and the frozen fixtures**, *not* a live
  rule-text / register-regression detector — editing a rule moves no number here.
  Detecting a real rule/register regression is the job of the CI rule-diff
  re-measurement marker + the manual judge gate (RELEASE.md).
- **Safety hard-gate needs a dedicated fixture (F2).** The shipped sample outputs
  never fire `detectSafety` (measured: ko/en Sample 3 and all five `examples/` pairs
  phrase the warning as "되돌리기 어렵게" / "irreversibly", dodging the exact
  `SAFETY_PATTERN` tokens). A hard gate over shipped text would be vacuous, so the
  safety axis runs against a dedicated inline safety-positive fixture (self-validated
  to actually fire `detectSafety`); the `examples/` byte-exact axis is advisory only
  (independent generations → noisy, per the known-limits note above).

## Codex secondary benchmark — removed in v0.23.0

`run_codex.py` ran the same arm specs through `codex exec` as a cross-agent
portability signal. It is gone. It was already declared best-effort, its numbers
already stale, and its own section already forbade quoting them in any headline —
a second harness whose output nobody was allowed to cite is maintenance with no
consumer. Codex remains a **supported host** (hook + stats via
`~/.codex/config.toml`); only its benchmark harness was removed. Any future
cross-agent claim starts from a fresh measurement rather than from rows we had
already labelled unciteable.

The headline comparison is still the report's direct `scrooge:*` vs
`caveman:full` section. `terse` is a control arm that shows the delta beyond a
generic "answer concisely" instruction.

### About job order and paired scoring

- Default `--order prompt-major`: prompt 0 runs every configured arm (for
  example normal/terse/scrooge/caveman), then prompt 1 runs every configured
  arm, and so on. This is the fair mode for subscription quota because mid-run
  limits affect all arms more evenly.
- `--resume`: skips successful `(arm, prompt_id, run)` keys already present in
  the output JSONL. Use this for long subscription runs that may span quota
  windows.
- `--order arm-major`: legacy mode. It runs every prompt for one arm before the
  next arm; useful only when quota is known to be ample.
- `report.py --paired`: drops any prompt/run key that did not succeed for all
  arms. Final "who won" claims should use paired reports.
- The report automatically prints a direct `scrooge:*` vs `caveman:full`
  comparison when both arms exist. Use `--compare arm_a,arm_b` to override.
- When a `terse` arm exists, the report also prints each skill arm's savings
  vs `terse`. This shows whether Scrooge beats a generic brevity prompt, not
  just the verbose default baseline.

### About `--workers`

- `--workers 1` (default): serial. Race-free, safe under any rate limit.
- `--workers N` (N > 1): `N` concurrent `claude --print` processes. Each call
  runs under a unique sub-cwd (`<cwd>/call-NNNN/`) so session JSONL discovery
  never races. Wall clock ≈ serial / N.
- Subscription rate limit advice: use `--workers 1 --resume` while iterating.
  Use 2–4 only when quota is ample; higher may trip limits during peak hours.

## Reading the report

```text
| Arm                | N | Median | Mean | Min | Max | Stdev | Savings vs baseline (median) |
| ------------------ | -:| -----: | ---: | --: | --: | ----: | ---------------------------: |
| `normal`           | 25|    420 | 433  | 290 | 612 |  78.4 |                  (baseline)  |
| `terse`            | 25|    310 | 323  | 220 | 450 |  58.0 |                      +26.2%  |
| `scrooge:ko/full`  | 25|    260 | 271  | 180 | 405 |  55.1 |                      +38.1%  |
| `caveman:full`     | 25|    295 | 312  | 210 | 480 |  62.3 |                      +29.8%  |
```

- `N` < expected = the arm errored on some prompts. See the "Errors" section.
- `Stdev` close to `Median` = unstable arm; raise `--runs`.
- **Sign convention**: positive % = the arm saved that fraction of tokens vs
  baseline (compression won). Negative % = the arm *increased* tokens vs
  baseline (rare, but possible if the rule prefix is verbose relative to the
  answer).

## Why subscription, not API

- The `anthropic` paid API costs money per measurement.
- Anyone running the benchmark already has a subscription (else they're not
  using Claude Code). Subscription calls aren't free — they consume the
  user's quota — but they're not metered cash.
- caveman's benchmark uses the `anthropic` API + tiktoken; we explicitly
  avoid both (subscription + real `output_tokens`).

## Host isolation

A register plugin's hook (scrooge's `UserPromptSubmit`/`SessionStart`, caveman's)
injects its directive into the *user-message channel* of every child `claude
--print` — independently of `--system-prompt`, and into the neutral baseline too.
`--system-prompt` replaces the system prompt but does **not** stop these hooks, so
without isolation the "normal" arm silently receives a compression instruction and
the savings-vs-normal number collapses (and a KO scrooge state even forces Korean
answers onto an English run).

To stop this, the harness moves the hooks' **activation-state files** aside for the
benchmark duration (default; disable with `--no-isolate-host`):

- `~/.claude/.scrooge/{global,default,sessions/*}` plus the legacy root-level
  `~/.claude/.scrooge-active*` dotfiles — scrooge's state. `hooks/scrooge-activate.js` injects nothing when the state file is absent
  (`if (state) emit(...)`), so removing it silences the hook.
- `~/.claude/.caveman-active` — caveman's state flag.

Moving only the *state files* (not `settings.json`) silences the register hooks
without dropping the parent session's other hooks or risking a plugin re-enable.
`--isolate-settings` additionally moves `settings.json` for the rare case of a hook
wired there directly (off by default). All moved files are restored on exit; a
stale backup (parent re-created the file mid-run) is discarded rather than
clobbered.

After moving them, the harness runs a **pre-flight register check**
(`verify_register_clean`) inside the isolation window: a remaining scrooge state file
/ `.caveman-active` / actively-wired caveman in `settings.json` is **blocking** (the
run aborts unless `--allow-contaminated`); an installed-but-inert caveman plugin or
skill symlink is **advisory**. The per-session contamination check (above) is the
authoritative backstop — any row whose transcript shows a register-hook injection
is excluded regardless of the pre-flight tier.

## Limitations

- **Chat-prose workload only — the largest limitation here.** Every published row
  is single-turn with no tool use (`tool_use_output_tokens: 0`, `turns: 1`). The
  register rewrites prose; tool-call payloads are left verbatim by design, so in an
  agentic session it reaches only part of billed output — measured at **13.8%
  pooled / 29.5% median** over 930 real sessions
  ([`session-evidence/`](./session-evidence/)). Every savings figure in this file
  is therefore a chat-prose figure. Whole-session savings are not derivable from
  it, and are not claimed (no counterfactual, ADR-003).
- **No cross-agent numbers.** The Codex harness was removed in v0.23.0 (above);
  every figure here is Claude Code subscription only. A Codex or other-host claim
  would need its own measurement, not a re-label of these rows.
- **Session-file discovery race**: the harness picks the *newest* `.jsonl`
  in the cwd's project dir after each call. Serial mode (`--workers 1`, the
  default) is race-free. Parallel mode (`--workers N`) routes each call
  through a unique sub-cwd (`<cwd>/call-NNNN/`) so concurrent writes land in
  distinct project subdirs and the newest-jsonl probe stays unambiguous.
- **Host-isolation lock**: only one `run.py` may isolate the host at a
  time. An atomic mkdir lock at `/tmp/scrooge-bench-isolation.lock.d/`
  serializes invocations across processes; a second concurrent run exits
  immediately with code 2 instead of clobbering the first's backups. Backups
  carry the holder PID (e.g. `/tmp/scrooge-bench-.scrooge-active.<pid>.bak`). If
  a run is hard-killed it may leave a state file in `/tmp` and the lock dir
  behind: restore the `.bak` to `~/.claude/` and, after checking `holder.pid` is
  no longer running, remove the lock dir manually.
- **Hook-based activation is bypassed** by design — the rule text is injected
  via `claude --print --system-prompt …` rather than via the production
  UserPromptSubmit hook. Functionally equivalent (same model context, same
  channel: system prompt), but it means we measure the *register's* effect,
  not the activation hook itself. Hook latency / hook bugs are out of scope.
