#!/usr/bin/env python3
"""Register-only isolated single-turn runner + scorer, for boundary corpora.

The persistence question has a second half: does a boundary hold when the
register is the ONLY instruction in the session? A normal `claude` session also
loads the host system prompt, the project `CLAUDE.md`, and the user's personal
skills — any of which could be the reason an outbound draft came out in polite
prose. `--system-prompt` REPLACES the host prompt, and an empty `--cwd` keeps a
project `CLAUDE.md` out, so a run under both conditions attributes the result to
the register text and nothing else.

The execution is `run.py`'s (`run_one` in replace mode) and so is the preflight
(`host_isolation` + `check_register_clean`) — imported, not reimplemented, so the
contamination backstop, session-token parsing, and transport retry behave
identically here. The preflight is not optional decoration: while a scrooge state
file is present the user's own hook injects the register into every child
`claude --print`, including the `normal` arm, which is exactly the confound this
script claims to remove. A contaminated row is excluded rather than scored, the
same way `run.py` excludes it from its token stats.

What this adds on top is the pairing: each surviving row is scored by
`persistence-score.py` as it is written, so a boundary run produces a verdict
rather than a pile of prose to read by hand.

Output goes to its own JSONL for the same reason `persistence-run.py`'s does:
`report.py --paired` intersects success keys across every arm in a file.

usage:
  benchmarks/iso-single.py \
    --arms "scrooge:ko/full,normal" \
    --prompts benchmarks/prompts/ko-outbound.txt \
    --output benchmarks/results-ko-outbound-iso.jsonl
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name: str, filename: str):
    """Load a sibling script as a module (hyphenated names cannot be imported)."""
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


BENCH = _load("_bench_run", "run.py")
SCORE = _load("_bench_score", "persistence-score.py")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arms", required=True, help="Comma-separated arm specs (run.py syntax).")
    ap.add_argument("--prompts", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path, help="JSONL (its own file).")
    ap.add_argument("--cwd", type=Path, default=BENCH.DEFAULT_BENCH_CWD,
                    help="Empty dir, so no project CLAUDE.md is in scope.")
    ap.add_argument("--model", default=BENCH.LATEST_OPUS)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--allow-tools", action="store_true",
                    help="Permit file-mutating tools. Off by default: a document "
                         "corpus with tools available gets written to a file instead "
                         "of emitted, leaving nothing to score.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Synthetic responses; spends no quota. Use it to catch a "
                         "wiring error for free.")
    ap.add_argument("--no-isolate-host", action="store_true")
    ap.add_argument("--isolate-settings", action="store_true")
    ap.add_argument("--allow-contaminated", action="store_true",
                    help="Proceed despite blocking register-hook findings (rows are marked).")
    args = ap.parse_args()

    if not args.dry_run and shutil.which("claude") is None:
        print("error: `claude` CLI not on PATH. Install Claude Code or pass --dry-run.",
              file=sys.stderr)
        return 2

    # run.py resolves this before handing it to run_one; `cwd_session_dir`
    # slugifies the path verbatim, so a relative --cwd points session discovery at
    # a directory that does not exist and every row fails AFTER spending quota.
    args.cwd = args.cwd.resolve()

    if args.output.exists() and args.output.stat().st_size:
        print(f"refusing to append to a non-empty {args.output} — "
              "these rows must not share a file with another run's arms", file=sys.stderr)
        return 2

    args.cwd.mkdir(parents=True, exist_ok=True)
    prompts = BENCH.load_prompts(args.prompts)
    if not prompts:
        print(f"no prompts in {args.prompts}", file=sys.stderr)
        return 2

    scored = failed = 0
    with BENCH.host_isolation(enabled=not args.no_isolate_host and not args.dry_run,
                              isolate_settings=args.isolate_settings):
        isolation_verified = None
        if not args.dry_run:
            isolation_verified = BENCH.check_register_clean(args.cwd, args.allow_contaminated)
            if isolation_verified is None:
                return 2
        with args.output.open("a", encoding="utf-8") as out:
            for spec in args.arms.split(","):
                arm, rule_text = BENCH.resolve_arm(spec.strip())
                for pid, prompt in enumerate(prompts):
                    for run in range(args.runs):
                        result = BENCH.run_one(
                            arm=arm, rule_text=rule_text, prompt=prompt, prompt_id=pid,
                            run=run, cwd=args.cwd, dry_run=args.dry_run,
                            timeout=args.timeout, model=args.model,
                            isolation_verified=isolation_verified,
                            disallow_tools=not args.allow_tools,
                            system_prompt_mode="replace",
                        )
                        row = asdict(result)
                        # `run_one` fills output_text even on a contaminated row
                        # (it excludes the row by nulling output_tokens instead),
                        # so scoring on output_text alone would resurrect exactly
                        # the rows the backstop threw out.
                        usable = bool(result.output_text) and not result.contaminated and not result.error
                        if usable:
                            row.update(SCORE.score(result.output_text))
                            scored += 1
                        else:
                            failed += 1
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                        out.flush()
                        mark = row["violation_count"] if usable else "EXCLUDED"
                        print(f"  [{arm} p{pid} r{run}] violations={mark}"
                              + (f" {result.error}" if result.error else ""), file=sys.stderr)

    print(f"wrote {args.output}. scored={scored} excluded={failed}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
