#!/usr/bin/env python3
"""fidelity/debunk.py — safety axis: does the register still reject a false premise?

Claim-preservation asks whether a compressed answer kept the reference's claims.
That question is meaningless when the *question* is wrong: on a false-premise
prompt an answer can preserve every claim and still have failed, because the
correct response was to reject the premise. So this scores a different thing,
with its own rubric (`judge.DEBUNK_SYSTEM`), and it judges ONE answer against the
question rather than two answers against each other.

Why it exists: Giskard's Phare benchmark found brevity-emphasising system
instructions cost up to 20% of hallucination resistance — debunking takes words,
and brevity pressure makes a model concede. Scrooge's differentiator is a safety
register. Whether that register holds against a false premise (as opposed to a
destructive command, which the corpus already covers) was never measured; this is
the one blind spot where the differentiator could invert into a liability.

Pipeline — step 1 generates, step 2 judges, same split as the fidelity bench:

  # 1) answers for each arm (subscription quota)
  python3 benchmarks/run.py \\
    --prompts benchmarks/prompts/en-falsepremise.txt \\
    --arms normal,terse,scrooge:en/full \\
    --runs 1 --model claude-opus-4-8 --resume \\
    --output benchmarks/results-en-falsepremise.jsonl

  # 2) judge each answer for premise rejection
  python3 benchmarks/fidelity/debunk.py \\
    --results benchmarks/results-en-falsepremise.jsonl \\
    --prompts benchmarks/prompts/en-falsepremise.txt \\
    --model claude-opus-4-8 --judge-runs 1 \\
    --output benchmarks/fidelity/results-en-debunk.jsonl

The comparison that matters is **scrooge vs normal**. `terse` sits between them to
separate generic brevity pressure from the register itself: if `terse` drops as
much as `scrooge`, the cause is brevity, not this register.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as judge_mod  # sibling module (benchmarks/fidelity/judge.py)


def load_prompts(path: Path) -> list[str]:
    """Non-comment, non-blank lines, in order — the same shape run.py uses, so
    `prompt_id` indexes into this list."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def load_answers(path: Path) -> dict[tuple[str, int, int], str]:
    """(arm, prompt_id, run) → answer text, skipping errored rows."""
    out: dict[tuple[str, int, int], str] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("error") or not r.get("output_text"):
                continue
            out[(r["arm"], r["prompt_id"], r["run"])] = r["output_text"]
    return out


def judge_once(question: str, answer: str, model: Optional[str], runs: int,
               timeout: int) -> tuple[Optional[bool], list, Optional[str]]:
    """Majority verdict over `runs` judge calls. Returns (verdict, per_run, error).

    A tie or all-unparseable leaves the verdict None — never silently `false`,
    which would read as a safety failure the judge did not actually find.
    """
    per_run = []
    err = None
    for _ in range(max(1, runs)):
        text, e = judge_mod.call_debunk_judge(question, answer, model, timeout=timeout)
        if e:
            err = err or e
            continue
        per_run.append(judge_mod.parse_debunk(text))
    decided = [v for v in per_run if isinstance(v, bool)]
    if not decided:
        return None, per_run, err
    trues = sum(1 for v in decided if v)
    falses = len(decided) - trues
    verdict = True if trues > falses else (False if falses > trues else None)
    return verdict, per_run, err


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", required=True, type=Path, help="run.py JSONL with output_text.")
    ap.add_argument("--prompts", required=True, type=Path, help="The false-premise corpus.")
    ap.add_argument("--output", type=Path, help="Write per-row verdicts here (JSONL).")
    ap.add_argument("--model", default=None, help="Pin the judge model.")
    ap.add_argument("--judge-runs", type=int, default=1, help="Judge calls per answer. Default 1.")
    ap.add_argument("--timeout", type=int, default=120)
    args = ap.parse_args()

    prompts = load_prompts(args.prompts)
    answers = load_answers(args.results)
    if not answers:
        print(f"error: no usable rows in {args.results}", file=sys.stderr)
        return 2

    records = []
    out_f = args.output.open("w", encoding="utf-8") if args.output else None
    try:
        for (arm, pid, run) in sorted(answers):
            if pid >= len(prompts):
                continue
            verdict, per_run, err = judge_once(
                prompts[pid], answers[(arm, pid, run)], args.model,
                args.judge_runs, args.timeout)
            rec = {
                "arm": arm, "prompt_id": pid, "run": run,
                "debunked": verdict, "run_verdicts": per_run,
                # `model_requested`, not `model`: this is the flag we passed, not a
                # value read back from the judge's transcript. Naming it `model`
                # would let a provenance table imply the served model was verified
                # when it was only requested.
                "judge_runs": args.judge_runs, "model_requested": args.model,
                "error": err,
            }
            records.append(rec)
            if out_f:
                out_f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                out_f.flush()
            mark = "ok " if verdict else ("MISS" if verdict is False else "?   ")
            print(f"  {mark} {arm} prompt={pid} run={run}", file=sys.stderr)
    finally:
        if out_f:
            out_f.close()

    by_arm: dict[str, list] = defaultdict(list)
    for r in records:
        if isinstance(r["debunked"], bool):
            by_arm[r["arm"]].append(r["debunked"])

    print("\n# False-premise (debunk) report\n")
    print(f"- Corpus: `{args.prompts}` ({len(prompts)} prompts)")
    print(f"- Judge runs per answer: {args.judge_runs}")
    print()
    print("| Arm | Judged | Debunked | Rate |")
    print("| --- | -----: | -------: | ---: |")
    for arm in sorted(by_arm):
        vs = by_arm[arm]
        ok = sum(1 for v in vs if v)
        print(f"| `{arm}` | {len(vs)} | {ok} | {ok / len(vs) * 100:.0f}% |")
    print()
    print("- The comparison that matters is scrooge vs `normal`. `terse` separates "
          "generic brevity pressure from the register.")
    print("- An undecided verdict (tie / unparseable) is excluded, never counted as a miss.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
