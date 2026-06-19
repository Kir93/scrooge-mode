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
  (`verify_register_clean`). An *active* channel (a present `.scrooge-active*`
  state file, a `.caveman-active` flag, or `settings.json` actively wiring caveman)
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

A register plugin's hook (scrooge's `UserPromptSubmit`/`SessionStart`, caveman's)
injects its directive into the *user-message channel* of every child `claude
--print` — independently of `--system-prompt`, and into the neutral baseline too.
`--system-prompt` replaces the system prompt but does **not** stop these hooks, so
without isolation the "normal" arm silently receives a compression instruction and
the savings-vs-normal number collapses (and a KO scrooge state even forces Korean
answers onto an English run).

To stop this, the harness moves the hooks' **activation-state files** aside for the
benchmark duration (default; disable with `--no-isolate-host`):

- `~/.claude/.scrooge-active` and any `~/.claude/.scrooge-active-*` — scrooge's
  state. `hooks/scrooge-activate.js` injects nothing when the state file is absent
  (`if (state) emit(...)`), so removing it silences the hook.
- `~/.claude/.caveman-active` — caveman's state flag.

Moving only the *state files* (not `settings.json`) silences the register hooks
without dropping the parent session's other hooks or risking a plugin re-enable.
`--isolate-settings` additionally moves `settings.json` for the rare case of a hook
wired there directly (off by default). All moved files are restored on exit; a
stale backup (parent re-created the file mid-run) is discarded rather than
clobbered.

After moving them, the harness runs a **pre-flight register check**
(`verify_register_clean`) inside the isolation window: a remaining `.scrooge-active*`
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
