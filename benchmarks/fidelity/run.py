#!/usr/bin/env python3
"""fidelity/run.py — offline fidelity bench harness.

Reads a paired output corpus produced by benchmarks/run.py (a baseline `normal`
arm and a compressed `scrooge:LANG/DIAL` arm over the HELD-OUT report corpus),
pairs the two answers per prompt, scores each pair with the equivalence judge
(judge.py) plus the deterministic checks (checks.js), and reports a reproducible
headline:  "X% claim-equivalent at Y% output saved".

Why two steps (generate, then judge): generation already exists and is well
tested — benchmarks/run.py handles subscription-CLI invocation, host isolation,
per-session contamination exclusion, and dedup token counting. This harness does
not re-implement any of that; it consumes run.py's JSONL and adds only the
fidelity layer. Train/test separation still applies: judge the REPORT corpus
(prompts/{ko,en}-report.txt), never the dev corpus the rules were tuned on.

Honesty: offline only (never a runtime per-reply receipt), subscription CLI (no
paid API key — judge calls consume subscription usage, not metered cash), and the
judge runs inside benchmarks/run.py's host_isolation so the host scrooge/caveman
register hooks do not bias the impartial judge. --model defaults to the shared
latest-Opus pin (benchmarks/run.py LATEST_OPUS) so a new headline is reproducible
without remembering a flag; pass it explicitly only to reproduce an older one.

Step 1 (generate paired outputs — uses subscription usage):
  python3 benchmarks/run.py \
    --prompts benchmarks/prompts/ko-report.txt \
    --arms normal,scrooge:ko/full \
    --resume \
    --output benchmarks/results-ko-report.jsonl

Step 2 (judge fidelity — uses subscription usage):
  python3 benchmarks/fidelity/run.py \
    --results benchmarks/results-ko-report.jsonl \
    --candidate-arm scrooge:ko/full \
    --resume \
    --output benchmarks/fidelity/results-ko-fidelity.jsonl
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import sys
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent
BENCH_DIR = HERE.parent

import judge as judge_mod  # sibling module (benchmarks/fidelity/judge.py)

def _latest_opus() -> str:
    """Single source for the model pin: benchmarks/run.py LATEST_OPUS.

    Loaded by path rather than re-declared, so generation and judging can never
    drift onto different models — the duplication itself would be the bug.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("_bench_run_pin", BENCH_DIR / "run.py")
    mod = importlib.util.module_from_spec(spec)
    import sys as _sys
    _sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.LATEST_OPUS


LATEST_OPUS = _latest_opus()



