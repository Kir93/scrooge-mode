#!/usr/bin/env python3
"""Multi-turn register-persistence runner.

`run.py` measures one turn per session: every call is a fresh `claude --print`,
and its `--resume` resumes a RESULTS FILE, not a conversation. So the claim this
harness exists to test — that a `## Boundaries` exclusion survives a long
session, context compaction included — had no reproducible path. This runs ONE
session per arm, feeds it turn after turn, and writes every response so
`persistence-score.py` can judge them.

Design notes worth keeping:

- **The register arrives through the REAL hook channel, not `--system-prompt`.**
  This is what the original measurement did and what a user experiences: the full
  rule at `SessionStart` (session start, resume, and every compaction), a
  boundary-FREE 116-char reminder on every `UserPromptSubmit`. `--system-prompt`
  was the wrong channel twice over — measured, it does not survive `--resume` at
  all, and even where it applies it re-asserts the whole rule every turn, which
  the product never does.
- **Isolation is by flag, not by moving the user's files.** `--setting-sources
  project` drops user settings, so the host's own scrooge plugin stops firing
  (its `enabledPlugins` lives there), while `--settings <bench.json>` still loads
  and wires this repo's hooks against a bench-owned `CLAUDE_CONFIG_DIR`. Nothing
  under `~/.claude` is touched, so there is no lock, no restore step, and no way
  for an interrupted run to leave the user deactivated. Passing `--model`
  explicitly is required, since that flag drops the user's model setting too.
- **The arm IS the bench state file.** `scrooge:ko/full` writes
  `<tmpdir>/.scrooge/default`; `normal` leaves it absent, and the hook then emits
  nothing on its own (`if (state) emit(...)`). Same hook code both arms.
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
import tempfile
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


def write_bench_settings(cfg_dir: Path, settings_path: Path) -> Path:
    """A settings file wiring THIS repo's hooks against a bench-owned config dir.

    Loaded with `--setting-sources project`, which drops the user's own settings
    (and with them their scrooge plugin), so these are the only register hooks in
    the session. `CLAUDE_CONFIG_DIR` on each hook command is what points
    `hooks/scrooge-config.js` at the bench state instead of `~/.claude`.
    """
    repo = HERE.parent
    def hook(script: str) -> dict:
        return {"hooks": [{
            "type": "command",
            "command": f'CLAUDE_CONFIG_DIR={cfg_dir} node "{repo / "hooks" / script}"',
        }]}
    settings_path.write_text(json.dumps({
        "hooks": {
            "SessionStart": [hook("scrooge-session-start.js")],
            "UserPromptSubmit": [hook("scrooge-activate.js")],
        }
    }, indent=2), encoding="utf-8")
    return settings_path


def write_arm_state(cfg_dir: Path, arm: str) -> str | None:
    """Activate the arm's register in the bench config dir. Returns the state, or None.

    `normal` writes nothing: the hooks emit only when a state file exists, so an
    absent one IS the baseline — the same code path, not a different one.
    """
    state_dir = cfg_dir / ".scrooge"
    state_dir.mkdir(parents=True, exist_ok=True)
    default = state_dir / "default"
    default.unlink(missing_ok=True)
    if not arm.startswith("scrooge:"):
        return None
    spec = arm.split(":", 1)[1]
    dial_spec, *flags = spec.split("+")
    lang, dial = dial_spec.split("/", 1)
    payload = {"lang": lang, "dial": dial, "flags": flags}
    default.write_text(json.dumps(payload), encoding="utf-8")
    return json.dumps(payload)


def build_turn_cmd(session: str, prompt: str, first: bool, settings_path: Path,
                   model: str | None, autocompact: str,
                   disallow_tools: bool) -> list[str]:
    """argv for one turn of a persistent session.

    No `--system-prompt` anywhere: the hooks in `settings_path` deliver the
    register, exactly as an installed scrooge does. `--setting-sources project`
    keeps the user's own plugin from firing alongside them.
    """
    cmd = ["claude", "--print"]
    if first:
        cmd += ["--session-id", session]
    else:
        cmd += ["--resume", session]
    cmd += ["--setting-sources", "project", "--settings", str(settings_path)]
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
    per compaction, carrying `compactMetadata.preTokens`. It is the only thing that
    distinguishes "the register survived compaction" from "the session never
    compacted" — and `--autocompact` sets a window rather than forcing one, so that
    distinction is not decorative. None = no transcript to read.
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


# Asked verbatim as a `liveness` turn. Deliberately OUTSIDE every `## Boundaries`
# class — an ordinary technical question, where the KO register's own rules apply
# in full and 음슴체 endings are the mandated output. That makes its answer the one
# turn in the plan whose register can be read directly.
LIVENESS_PROMPT = (
    "React 컴포넌트가 부모 리렌더마다 자식까지 다시 그려지는 원인과 해결책을 설명해줘."
)


# The banner `hooks/scrooge-activate.js` builds for a FULL rule injection. The hook
# fires at SessionStart, and every turn here is a separate `--resume` process, so
# whether the CLI raises SessionStart on resume decides what this harness measures:
# once per session it is persistence, once per turn it is re-injection. Measured on
# CLI 2.1.220 it fires at startup and compaction only (a 22-turn bench session
# recorded exactly 2: `SessionStart:startup` + `SessionStart:compact`), but that is
# a CLI behavior nothing here controls — so count it and let the scorer object,
# rather than assume it holds at the next version.
INJECTION_BANNER = "SCROOGE MODE ACTIVE"


def injections_seen(cwd: Path, session: str) -> int | None:
    """How many FULL-rule injections this session's transcript records so far."""
    path = BENCH.cwd_session_dir(cwd) / f"{session}.jsonl"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    n = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("type") != "attachment":
            continue
        att = rec.get("attachment")
        if isinstance(att, dict) and att.get("type") == "hook_success" \
                and INJECTION_BANNER in json.dumps(att, ensure_ascii=False):
            n += 1
    return n


