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
- **Pinned model** — pass `--model <id>` (e.g. `--model claude-opus-4-7`) for a
  reproducible headline. Without it, the CLI's configured model is used and the
  number drifts as that default changes.

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
  --model claude-opus-4-7 \
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

Every published table number is the **ratio of medians** over fully paired
prompts — median each arm, then `1 − median(scrooge) / median(normal)`. The
per-prompt median is a different statistic that `report.py` does not compute, and
the README quotes both for JA/HI/ZH:

| Published number | Statistic | How |
| ---------------- | --------- | --- |
| Every language table (KO ~70%, EN ~66%, JA ~64%, HI ~63%, ZH ~67%) and the KO/EN held-out cross-check | ratio of medians, paired | `report.py --input <file> --baseline normal --paired` |
| `lean` flag (KO +34.6%, EN +10.3%) | same, but the baseline is the register without the flag | `report.py --input <file> --baseline scrooge:{lang}/full --paired` |
| JA/HI/ZH per-prompt medians (69.6% / 66.6% / 62.9%) | median of per-prompt ratios | **not produced by `report.py`** — for each prompt compute `1 − scrooge/normal`, then take the median of those ratios |

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

### The `lite` dial — measured, then not adopted

`lite` ships in all five languages and carries **no savings estimate**. That is a
decision, not a gap: it was measured on the held-out report corpus (N=19,
judge N=3, 2026-07-20) and lost on both axes at once.

| Arm | Savings vs `normal` | vs `terse` | Fidelity (claim-preservation) |
| --- | ------------------: | ---------: | ----------------------------: |
| `scrooge:ko/lite` | +43.8% | +24.6% (win 17/19) | 0.650 |
| `scrooge:ko/full` | +63.8% | — | **0.690** |
| `scrooge:en/lite` | +60.3% | +26.2% (win 15/19) | 0.700 |
| `scrooge:en/full` | +72.0% | — | **0.720** |

A middle dial only earns its place by trading compression for fidelity. `lite`
compresses **less** than `full` and preserves **less** — a Pareto loss in both
languages — so the verdict was **NO-GO**. The dial stays shipped (removing a
shipped surface is expensive and needs its own decision), but no `lite` ratio is
injected into `LANG_META` or `/scrooge-stats`: publishing an estimate would
advertise a dial the measurement rejected. A lite session therefore shows measured
tokens with no estimate, and says why.

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
python3 benchmarks/report.py --input benchmarks/published/results-hi-tuning.jsonl --baseline normal --paired
python3 benchmarks/report.py --input benchmarks/published/results-zh-tuning.jsonl --baseline normal --paired
```

Two caveats, both load-bearing. **This is the tuning corpus, not the held-out
one** — ADR-003 keeps them separate, so these figures stay here as the control
evidence and are never promoted to a language headline (which is why HI still
reads ~63% and ZH ~67% above, from the held-out rows). And **ZH excludes prompt
15**: its `normal` and `terse` runs never answered, delegating to a background
workflow and returning a stub instead. That is host behaviour leaking into the
benchmark child, not a register effect; the harness's contamination detector only
recognises register-hook injection, so the exclusion is manual and recorded in
[`published/README.md`](./published/README.md).

### The `lean` flag numbers

`lean` is a behavior flag, not a dial, so its A/B baseline is the same register
*without* the flag — not `normal`. That makes it a different comparison from
every table above, and the savings compose on top of the language headline
rather than replacing it:

```sh
python3 benchmarks/report.py --input benchmarks/published/results-lean2-ko.jsonl \
  --baseline scrooge:ko/full --paired    # KO +34.6% (n=22)
python3 benchmarks/report.py --input benchmarks/published/results-lean2-en.jsonl \
  --baseline scrooge:en/full --paired    # EN +10.3% (n=21)
```

The 24pp gap between the two languages is why the README quotes both rather than
an average. Both corpora ran 24 prompt/run pairs; the usable n differs only
because of failed runs (KO 2, EN 3).

### Expected variance

Single run, N=11–25, no variance estimate — a few prompts drop on subscription
timeouts. Re-running shifts any single cell by a few percentage points, so treat
headline percentages as **one-significant-figure estimates** (`~70%`, not
"69.5% exactly"). `normal` has the widest spread (its stdev is near its median).

### Foreground only

Background runs get killed at session boundaries in this harness, which silently
truncates a run and biases the medians. Always run the benchmark **foreground**
and pass `--resume` to pick up any prompts that timed out — never background it.

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

Read it honestly, in three parts:

- **The direction holds.** scrooge preserves more claims in both languages, and
  wins per prompt 8-of-16 (4 ties) in KO and 9-of-11 in EN.
- **The margin is modest, and much smaller in English** — +0.08 median in KO but
  only +0.03 in EN. "caveman discards information, scrooge keeps it" overstates a
  0.03 gap; on this corpus the two are close.
- **Safety preservation does not separate them at all** — identical in both
  languages (12/16, 9/11). Whatever distinguishes the two registers, it is not the
  safety-prose escape.

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
(e.g. memory-compress, where the candidate IS a compression of the same source).

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
    gate** for memory-compress-style work, reported but not the register headline.

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

## Codex secondary benchmark

`run_codex.py` is a **best-effort secondary cross-agent signal, never a headline
source.** `run.py` (Claude Code subscription) is the primary harness; `run_codex.py`
reuses its arm specs and JSONL shape through `codex exec`, but Codex runs a
different runtime, tokenizer, and instruction wrapper. **Do not mix its numbers into
the headline `claude-opus-4-8` subscription figures** — keep Codex rows in their own
table (see [Limitations](#limitations)). Use it as a portability check while Claude
quota is tight.

```bash
python3 benchmarks/run_codex.py \
  --prompts benchmarks/prompts/ko.txt \
  --arms normal,terse,scrooge:ko/full,caveman:full \
  --runs 1 \
  --max-prompts 3 \
  --resume \
  --output benchmarks/results-ko-codex-smoke.jsonl

python3 benchmarks/report.py \
  --input benchmarks/results-ko-codex-smoke.jsonl \
  --baseline normal \
  --paired \
  --show-text 240
```

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

- **Codex is a separate harness, not a `run.py` arm.** Use
  `benchmarks/run_codex.py` for secondary portability checks, and keep its
  results separate from Claude Code results. Do not mix Claude/Codex rows in one
  headline table.
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