def _load_bench_run():
    """Load benchmarks/run.py by path (avoids the name clash with this run.py) to
    reuse its tested host_isolation + register pre-flight for clean judge calls."""
    spec = importlib.util.spec_from_file_location("bench_run", BENCH_DIR / "run.py")
    mod = importlib.util.module_from_spec(spec)
    # Register before exec: run.py's @dataclass with `from __future__ import
    # annotations` resolves field types via sys.modules[cls.__module__]; without
    # this the import raises AttributeError on a None module.
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def load_rows(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def pair_rows(rows: list[dict], baseline_arm: str, candidate_arm: str) -> list[dict]:
    """Pair baseline vs candidate by (prompt_id, run). Only pairs where BOTH arms
    have usable text and a token count are returned — an errored/contaminated row
    (output_tokens null) drops its pair, mirroring report.py --paired."""
    by_key: dict[tuple[int, int], dict] = {}
    for r in rows:
        arm = r.get("arm")
        pid = r.get("prompt_id")
        run = r.get("run")
        if arm not in (baseline_arm, candidate_arm):
            continue
        if not isinstance(pid, int) or not isinstance(run, int):
            continue
        by_key.setdefault((pid, run), {})[arm] = r

    pairs = []
    for (pid, run), arms in sorted(by_key.items()):
        b = arms.get(baseline_arm)
        c = arms.get(candidate_arm)
        if not b or not c:
            continue
        if not b.get("output_text") or not c.get("output_text"):
            continue
        if not isinstance(b.get("output_tokens"), int) or not isinstance(c.get("output_tokens"), int):
            continue
        pairs.append({"prompt_id": pid, "run": run, "baseline": b, "candidate": c})
    return pairs


def load_done_keys(path: Path) -> set[tuple[int, int]]:
    if not path.exists():
        return set()
    done = set()
    for r in load_rows(path):
        pid, run = r.get("prompt_id"), r.get("run")
        if isinstance(pid, int) and isinstance(run, int) and not r.get("error"):
            done.add((pid, run))
    return done


def saved_pct(baseline_tokens: int, candidate_tokens: int) -> Optional[float]:
    if not baseline_tokens:
        return None
    return (baseline_tokens - candidate_tokens) / baseline_tokens * 100.0


def aggregate(records: list[dict], model: Optional[str], candidate_arm: str) -> str:
    # Dedup to the latest non-error record per (prompt_id, run): a --resume re-judge
    # appends a fresh line, and an errored attempt must not inflate the denominator
    # or double-count its saved_pct in the median. File order = append order, so a
    # later success overwrites; error rows are excluded from the clean set entirely.
    latest: dict[tuple, dict] = {}
    error_keys: set = set()
    for r in records:
        key = (r.get("prompt_id"), r.get("run"))
        if r.get("error"):
            error_keys.add(key)
        else:
            latest[key] = r  # latest success per key — a later error never discards it
    clean = list(latest.values())
    # Count only pairs that NEVER produced a success, so the error tally is distinct
    # pairs (not retry attempts) and N + errors stays arithmetically consistent.
    errors = len([k for k in error_keys if k not in latest])

    n = len(clean)
    judged = [r for r in clean if r.get("equivalent") is not None]
    holds = [r for r in clean if r.get("equivalent") is None]  # HOLD / unjudged
    equivalent = [r for r in judged if r["equivalent"]]
    byte_ok = [r for r in clean if r.get("byte_exact_pass")]
    safety_ok = [r for r in clean if r.get("safety_pass")]
    strict_ok = [r for r in clean if r.get("strict_pass")]
    saved = [r["saved_pct"] for r in clean if r.get("saved_pct") is not None]

    def pct(num, den):
        return f"{(100.0 * num / den):.1f}%" if den else "—"

    eq_rate = pct(len(equivalent), len(judged))
    med_saved = f"{statistics.median(saved):+.1f}%" if saved else "—"
    judged_ratio = f"{len(judged)}/{n}"
    scores = [r["score"] for r in judged if r.get("score") is not None]
    med_score = f"{statistics.median(scores):.2f}" if scores else "—"

    lines = [
        "",
        "=" * 60,
        f"FIDELITY — {candidate_arm} vs baseline" + (f" (model={model})" if model else ""),
        "=" * 60,
        f"Pairs scored:          {n}  (judged {judged_ratio}, {len(holds)} hold, {errors} error)",
        f"Claim-preservation:    {med_score} median score  (fraction of baseline claims kept)",
        f"Claim-equivalent:      {eq_rate}  ({len(equivalent)}/{len(judged)} all-claims-kept)",
        f"Median output saved:   {med_saved}",
        "",
        "Informational signals (noisy on independent generations — not the gate):",
        f"  No code corruption:  {pct(len(byte_ok), n)}  ({len(byte_ok)}/{n})",
        f"  Safety preserved:    {pct(len(safety_ok), n)}  ({len(safety_ok)}/{n})",
        f"  Strict (all axes):   {pct(len(strict_ok), n)}  ({len(strict_ok)}/{n})  [edit-surface gate]",
        "",
        f"HEADLINE: {med_score} median claim-preservation ({eq_rate} fully equivalent) "
        f"at {med_saved} output saved (N={n}, judged={judged_ratio}).",
        "Offline bench, subscription CLI, no paid API. Estimate, not a contract.",
    ]
    if n and len(judged) < n * 0.8:
        lines.append(
            f"⚠ only {judged_ratio} pairs were judged (rest HOLD/error) — "
            "the equivalence rate is over a partial set; raise --judge-runs or re-run."
        )
    lines.append("=" * 60)
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--results", required=True, type=Path,
                    help="JSONL from benchmarks/run.py with the baseline + candidate arms.")
    ap.add_argument("--candidate-arm", required=True,
                    help="Compressed arm label, e.g. scrooge:ko/full.")
    ap.add_argument("--baseline-arm", default="normal", help="Baseline arm. Default normal.")
    ap.add_argument("--output", required=True, type=Path, help="Fidelity JSONL output (appended).")
    ap.add_argument("--model", default=LATEST_OPUS,
                    help=f"Judge model. Default {LATEST_OPUS} — same latest-Opus pin as "
                         "benchmarks/run.py, so generation and judging never silently diverge.")
    ap.add_argument("--timeout", type=int, default=120, help="Per-judge-call timeout s. Default 120.")
    ap.add_argument("--max-pairs", type=int, default=0, help="Only judge the first N pairs. 0 = all.")
    ap.add_argument("--resume", action="store_true",
                    help="Skip (prompt_id, run) pairs already in --output.")
    ap.add_argument("--judge-runs", type=int, default=1,
                    help="Judge each pair N times and take the majority verdict / median "
                         "score (manages judge noise). Default 1. N>1 multiplies usage.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Skip the claude judge calls (no usage); deterministic checks only.")
    ap.add_argument("--no-isolate-host", action="store_true",
                    help="Do not move register state files aside for the judge calls.")
    ap.add_argument("--allow-contaminated", action="store_true",
                    help="Proceed even if the pre-flight finds an active register hook channel. "
                         "Off by default: a biased judge must not silently score the headline.")
    args = ap.parse_args()

    if not args.results.exists():
        print(f"error: results file not found: {args.results}", file=sys.stderr)
        return 2

    rows = load_rows(args.results)
    pairs = pair_rows(rows, args.baseline_arm, args.candidate_arm)
    if not pairs:
        print(f"error: no usable {args.baseline_arm}/{args.candidate_arm} pairs in {args.results}",
              file=sys.stderr)
        return 2

    if args.resume:
        done = load_done_keys(args.output)
        before = len(pairs)
        pairs = [p for p in pairs if (p["prompt_id"], p["run"]) not in done]
        print(f"resume: {len(done)} done; skipping {before - len(pairs)}; remaining {len(pairs)}",
              file=sys.stderr)
    if args.max_pairs > 0:
        pairs = pairs[: args.max_pairs]

    if not args.dry_run:
        print(f"[note] {len(pairs)} judge call(s) via subscription `claude` CLI "
              f"(consumes subscription usage, not metered cash). Foreground; "
              f"re-run with --resume after a rate-limit pause.", file=sys.stderr)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []

    def run_loop():
        with args.output.open("a", encoding="utf-8") as out:
            for i, p in enumerate(pairs, 1):
                b, c = p["baseline"], p["candidate"]
                try:
                    scored = judge_mod.judge_pair(
                        b["output_text"], c["output_text"], args.model,
                        timeout=args.timeout, dry_run=args.dry_run, runs=args.judge_runs,
                    )
                    err = scored.get("judge_error")
                except Exception as e:  # node/checks.js failure — record, don't crash
                    scored, err = None, f"score error: {e}"

                rec = {
                    "prompt_id": p["prompt_id"],
                    "run": p["run"],
                    "baseline_arm": args.baseline_arm,
                    "candidate_arm": args.candidate_arm,
                    "baseline_tokens": b.get("output_tokens"),
                    "candidate_tokens": c.get("output_tokens"),
                    "saved_pct": saved_pct(b.get("output_tokens", 0), c.get("output_tokens", 0)),
                    "model": args.model,
                    "error": err,
                }
                if scored is not None:
                    rec["equivalent"] = scored.get("equivalent")
                    rec["score"] = (scored.get("verdict") or {}).get("score")
                    rec["byte_exact_pass"] = scored.get("byteExact", {}).get("pass")
                    rec["safety_pass"] = scored.get("safety", {}).get("pass")
                    rec["strict_pass"] = scored.get("strictPass")
                    rec["judge_runs"] = scored.get("judge_runs")
                    # Per-run verdicts, so judge self-agreement stays recomputable
                    # from the file rather than being lost with the majority vote.
                    rec["run_scores"] = scored.get("run_scores", [])
                    rec["run_equivalents"] = scored.get("run_equivalents", [])
                    rec["missing_claims"] = (scored.get("verdict") or {}).get("missingClaims", [])
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                out.flush()
                records.append(rec)
                tok = f"{rec['saved_pct']:+.0f}%" if rec["saved_pct"] is not None else "—"
                verd = rec.get("equivalent")
                vtag = "EQ" if verd else ("DIV" if verd is False else "—")
                e = f"  ERR: {err}" if err else ""
                print(f"  [{i}/{len(pairs)}] p={rec['prompt_id']} run={rec['run']} "
                      f"saved={tok} {vtag}{e}", file=sys.stderr)

    if args.dry_run or args.no_isolate_host:
        run_loop()
    else:
        bench_run = _load_bench_run()
        with bench_run.host_isolation(enabled=True):
            findings = bench_run.verify_register_clean(BENCH_DIR)
            for sev, m in findings:
                print(f"[verify] {sev}: {m}", file=sys.stderr)
            blocking = [m for sev, m in findings if sev == "blocking"]
            if blocking and not args.allow_contaminated:
                # Match benchmarks/run.py: an active register hook would inject a
                # compression directive into the judge's user channel and bias the
                # impartial verdict. Abort rather than score a contaminated headline.
                print("error: register not clean — the judge would be biased by a host "
                      "hook. Isolation should have moved the state files aside; a "
                      "remaining channel means the move failed or you isolate manually. "
                      "Re-run, or pass --allow-contaminated to override.", file=sys.stderr)
                return 2
            run_loop()

    # Re-read full output so the aggregate covers resumed prior records too.
    all_records = [r for r in load_rows(args.output)
                   if r.get("candidate_arm") == args.candidate_arm]
    print(aggregate(all_records, args.model, args.candidate_arm))
    return 0


if __name__ == "__main__":
    sys.exit(main())