def turn_plan(probes: list[str], fillers: list[str], turns: int) -> list[tuple[str, str]]:
    """Interleave probe, filler, and liveness turns, as (kind, prompt).

    Persistence is about DISTANCE from the register injection, so the probes have
    to be spread across the session rather than fired back to back. Fillers are
    ordinary prompts; they are not scored, they just push the conversation along
    (and, with `--autocompact`, past a compaction boundary).

    Every 4th turn is a `liveness` turn, and it is what makes the whole run
    interpretable. Every probe artifact is a `## Boundaries` class, so a probe
    answering in normal prose is indistinguishable from a session that never had
    the register at all — "boundary held" and "register was never applied" produce
    identical rows. The liveness prompt sits outside those classes, so its answer
    SHOULD be compressed; when it is not, the arm proves nothing and the scorer
    says so instead of reporting a clean number.
    """
    plan: list[tuple[str, str]] = []
    p = f = other = 0
    while len(plan) < turns and (probes or fillers):
        if len(plan) and len(plan) % 4 == 3:
            plan.append(("liveness", LIVENESS_PROMPT))
            continue
        # Alternate probe/filler across the NON-liveness turns, filler first.
        # Counting against `len(plan)` instead would let the liveness turns eat the
        # filler slots — measured: 4 fillers in a 16-turn plan, and 4 fillers cross
        # no compaction window at all.
        if fillers and (other % 2 == 0 or not probes):
            plan.append(("filler", fillers[f % len(fillers)]))
            f += 1
        elif probes:
            plan.append(("probe", probes[p % len(probes)]))
            p += 1
        else:
            break
        other += 1
    return plan


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arms", required=True, help="Comma-separated arm specs (run.py syntax).")
    ap.add_argument("--prompts", required=True, type=Path, help="Probe corpus.")
    ap.add_argument("--filler-prompts", type=Path, help="Unscored prompts that push the session along.")
    ap.add_argument("--turns", type=int, default=20,
                    help="Turns per session. Default 20, set from measurement rather "
                         "than taste: FILLER count is the variable that crosses the "
                         "--autocompact window (4 docgen fillers produced none; 8 "
                         "produced at least one on every run so far), and with a "
                         "liveness turn every 4th it takes 20 turns to get 8 fillers. "
                         "Short conversational fillers do not cross it at any of these "
                         "counts — the measured trigger floor is ~64.7k tokens. Read "
                         "the per-arm compaction line the scorer prints; do not assume "
                         "a turn count was enough.")
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
    # `--setting-sources project` loads the CWD's own project settings, and CLI
    # settings MERGE with them rather than replacing them (array-valued hooks are
    # concatenated). The default bench CWD has none, but pointing --cwd at a real
    # project silently adds that project's hooks to every arm — which is exactly
    # the contamination the flag-based isolation above claims to prevent.
    if (args.cwd / ".claude" / "settings.json").exists():
        print(f"[warn] {args.cwd}/.claude/settings.json will load alongside the bench "
              "settings (--setting-sources project merges them). Use a CWD with no "
              "project settings, or treat this run as un-isolated.", file=sys.stderr)
    probes = BENCH.load_prompts(args.prompts)
    fillers = BENCH.load_prompts(args.filler_prompts) if args.filler_prompts else []
    if not probes:
        print(f"no prompts in {args.prompts}", file=sys.stderr)
        return 2
    plan = turn_plan(probes, fillers, args.turns)

    # Isolation is by flag now, not by moving the user's files: `--setting-sources
    # project` stops the host plugin from firing, so `host_isolation()` and its
    # lock are gone from this runner. The bench config dir holds the arm state.
    with tempfile.TemporaryDirectory(prefix="scrooge-persist-") as tmp:
        cfg_dir = Path(tmp)
        settings_path = write_bench_settings(cfg_dir, cfg_dir / "settings.json")
        with args.output.open("a", encoding="utf-8") as out:
            for spec in args.arms.split(","):
                arm = spec.strip()
                arm_state = write_arm_state(cfg_dir, arm)
                print(f"[{arm}] bench config dir={cfg_dir} state={arm_state or '(none)'}",
                      file=sys.stderr)
                session = str(uuid.uuid4())
                print(f"[{arm}] session={session} turns={len(plan)} "
                      f"autocompact={args.autocompact}", file=sys.stderr)
                for turn, (kind, prompt) in enumerate(plan, start=1):
                    first = turn == 1
                    ids = {"n": session}

                    def make_cmd(attempt, _p=prompt, _f=first, _ids=ids):
                        if _f and attempt > 1:
                            _ids["n"] = str(uuid.uuid4())  # see run_turn's docstring
                        return build_turn_cmd(_ids["n"], _p, _f, settings_path,
                                              args.model, args.autocompact,
                                              not args.allow_tools)

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
                        # The arm's register as the bench hooks see it. Validity is
                        # decided by the liveness turns, not by a preflight: the
                        # hook IS the treatment here, so "register present" is what
                        # this run asserts rather than what it excludes.
                        "arm_state": arm_state,
                        # Full-rule injections the transcript records by this turn.
                        # One per session (plus one per compaction) is persistence;
                        # one per turn is re-injection wearing its clothes.
                        "injections": (
                            None if args.dry_run
                            else injections_seen(args.cwd, session)
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
