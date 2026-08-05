# Session evidence — real-session drift & compliance mining

Offline analysis of **real** Claude Code session transcripts: does the Scrooge
register hold up across a multi-turn session? The headline benchmark measures
one isolated turn per arm (`claude --print --system-prompt <rule>`); real
`/scrooge` sessions are multi-turn, re-inject a reminder every other turn, and
carry the full Claude Code system prompt. This directory measures that gap —
**on the drift/compliance axis only**.

> **No savings numbers, by design (ADR-003).** A real session has no verbose
> counterfactual arm, so "tokens saved" cannot be measured here and is never
> emitted — no saved tokens, no USD, no percentages. Drift ≠ savings: a flat
> trajectory says the register *held*, not how much it *saved*.

## Inputs

- Session JSONL (`~/.claude/projects/<slug>/<uuid>.jsonl`) — parsed by
  `lib/session-log.js` `parseClaudeSessionTurns` (per-turn array; the same
  `message.id` dedup as the aggregate stats). Primary source: turn trajectories
  need per-turn data.
- Subagent transcripts (`<slug>/<uuid>/subagents/*.jsonl`) — **opt-in** via
  `--subagents`, aggregated separately from main-session turns.

## Usage

```sh
node benchmarks/session-evidence/analyze.js <session.jsonl> [...] [--subagents]
```

Emits a JSON observation record per session:

- `turns[]` — per turn: output tokens, prose vs `tool_use`, safety-register
  categories present (`detectSafety`), verbatim span counts (`extractSpans`:
  fenced / inline / URLs). Signals reuse `benchmarks/fidelity/checks.js`
  single-text functions unchanged; the paired checks (`byteExactCheck`,
  `safetyCheck`) need a baseline arm and are not applicable to real sessions.
- `trajectory` — output tokens per turn relative to that bucket's turn 1,
  prose and `tool_use` separated. Intra-session only.
- `subagentTurns[]` — same signals for opt-in subagent transcripts, tagged
  `isSubagent: true`.

## Drift report

```sh
node benchmarks/session-evidence/report.js <session.jsonl> [...] [--subagents]
```

`report.js` classifies each session's **prose** trajectory (late-half median
output vs early-half median) and aggregates one verdict:

| Verdict | Meaning | Consequence |
| --- | --- | --- |
| `caveat-relax` | Trajectories flat — register held across real multi-turn sessions | README single-turn caveat relaxed on the register-**retention** axis only; the savings clause is untouched (no counterfactual → no savings claim, ADR-003) |
| `reinject-tune` | Majority of conclusive sessions drift upward | Evidence input for tuning the reminder cadence (`hooks/scrooge-activate.js` "every other turn"); the cadence change itself is out of scope here |
| `inconclusive` | Too few conclusive sessions (below `minProseTurns`) | No judgment — thresholds in `DEFAULT_THRESHOLDS`, overridable |

Subagent turns (opt-in) are aggregated as a separate compliance readout
(`subagent.{turns,proseTurns,safetyTurns,spanTurns}`) and never enter the
main-session verdict.

Known limitation (measurement-gated, spec Open Questions): per-turn output
tracks request complexity as much as register adherence; the median-based
ratio dampens but does not remove that confound.

### Measured

Committed aggregate: [`results.json`](./results.json) — the report output, so the
README's retention numbers can be checked against a file in the repo rather than
against prose. Session selection and command:

```sh
# every transcript whose text carries the activation marker
grep -rl "SCROOGE MODE ACTIVE" --include="*.jsonl" ~/.claude/projects > /tmp/scrooge-sessions.txt
tr '\n' '\0' < /tmp/scrooge-sessions.txt \
  | xargs -0 node benchmarks/session-evidence/report.js --subagents \
  > benchmarks/session-evidence/results.json
```

| Run | Sessions | Conclusive | Retained / drifting | Median late/early | Verdict |
| --- | -------: | ---------: | ------------------- | ----------------: | ------- |
| 2026-07-27 (first) | 372 | 134 | 103 / 31 | 0.845 † | `caveat-relax` |
| 2026-07-31 | 744 | 177 | 136 / 41 | 0.834 | `caveat-relax` |
| 2026-08-05 (committed) | 930 | 188 | 145 / 43 | 0.833 | `caveat-relax` |

Every cell in the committed row is a field of [`results.json`](./results.json) —
`main.total`, `main.conclusive`, `main.retained` / `main.drifting`,
`main.medianRatio`, `main.verdict`. The median is over conclusive sessions only.

† The first run predates the committed artefact, so its numbers cannot be checked
against a file; it is kept for the run-to-run comparison, not as evidence.

The corpus is **live** — it is the maintainer's own session directory, which grows
and rotates, so a re-run never reproduces the committed row exactly (an in-progress
session's own transcript is part of the input). Treat the committed numbers as a
dated snapshot; the stable finding is the verdict, which has held across both runs.

The current run's subagent readout: 3,562 turns (409 prose), safety signals in
297, verbatim spans in 747. The verdict is unchanged across all three runs and is
applied to the README "Register-only isolation" caveat — retention axis only.

### Reach — how much of the billed output the register can touch

Retention answers "does the register hold across a long session". It does not
answer the prior question: **how much of what gets billed is prose the register
can act on at all.** Tool-call payloads — diffs, file writes, exact error
strings, tool JSON — are left verbatim by design, so in an agentic session they
are output the register never reaches.

| Field | 2026-08-05 |
| ----- | ---------: |
| Sessions with output | 917 |
| Prose output tokens | 4,865,944 |
| Total output tokens | 35,312,551 |
| **Pooled prose share** | **13.8%** |
| **Median session prose share** | **29.5%** |

Both are `results.json` → `reach.*`. They differ because they answer different
questions: pooled is "of every output token billed, what share was prose" and is
dominated by the largest sessions; the median is "in a typical session, what
share was prose". Quoting only the higher one would defeat the point of measuring.

This matters for how the headline numbers are read. Every published savings figure
comes from a **single-turn, zero-tool chat corpus** — every row in
[`published/`](../published/) has `tool_use_output_tokens: 0` and `turns: 1`. In an
agentic session the register reaches roughly an eighth to a third of billed output,
so whole-session savings are much smaller than the headline. That gap is a property
of the workload, not a defect in the measurement — but it has to be stated, because
the product installs into agentic harnesses while the corpus is conversational.

**This is not a savings figure.** It is a direct measurement of billed tokens: what
share was prose, never what an uncompressed run would have cost. ADR-003 rules out
the latter from real sessions (there is no counterfactual), and nothing here
attempts it. A reader can see the ceiling; a whole-session savings percentage is
still not derivable.

> **Reproducibility limit.** The input is the maintainer's own private session
> transcripts, so a third party cannot re-run this. Committing `results.json`
> does not make it reproducible; it makes the README's four retention numbers
> checkable against a committed field instead of against prose. Rows carry the
> session-id basename only — never a path, and never message content.
