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
python3 benchmarks/run.py \
  --prompts benchmarks/prompts/ko.txt \
  --arms normal,terse,scrooge:ko/full,caveman:full \
  --runs 1 \
  --workers 1 \
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

## Codex secondary benchmark

Use Codex while Claude quota is tight, but keep the result separate from the
Claude Code benchmark. Codex uses a different runtime, tokenizer, and prompt
wrapper, so it is a portability signal, not the canonical README claim.

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

The harness moves the following aside for the benchmark duration (default;
disable with `--no-isolate-host`):

- `~/.claude/settings.json` — if any hook injects rule text via
  `SessionStart` or `UserPromptSubmit` (e.g. caveman's globally-installed
  hook), child `claude --print` calls inherit it, polluting the "normal"
  arm baseline. Moving this file aside guarantees the only register
  instruction reaching the child is the one this benchmark passes via
  `--system-prompt`.
- `~/.claude/.caveman-active` — caveman's state file. Belt-and-suspenders;
  some hooks may default-activate without it.

Both files are restored on exit. If the parent claude session re-creates
either file mid-benchmark, the stale backup is discarded.

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
  immediately with code 2 instead of clobbering the first's backups
  (`~/.claude/settings.json` could previously be lost). Backups now carry
  the holder PID (`/tmp/scrooge-bench-settings.json.<pid>.bak`). If a run
  crashes and leaves the lock dir behind, check `holder.pid` inside it,
  confirm that PID is no longer running, then remove the dir manually.
- **Hook-based activation is bypassed** by design — the rule text is injected
  via `claude --print --system-prompt …` rather than via the production
  UserPromptSubmit hook. Functionally equivalent (same model context, same
  channel: system prompt), but it means we measure the *register's* effect,
  not the activation hook itself. Hook latency / hook bugs are out of scope.
