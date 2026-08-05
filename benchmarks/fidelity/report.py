#!/usr/bin/env python3
"""fidelity/report.py — paired statistics over fidelity JSONL.

Two published fidelity files scored on the same corpus are two measurements of the
SAME prompts, so comparing their medians separately throws away the pairing. This
prints the paired statistic instead: the per-prompt score difference, its bootstrap
CI, and the win/tie/loss split.

That distinction is not cosmetic. Comparing medians of medians said scrooge beat
caveman by +0.08 in KO and +0.03 in EN; paired, KO is +0.01 with a CI that touches
zero while EN is the larger and cleaner of the two. The unpaired reading had the
languages backwards.

Single file:
  python3 benchmarks/fidelity/report.py --input benchmarks/published/results-ko-fidelity.jsonl

Head-to-head:
  python3 benchmarks/fidelity/report.py \
    --a benchmarks/published/results-en-fidelity.jsonl \
    --b benchmarks/published/results-en-caveman-fidelity.jsonl
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BENCH_DIR = HERE.parent


def _load_bench_report():
    """Load benchmarks/report.py by path — same trick fidelity/run.py uses for
    benchmarks/run.py, because this file shares its basename."""
    spec = importlib.util.spec_from_file_location("_bench_report", BENCH_DIR / "report.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_bench = _load_bench_report()
bootstrap_ci = _bench.bootstrap_ci
sign_test = _bench.sign_test


def load(path: Path, min_judge_runs: int) -> dict[tuple[int, int], dict]:
    """Rows keyed by (prompt_id, run), keeping only fully-judged, error-free ones.

    The judge-run floor is the same one published/README.md documents as mandatory:
    a single-run verdict is one sample of a stochastic judge, not a measurement.
    """
    rows: dict[tuple[int, int], dict] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("error") or r.get("score") is None:
                continue
            if (r.get("judge_runs") or 0) < min_judge_runs:
                continue
            pid, run = r.get("prompt_id"), r.get("run")
            if isinstance(pid, int) and isinstance(run, int):
                rows[(pid, run)] = r
    return rows


def judge_agreement(rows: dict) -> dict | None:
    """How often the judge's repeated runs agree with each other on one pair.

    Reported as the unanimity rate plus Fleiss' kappa over the binary
    equivalent/divergent call. Requires `run_equivalents`, which only rows judged
    by v0.23.0+ carry — older published files were aggregated to a majority and
    the per-run verdicts are unrecoverable.
    """
    items = []
    for r in rows.values():
        runs = [e for e in (r.get("run_equivalents") or []) if e is not None]
        if len(runs) >= 2:
            items.append(runs)
    if not items:
        return None

    n = min(len(i) for i in items)
    items = [i[:n] for i in items]
    unanimous = sum(1 for i in items if len(set(i)) == 1)

    # Fleiss' kappa, two categories, fixed raters per item.
    p_bar = 0.0
    cat_totals = [0, 0]
    for i in items:
        counts = [sum(1 for e in i if e), sum(1 for e in i if not e)]
        cat_totals[0] += counts[0]
        cat_totals[1] += counts[1]
        p_bar += (sum(c * c for c in counts) - n) / (n * (n - 1))
    p_bar /= len(items)
    p_e = sum((c / (len(items) * n)) ** 2 for c in cat_totals)
    kappa = (p_bar - p_e) / (1 - p_e) if p_e < 1 else None

    return {"items": len(items), "runs": n, "unanimous": unanimous,
            "rate": unanimous / len(items) * 100.0, "kappa": kappa}


def describe(name: str, rows: dict, n_resamples: int, seed: int) -> None:
    scores = [r["score"] for r in rows.values()]
    if not scores:
        print(f"- `{name}`: no fully-judged rows")
        return
    lo, hi = bootstrap_ci([[s] for s in scores], n_resamples, seed)
    safety = [r for r in rows.values() if r.get("safety_pass") is not None]
    safe_ok = sum(1 for r in safety if r["safety_pass"])
    equiv = sum(1 for r in rows.values() if r.get("equivalent"))
    ci = "—" if lo is None else f"{lo:.2f}–{hi:.2f}"
    print(f"| `{name}` | {len(scores)} | {statistics.median(scores):.2f} | {ci} | "
          f"{equiv}/{len(scores)} | {safe_ok}/{len(safety)} |")


def compare(a_rows: dict, b_rows: dict, a_name: str, b_name: str,
            n_resamples: int, seed: int) -> None:
    common = sorted(set(a_rows) & set(b_rows))
    if not common:
        print("No shared prompt/run keys — the two files do not cover the same corpus.")
        return
    deltas = [a_rows[k]["score"] - b_rows[k]["score"] for k in common]
    wins = sum(1 for d in deltas if d > 0)
    ties = sum(1 for d in deltas if d == 0)
    losses = sum(1 for d in deltas if d < 0)
    lo, hi = bootstrap_ci([[d] for d in deltas], n_resamples, seed)
    p = sign_test(wins, losses)

    print("## Paired comparison")
    print()
    print(f"- A: `{a_name}`")
    print(f"- B: `{b_name}`")
    print(f"- Shared fully-judged keys: {len(common)}")
    print(f"- Paired median score difference (A − B): **{statistics.median(deltas):+.2f}**")
    print(f"- 95% CI: {'—' if lo is None else f'{lo:+.2f} to {hi:+.2f}'}")
    print(f"- A better / tie / worse: {wins}/{ties}/{losses}")
    print(f"- Sign test p: {'—' if p is None else f'{p:.3g}'}")
    print()
    if lo is not None and lo <= 0 <= hi:
        print("The interval includes zero: on this corpus the two are not "
              "distinguishable, whatever the separate medians suggest.")
        print()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, action="append", default=[],
                    help="Fidelity JSONL to summarise. Repeatable.")
    ap.add_argument("--a", type=Path, help="Left file of a paired comparison.")
    ap.add_argument("--b", type=Path, help="Right file of a paired comparison.")
    ap.add_argument("--min-judge-runs", type=int, default=3,
                    help="Drop rows judged fewer times than this. Default 3.")
    ap.add_argument("--bootstrap", type=int, default=10000, help="Resamples. Default 10000.")
    ap.add_argument("--seed", type=int, default=0, help="Bootstrap seed. Default 0.")
    args = ap.parse_args()

    if not args.input and not (args.a and args.b):
        print("error: pass --input FILE, or both --a and --b", file=sys.stderr)
        return 2

    print("# Fidelity report")
    print()
    print(f"- Rows require `judge_runs >= {args.min_judge_runs}`")
    print(f"- CI: percentile bootstrap, {args.bootstrap} resamples, seed {args.seed}")
    print()

    files = list(args.input)
    if args.a and args.b:
        files = [f for f in [args.a, args.b] if f not in files] + files

    if files:
        print("## Per-file")
        print()
        print("| File | N | Median score | 95% CI | Fully equivalent | Safety preserved |")
        print("| ---- | -:| -----------: | -----: | ---------------: | ---------------: |")
        loaded = {path: load(path, args.min_judge_runs) for path in files}
        for path in files:
            describe(path.name, loaded[path], args.bootstrap, args.seed)
        print()

        agreements = {p: judge_agreement(r) for p, r in loaded.items()}
        if any(agreements.values()):
            print("## Judge self-agreement")
            print()
            print("| File | Pairs | Runs | Unanimous | Fleiss kappa |")
            print("| ---- | ----: | ---: | --------: | -----------: |")
            for path in files:
                a = agreements[path]
                if not a:
                    continue
                k = "—" if a["kappa"] is None else f"{a['kappa']:.2f}"
                print(f"| `{path.name}` | {a['items']} | {a['runs']} | "
                      f"{a['unanimous']}/{a['items']} ({a['rate']:.0f}%) | {k} |")
            print()
            print("- Repeated judge runs on the same pair, before the majority vote "
                  "collapses them. A fidelity score is only as trustworthy as this row.")
            print()
        else:
            print("- Judge self-agreement: unavailable — no file carries per-run "
                  "verdicts (`run_equivalents`). Rows judged before v0.23.0 kept only "
                  "the majority, so their agreement cannot be recomputed.")
            print()

    if args.a and args.b:
        compare(load(args.a, args.min_judge_runs), load(args.b, args.min_judge_runs),
                args.a.name, args.b.name, args.bootstrap, args.seed)

    return 0


if __name__ == "__main__":
    sys.exit(main())
