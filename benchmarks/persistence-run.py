#!/usr/bin/env python3
"""Multi-turn register-persistence runner.

`run.py` measures one turn per session: every call is a fresh `claude --print`,
and its `--resume` resumes a RESULTS FILE, not a conversation. So the claim this
harness exists to test — that a `## Boundaries` exclusion survives a long
session, context compaction included — had no reproducible path. This runs ONE
session per arm, feeds it turn after turn, and writes every response so
`persistence-score.py` can judge them.

Design notes worth keeping:

- **Host register hooks are isolated, exactly as `run.py` does it.** While a
  scrooge state file is present the user's own `UserPromptSubmit` hook injects the
  register into EVERY child `claude --print` — which would re-inject, every turn,
  the very register whose survival is the question, and compress the `normal` arm
  too. `host_isolation` + `check_register_clean` are shared with `run.py`, not
  restated, and a blocking finding aborts.
- **Session identity is supplied, not discovered.** `--session-id` fixes the id
  up front, so resuming needs no scan of `~/.claude/projects/<slug>/` and a
  concurrent session cannot be picked up by mistake. A failed FIRST turn aborts
  the arm: turn 1 is what creates the session and installs the register, so
  resuming past its failure would spend quota on turns that cannot measure
  anything. Its retries use a fresh id, since a partly-created session would make
  the id a duplicate.
- **Compaction is REQUESTED, never forced — so it is verified.** `--autocompact`
  sets the auto-compact WINDOW SIZE (`auto`, or 100k-1M; the CLI rejects anything
  else). It does not trigger a compaction; the session still has to grow past the
  window. Measured on this machine, the smallest observed trigger was ~64.7k
  tokens, while a 12-turn run of the short outbound probes reaches roughly 50-60k
  — i.e. the documented default can finish every turn cleanly having never
  compacted at all. So each row records how many `compact_boundary` records the
  session actually accumulated, and an arm that saw none is reported as
  NOT having tested the post-compaction path.
- **File-mutating tools are denied by default.** These corpora ask for a
  document; with tools available the model may write it to a file and answer
  "wrote X.md", leaving nothing to score.
- **Output goes to its OWN JSONL.** `report.py --paired` intersects the success
  keys of every arm in a file, so mixing these rows into an existing results
  file would collapse that file's paired set.
- Retry policy is `run.py`'s — the loop itself, not a copy of it: a 529 must not
  kill a session that is 20 turns deep. The one narrowing is that a resume turn
  never retries a TIMEOUT: a killed process leaves the session state ambiguous,
  and a re-send can duplicate a turn inside a live conversation.

usage:
  benchmarks/persistence-run.py \
    --arms "scrooge:ko/full,normal" \
    --prompts benchmarks/prompts/ko-outbound.txt \
    --filler-prompts benchmarks/prompts/ko.txt \
    --turns 12 --autocompact 100k \
    --output benchmarks/results-ko-persistence.jsonl
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load_run_py():
    """Load `run.py` as a module so its harness rules are reused, not restated.

    Same importlib shape `test_report_stats.py` uses: the file sits next to this
    one but `run` is too generic a module name to put on sys.path.
    """
    spec = importlib.util.spec_from_file_location("_bench_run", HERE / "run.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_bench_run"] = mod
    spec.loader.exec_module(mod)
    return mod


BENCH = _load_run_py()


def build_turn_cmd(session: str, prompt: str, first: bool, rule_text: str,
                   model: str | None, autocompact: str,
                   disallow_tools: bool) -> list[str]:
    """argv for one turn of a persistent session.

    The register goes in on the FIRST turn only: `--system-prompt` establishes
    the session's system prompt, and a resumed turn inherits it. Passing it again
    is what a real session never does, so it would measure a re-injected register
    rather than a persisting one.
    """
    cmd = ["claude", "--print"]
    if first:
        cmd += ["--session-id", session]
        cmd += ["--system-prompt", rule_text or BENCH.NORMAL_BASELINE_SYSTEM]
    else:
        cmd += ["--resume", session]
    cmd += ["--autocompact", autocompact]
    if model:
        cmd += ["--model", model]
    if disallow_tools:
        cmd += ["--disallowedTools", "Write", "Edit", "NotebookEdit", "Bash"]
    cmd += ["--", prompt]
    return cmd


def _retryable_on_a_live_session(error: str | None) -> bool:
    """Retry verdict for a turn that resumes an existing session.

    A 429/5xx is a server-side rejection: nothing reached the conversation, so
    re-sending is safe and the module docstring's "a 529 must not kill a session
    that is 20 turns deep" still holds.

    A TIMEOUT is different. It says the local process was killed at the deadline
    — not that the remote turn was never applied. A killed `claude --print`
    demonstrably leaves the user turn in the session JSONL with no assistant turn,
    so re-sending the same prompt can put one logical turn into the session twice.
    And the damage does not stop at that turn: every later turn of the arm then
    carries extra context and a shifted autocompact boundary, while the JSONL
    records only the second stdout. The arm becomes unmeasurable without saying so.
    """
    if error and "timeout" in error.lower():
        return False
    return BENCH.is_retryable(error)


def run_turn(make_cmd, cwd: Path, timeout: int, label: str = "",
             first: bool = False) -> tuple[str | None, str | None]:
    """One turn, through run.py's retry loop. Returns (output_text, error).

    The loop itself is `run.py`'s — a second copy would let the attempt bound and
    the both-streams retry verdict drift apart from the runner the published
    numbers come from. `make_cmd(attempt)` is what lets the first turn retry under
    a fresh session id; a resume turn instead narrows the retry verdict, since it
    cannot mint its way out of an ambiguous session state.
    """
    proc, error, _reason = BENCH.call_with_retry(
        make_cmd, cwd, timeout, label,
        retryable=None if first else _retryable_on_a_live_session)
    return (proc.stdout.strip() if proc else None), error


def redact_argv(cmd: list[str]) -> str:
    """argv as one readable line, with the register body replaced by its size.

    A dry run exists to show the WIRING — `--autocompact`, the turn-1
    `--session-id` + `--system-prompt` shape, the `--resume` shape on later turns.
    The rule text itself is several KB and would bury all of it.
    """
    out, skip_next = [], False
    for i, part in enumerate(cmd):
        if skip_next:
            out.append(f"<rule:{len(part)} chars>")
            skip_next = False
            continue
        out.append(part if len(part) < 60 else f"<{len(part)} chars>")
        skip_next = part in ("--system-prompt", "--append-system-prompt")
    return " ".join(out)


def compactions_seen(cwd: Path, session: str) -> int | None:
    """How many auto-compactions this session has accumulated so far.

    Claude Code writes one `{"type":"system","subtype":"compact_boundary"}` record
    per compaction, carrying `compactMetadata.preTokens`. It lands in the same
    transcript `register_in_transcript()` already reads, so counting it is free —
    and it is the only thing that distinguishes "the register survived compaction"
    from "the session never compacted". None = no transcript to read.
    """
    path = BENCH.cwd_session_dir(cwd) / f"{session}.jsonl"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    n = 0
    for line in text.splitlines():
        if '"compact_boundary"' not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("type") == "system" and rec.get("subtype") == "compact_boundary":
            n += 1
    return n


def register_in_transcript(cwd: Path, session: str, rule_text: str) -> bool | None:
    """Is the register text still present in this session's transcript?

    Diagnostic only — never a verdict. The harness assumes a `--resume` turn
    inherits the `--system-prompt` set on turn 1; if that assumption is wrong every
    arm collapses to the same thing and the run reports "boundary held" for the
    wrong reason. Recording this makes that failure visible in the data instead of
    invisible. None = no transcript to read (nothing is claimed either way).
    """
    if not rule_text.strip():
        return None  # the baseline arm has no register to look for
    path = BENCH.cwd_session_dir(cwd) / f"{session}.jsonl"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    needle = next((ln.strip() for ln in rule_text.splitlines() if len(ln.strip()) > 20), None)
    return needle in text if needle else None


def turn_plan(probes: list[str], fillers: list[str], turns: int) -> list[tuple[str, str]]:
    """Interleave probe turns with filler turns, as (kind, prompt).

    Persistence is about DISTANCE from the register injection, so the probes have
    to be spread across the session rather than fired back to back. Fillers are
    ordinary prompts; they are not scored, they just push the conversation along
    (and, with `--autocompact`, past a compaction boundary).
    """
    plan: list[tuple[str, str]] = []
    p = f = 0
    while len(plan) < turns and (probes or fillers):
        if probes and (not fillers or len(plan) % 2 == 0):
            plan.append(("probe", probes[p % len(probes)]))
            p += 1
        else:
            plan.append(("filler", fillers[f % len(fillers)]))
            f += 1
    return plan


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arms", required=True, help="Comma-separated arm specs (run.py syntax).")
    ap.add_argument("--prompts", required=True, type=Path, help="Probe corpus.")
    ap.add_argument("--filler-prompts", type=Path, help="Unscored prompts that push the session along.")
    ap.add_argument("--turns", type=int, default=12, help="Turns per session. Default 12.")
    ap.add_argument("--autocompact", default="100k",
                    help="`auto`, or 100k-1M. The CLI rejects anything else.")
    ap.add_argument("--output", required=True, type=Path, help="JSONL (its own file — see module docstring).")
    ap.add_argument("--cwd", type=Path, default=BENCH.DEFAULT_BENCH_CWD)
    ap.add_argument("--model", default=BENCH.LATEST_OPUS)
    ap.add_argument("--timeout", type=int, default=420,
                    help="Per-turn timeout. Default 420s, not 180: a compaction "
                         "itself took 79-230s (median ~152s) in local transcripts, "
                         "so a tighter timeout kills the very turn being measured.")
    ap.add_argument("--allow-tools", action="store_true",
                    help="Permit file-mutating tools. Off by default — see module docstring.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Walk the turn plan and the JSONL path with synthetic responses. "
                         "Spends no quota — use it to catch a wiring error for free.")
    ap.add_argument("--no-isolate-host", action="store_true",
                    help="Skip moving host register state files aside. Only for a host "
                         "already known clean; see module docstring.")
    ap.add_argument("--isolate-settings", action="store_true")
    ap.add_argument("--allow-contaminated", action="store_true",
                    help="Proceed despite blocking register-hook findings (rows are marked).")
    args = ap.parse_args()

    if not args.dry_run and shutil.which("claude") is None:
        print("error: `claude` CLI not on PATH. Install Claude Code or pass --dry-run.",
              file=sys.stderr)
        return 2

    # Same resolve run.py does: `cwd_session_dir` slugifies the path character by
    # character, so a relative --cwd hashes to a directory that does not exist and
    # every transcript lookup silently returns None.
    args.cwd = args.cwd.resolve()

    if args.output.exists() and args.output.stat().st_size:
        print(f"refusing to append to a non-empty {args.output} — "
              "these rows must not share a file with another run's arms", file=sys.stderr)
        return 2

    args.cwd.mkdir(parents=True, exist_ok=True)
    probes = BENCH.load_prompts(args.prompts)
    fillers = BENCH.load_prompts(args.filler_prompts) if args.filler_prompts else []
    if not probes:
        print(f"no prompts in {args.prompts}", file=sys.stderr)
        return 2
    plan = turn_plan(probes, fillers, args.turns)

    with BENCH.host_isolation(enabled=not args.no_isolate_host and not args.dry_run,
                              isolate_settings=args.isolate_settings):
        isolation_verified = None
        if not args.dry_run:
            # No per_row_backstop: this runner drives its own turns and never calls
            # `detect_contamination`, so the preflight must not promise a row-level
            # exclusion that does not exist here.
            isolation_verified = BENCH.check_register_clean(
                args.cwd, args.allow_contaminated, per_row_backstop=False)
            if isolation_verified is None:
                return 2
        with args.output.open("a", encoding="utf-8") as out:
            for spec in args.arms.split(","):
                arm, rule_text = BENCH.resolve_arm(spec.strip())
                session = str(uuid.uuid4())
                print(f"[{arm}] session={session} turns={len(plan)} "
                      f"autocompact={args.autocompact}", file=sys.stderr)
                for turn, (kind, prompt) in enumerate(plan, start=1):
                    first = turn == 1
                    ids = {"n": session}

                    def make_cmd(attempt, _p=prompt, _f=first, _ids=ids):
                        if _f and attempt > 1:
                            _ids["n"] = str(uuid.uuid4())  # see run_turn's docstring
                        return build_turn_cmd(_ids["n"], _p, _f, rule_text, args.model,
                                              args.autocompact, not args.allow_tools)

                    started = time.monotonic()
                    # Build the argv even on a dry run and record it: `--autocompact`
                    # has no prior use anywhere in this repo, and the turn-1 vs
                    # resume shapes differ, so the argv IS the wiring a free run
                    # needs to show.
                    if args.dry_run:
                        text, error = f"[dry-run] {arm} turn={turn} kind={kind}", None
                        print(f"    argv: {redact_argv(make_cmd(1))}", file=sys.stderr)
                    else:
                        text, error = run_turn(make_cmd, args.cwd, args.timeout,
                                              label=f"{arm} turn={turn}", first=first)
                    session = ids["n"]
                    row = {
                        "arm": arm, "session_id": session, "turn": turn, "kind": kind,
                        "prompt": prompt, "output_text": text, "error": error,
                        "elapsed_s": round(time.monotonic() - started, 2),
                        "model": args.model, "autocompact": args.autocompact,
                        "isolation_verified": isolation_verified,
                        # Whether the register text is still in the session transcript
                        # at this turn. Recorded, never used as a verdict: it is the
                        # only signal that would catch `--system-prompt` NOT being
                        # inherited across `--resume`, which would make every arm
                        # identical and every run report "boundary held".
                        "register_in_transcript": (
                            None if args.dry_run
                            else register_in_transcript(args.cwd, session, rule_text)
                        ),
                        # Compactions the session has accumulated by this turn. An
                        # arm that ends at 0 never exercised the post-compaction
                        # path, whatever --autocompact was set to.
                        "compactions": (
                            None if args.dry_run
                            else compactions_seen(args.cwd, session)
                        ),
                    }
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    mark = "ERR" if error else f"{len(text or '')}ch"
                    print(f"  [{turn}/{len(plan)}] {kind} {mark}"
                          + (f" {error}" if error else ""), file=sys.stderr)
                    if error and first:
                        print("  first turn failed — the session and its register were "
                              "never established; skipping the rest of this arm.",
                              file=sys.stderr)
                        break
                    if error and "timeout" in error.lower():
                        # Not retried (see _retryable_on_a_live_session) and not
                        # continued either: the session may or may not carry this
                        # turn, so every later turn would measure an unknown state.
                        print(f"  turn {turn} timed out on a live session — session "
                              "state is now ambiguous; stopping this arm rather than "
                              "measuring an unknown conversation.", file=sys.stderr)
                        break
                    seen = row["compactions"]
                    if error and BENCH.is_session_limit(error):
                        # Stop the whole run, not just this arm: the next arm's
                        # first turn would fail on the same limit, burn a call, and
                        # leave an unusable arm in the file. run.py stops the same way.
                        print("session/rate limit — stopping the run. Re-run after reset "
                              "into a fresh --output file.", file=sys.stderr)
                        return 1
                if not args.dry_run:
                    final = compactions_seen(args.cwd, session)
                    if final:
                        print(f"  [{arm}] {final} compaction(s) observed — "
                              "post-compaction path exercised.", file=sys.stderr)
                    else:
                        print(f"  [{arm}] 0 compactions observed — this arm did NOT "
                              "test the post-compaction path. Raise --turns, or use a "
                              "longer --filler-prompts corpus, until the session "
                              "crosses the --autocompact window.", file=sys.stderr)

    print(f"wrote {args.output}. Score with: "
          f"benchmarks/persistence-score.py --input {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
