#!/usr/bin/env python3
"""Scrooge benchmark report — aggregate run.py output and compute savings %.

Reads the JSONL emitted by `benchmarks/run.py` and prints a markdown summary:
per-arm distribution stats (median / mean / min / max / stdev) plus the
savings ratio against a baseline arm.

Only median is used for the savings headline (mean is reported alongside but
distorts under outliers). Information equivalence between arms is the
benchmark caller's responsibility — see benchmarks/README.md.

Paired statistics (bootstrap CI, sign test, MDE) are computed with the stdlib
only. When a file holds several runs per prompt the bootstrap resamples whole
prompts, not prompt/run pairs: repeated runs of one prompt are correlated, so
treating them as independent draws would understate the interval.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

# α = .05 two-sided, power = .80 → z_{.975} + z_{.80}.
MDE_Z_SUM = 2.802
METRIC_FIELDS = {
    "prose": "output_tokens",
    "total": "total_output_tokens",
    "tool": "tool_use_output_tokens",
}


def bootstrap_ci(clusters: list[list[float]], n_resamples: int, seed: int,
                 alpha: float = 0.05) -> tuple[float | None, float | None]:
    """Percentile bootstrap CI for the median of pooled cluster values.

    Each cluster is resampled as a unit, so passing single-element clusters
    gives a plain paired bootstrap and passing per-prompt groups gives a
    cluster bootstrap.
    """
    clusters = [c for c in clusters if c]
    if len(clusters) < 2:
        return (None, None)
    rng = random.Random(seed)
    k = len(clusters)
    stats: list[float] = []
    for _ in range(n_resamples):
        drawn: list[float] = []
        for _ in range(k):
            drawn.extend(clusters[rng.randrange(k)])
        stats.append(statistics.median(drawn))
    stats.sort()
    lo = stats[int(alpha / 2 * len(stats))]
    hi = stats[min(len(stats) - 1, int((1 - alpha / 2) * len(stats)))]
    return (lo, hi)


def sign_test(wins: int, losses: int) -> float | None:
    """Exact two-sided binomial sign test. Ties are discarded, per convention."""
    n = wins + losses
    if n == 0:
        return None
    k = min(wins, losses)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / (2 ** n)
    return min(1.0, 2 * tail)


def mde(values: list[float]) -> float | None:
    """Smallest paired effect this sample size can resolve at α=.05, power=.80."""
    if len(values) < 2:
        return None
    return MDE_Z_SUM * statistics.stdev(values) / math.sqrt(len(values))


def noise_floor(cells: list[list[float]]) -> dict | None:
    """Within-cell coefficient of variation across repeated runs of one arm.

    An effect smaller than the same-arm run-to-run spread is not a finding.
    """
    cvs = []
    for values in cells:
        if len(values) < 2:
            continue
        mean = statistics.mean(values)
        if mean:
            cvs.append(statistics.stdev(values) / mean * 100.0)
    if not cvs:
        return None
    cvs.sort()
    return {
        "cells": len(cvs),
        "median": statistics.median(cvs),
        "p90": cvs[min(len(cvs) - 1, int(0.9 * len(cvs)))],
        "max": cvs[-1],
    }


def load_results(path: Path) -> list[dict]:
    out: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            out.append(obj)
    return out


def stats_for(values: list[int]) -> dict:
    if not values:
        return {"n": 0, "median": None, "mean": None, "min": None, "max": None, "stdev": None}
    return {
        "n": len(values),
        "median": statistics.median(values),
        "mean": statistics.mean(values),
        "min": min(values),
        "max": max(values),
        "stdev": statistics.stdev(values) if len(values) > 1 else 0.0,
    }


def fmt(v):
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.1f}"
    return str(v)


def choose_compare_arms(arms: list[str], requested: str) -> tuple[str, str] | None:
    if requested:
        parts = [p.strip() for p in requested.split(",") if p.strip()]
        if len(parts) != 2:
            raise ValueError("--compare must be 'arm_a,arm_b'")
        return parts[0], parts[1]

    scrooge = next((a for a in arms if a.startswith("scrooge:")), None)
    caveman = next((a for a in arms if a == "caveman:full"), None)
    if scrooge and caveman:
        return scrooge, caveman
    return None


def print_direct_comparison(by_key: dict[str, dict[tuple[int, int], int]],
                            arm_a: str, arm_b: str,
                            keys: set[tuple[int, int]] | None = None) -> None:
    if arm_a not in by_key or arm_b not in by_key:
        return
    common = set(by_key[arm_a]) & set(by_key[arm_b])
    if keys is not None:
        common &= keys
    common = set(sorted(common))

    print("## Direct arm comparison")
    print()
    print(f"- A: `{arm_a}`")
    print(f"- B: `{arm_b}`")
    print(f"- Shared prompt/run keys: {len(common)}")
    if not common:
        print()
        return

    a_values = [by_key[arm_a][key] for key in sorted(common)]
    b_values = [by_key[arm_b][key] for key in sorted(common)]
    a_median = statistics.median(a_values)
    b_median = statistics.median(b_values)
    saved = (b_median - a_median) / b_median * 100.0 if b_median else 0.0
    wins = sum(1 for a, b in zip(a_values, b_values) if a < b)
    ties = sum(1 for a, b in zip(a_values, b_values) if a == b)
    losses = sum(1 for a, b in zip(a_values, b_values) if a > b)

    print(f"- Median `{arm_a}`: {fmt(a_median)}")
    print(f"- Median `{arm_b}`: {fmt(b_median)}")
    print(f"- `{arm_a}` savings vs `{arm_b}`: {saved:+.1f}%")
    print(f"- Prompt wins/ties/losses for `{arm_a}`: {wins}/{ties}/{losses}")
    print()


def print_control_comparison(by_key: dict[str, dict[tuple[int, int], int]],
                             arms: list[str], control: str,
                             keys: set[tuple[int, int]] | None = None) -> None:
    if control not in by_key:
        return
    candidates = [
        arm for arm in arms
        if arm not in {"normal", control} and arm in by_key
    ]
    if not candidates:
        return

    print(f"## Control comparison vs `{control}`")
    print()
    print("| Arm | Shared keys | Median | Savings vs control | Wins/ties/losses |")
    print("| --- | ----------: | -----: | -----------------: | ---------------: |")
    for arm in candidates:
        common = set(by_key[arm]) & set(by_key[control])
        if keys is not None:
            common &= keys
        common = set(sorted(common))
        if not common:
            print(f"| `{arm}` | 0 | — | — | — |")
            continue
        arm_values = [by_key[arm][key] for key in sorted(common)]
        control_values = [by_key[control][key] for key in sorted(common)]
        arm_median = statistics.median(arm_values)
        control_median = statistics.median(control_values)
        saved = ((control_median - arm_median) / control_median * 100.0
                 if control_median else 0.0)
        wins = sum(1 for arm_v, control_v in zip(arm_values, control_values) if arm_v < control_v)
        ties = sum(1 for arm_v, control_v in zip(arm_values, control_values) if arm_v == control_v)
        losses = sum(1 for arm_v, control_v in zip(arm_values, control_values) if arm_v > control_v)
        print(f"| `{arm}` | {len(common)} | {fmt(arm_median)} | {saved:+.1f}% | {wins}/{ties}/{losses} |")
    print()


def print_paired_stats(by_key: dict[str, dict[tuple[int, int], int]],
                       arms: list[str], baseline: str,
                       keys: set[tuple[int, int]] | None,
                       n_resamples: int, cluster_by: str, seed: int) -> None:
    """Per-prompt savings deltas against the baseline, with an interval."""
    if baseline not in by_key or n_resamples <= 0:
        return
    candidates = [arm for arm in arms if arm != baseline and arm in by_key]
    if not candidates:
        return

    print("## Paired statistics vs baseline")
    print()
    print("| Arm | N | Median savings | 95% CI | Smaller on | Sign test p | MDE |")
    print("| --- | -:| -------------: | -----: | ---------: | ----------: | --: |")
    for arm in candidates:
        common = set(by_key[arm]) & set(by_key[baseline])
        if keys is not None:
            common &= keys
        grouped: dict[object, list[float]] = defaultdict(list)
        deltas: list[float] = []
        for key in sorted(common):
            base = by_key[baseline][key]
            if not base:
                continue
            delta = (base - by_key[arm][key]) / base * 100.0
            deltas.append(delta)
            grouped[key[0] if cluster_by == "prompt" else key].append(delta)
        if not deltas:
            print(f"| `{arm}` | 0 | — | — | — | — | — |")
            continue
        lo, hi = bootstrap_ci(list(grouped.values()), n_resamples, seed)
        wins = sum(1 for d in deltas if d > 0)
        losses = sum(1 for d in deltas if d < 0)
        p = sign_test(wins, losses)
        m = mde(deltas)
        unit = "clusters" if cluster_by == "prompt" else "pairs"
        n_label = f"{len(deltas)}" if cluster_by != "prompt" else f"{len(deltas)} / {len(grouped)}c"
        ci = "—" if lo is None else f"{lo:+.1f}–{hi:+.1f}%"
        print(f"| `{arm}` | {n_label} | {statistics.median(deltas):+.1f}% | {ci} | "
              f"{wins}/{len(deltas)} | {'—' if p is None else f'{p:.2g}'} | "
              f"{'—' if m is None else f'{m:.1f}pp'} |")
    print()
    print(f"- CI: percentile bootstrap, {n_resamples} resamples, seed {seed}, "
          f"resampling unit `{cluster_by}`"
          f"{' (`c` = prompt clusters)' if cluster_by == 'prompt' else ''}.")
    print("- MDE: smallest paired effect this N resolves at α=.05, power=.80. "
          "A point estimate below its own MDE is not a finding.")
    print()


def print_noise_floor(by_key: dict[str, dict[tuple[int, int], int]],
                      arms: list[str]) -> None:
    """Same-arm, same-prompt run-to-run spread — the floor an effect must clear."""
    rows = []
    for arm in arms:
        per_prompt: dict[int, list[float]] = defaultdict(list)
        for (pid, _run), tok in by_key[arm].items():
            per_prompt[pid].append(tok)
        nf = noise_floor(list(per_prompt.values()))
        if nf:
            rows.append((arm, nf))
    if not rows:
        return

    print("## Noise floor (within-cell, same arm)")
    print()
    print("| Arm | Cells | Median CV | p90 CV | Max CV |")
    print("| --- | ----: | --------: | -----: | -----: |")
    for arm, nf in rows:
        print(f"| `{arm}` | {nf['cells']} | {nf['median']:.1f}% | "
              f"{nf['p90']:.1f}% | {nf['max']:.1f}% |")
    print()
    print("- Repeated runs of one prompt under one arm vary this much with nothing changed. "
          "A between-arm effect of comparable size is noise, not a result.")
    print()


def compact_text(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def print_text_samples(results: list[dict], arms: list[str],
                       keys: set[tuple[int, int]], limit: int) -> None:
    if limit <= 0 or not keys:
        return
    rows: dict[tuple[str, int, int], dict] = {}
    for r in results:
        if r.get("error"):
            continue
        key = (r["arm"], r["prompt_id"], r["run"])
        rows[key] = r

    print("## Paired output samples")
    print()
    for prompt_id, run in sorted(keys):
        print(f"### prompt={prompt_id} run={run}")
        print()
        for arm in arms:
            r = rows.get((arm, prompt_id, run))
            if not r:
                continue
            tok = r.get("output_tokens", "—")
            chars = r.get("output_chars", "—")
            text = compact_text(r.get("output_text") or "", limit)
            print(f"- `{arm}` tokens={tok} chars={chars}: {text}")
        print()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path, help="JSONL results file from run.py.")
    ap.add_argument("--baseline", default="normal", help='Baseline arm name for savings %. Default "normal".')
    ap.add_argument("--paired", action="store_true",
                    help="Only score prompt/run pairs that succeeded for every arm in the input.")
    ap.add_argument("--compare", default="",
                    help="Optional direct comparison pair 'arm_a,arm_b'. "
                         "Defaults to scrooge:* vs caveman:full when both exist.")
    ap.add_argument("--show-text", type=int, default=0,
                    help="Print paired output text samples truncated to N characters per arm.")
    ap.add_argument("--metric", choices=sorted(METRIC_FIELDS), default="prose",
                    help='Token field to score. "prose" (default) is the register\'s '
                         'target; "total" is the billed basis; "tool" isolates tool payload.')
    ap.add_argument("--drop-tool-rows", action="store_true",
                    help="Exclude rows that used tools (tool_use_output_tokens > 0 or turns > 1). "
                         "A prose-only comparison against a row that answered via tools is not "
                         "like-for-like. No effect when --metric is total or tool.")
    ap.add_argument("--exclude-prompts", default="",
                    help="Comma-separated prompt_ids to drop, e.g. '15'.")
    ap.add_argument("--bootstrap", type=int, default=10000,
                    help="Bootstrap resamples for the paired CI. 0 disables. Default 10000.")
    ap.add_argument("--cluster-by", choices=["prompt", "pair"], default="",
                    help="Bootstrap resampling unit. Defaults to 'prompt' when the input has "
                         "several runs per prompt, else 'pair'.")
    ap.add_argument("--seed", type=int, default=0, help="Bootstrap seed. Default 0.")
    args = ap.parse_args()

    results = load_results(args.input)
    if not results:
        print(f"error: no results in {args.input}", file=sys.stderr)
        return 2

    metric_field = METRIC_FIELDS[args.metric]
    try:
        excluded_prompts = {int(p) for p in args.exclude_prompts.split(",") if p.strip()}
    except ValueError:
        print("error: --exclude-prompts takes comma-separated integers", file=sys.stderr)
        return 2

    # A tool-using row is dropped for every arm at that prompt/run, not just the
    # arm that used tools: dropping it on one side only would leave the paired
    # comparison scoring an inline answer against a missing counterpart.
    tool_keys: set[tuple[int, int]] = set()
    if args.metric == "prose":
        for r in results:
            if (r.get("tool_use_output_tokens") or 0) > 0 or (r.get("turns") or 1) > 1:
                pid, run = r.get("prompt_id"), r.get("run")
                if isinstance(pid, int) and isinstance(run, int):
                    tool_keys.add((pid, run))

    all_arms: list[str] = []
    by_arm: dict[str, list[int]] = defaultdict(list)
    by_key: dict[str, dict[tuple[int, int], int]] = defaultdict(dict)
    error_keys: dict[str, set[tuple[int, int] | tuple[str, int]]] = defaultdict(set)
    providers: set[str] = set()
    dropped_tool = 0
    dropped_excluded = 0
    for r in results:
        arm = r["arm"]
        if arm not in all_arms:
            all_arms.append(arm)
        provider = r.get("provider")
        if isinstance(provider, str) and provider:
            providers.add(provider)
        if r.get("prompt_id") in excluded_prompts:
            dropped_excluded += 1
            continue
        if args.drop_tool_rows and (r.get("prompt_id"), r.get("run")) in tool_keys:
            dropped_tool += 1
            continue
        if r.get("error"):
            pid = r.get("prompt_id")
            run = r.get("run")
            if isinstance(pid, int) and isinstance(run, int):
                error_keys[arm].add((pid, run))
            else:
                error_keys[arm].add(("unknown", len(error_keys[arm])))
            continue
        tok = r.get(metric_field)
        if isinstance(tok, int):
            key = (r["prompt_id"], r["run"])
            by_arm[arm].append(tok)
            by_key[arm][key] = tok

    if len(providers) > 1:
        print(f"warning: input mixes results from multiple providers "
              f"({sorted(providers)}). `output_tokens` is not comparable "
              f"across providers — Claude rows are raw assistant tokens, "
              f"Codex rows subtract reasoning tokens. Split by provider "
              f"before reporting headline numbers.", file=sys.stderr)

    paired_keys: set[tuple[int, int]] = set()
    if args.paired:
        success_key_sets = [set(by_key[arm]) for arm in all_arms]
        paired_keys = set.intersection(*success_key_sets) if success_key_sets else set()
        by_arm = defaultdict(list)
        for arm in all_arms:
            by_arm[arm] = [by_key[arm][key] for key in sorted(paired_keys)]

    arms = all_arms
    baseline_stats = stats_for(by_arm.get(args.baseline, []))
    baseline_median = baseline_stats["median"]

    runs_per_prompt = defaultdict(set)
    for arm in all_arms:
        for pid, run in by_key[arm]:
            runs_per_prompt[pid].add(run)
    repeated_runs = any(len(runs) > 1 for runs in runs_per_prompt.values())
    cluster_by = args.cluster_by or ("prompt" if repeated_runs else "pair")

    print(f"# Scrooge benchmark report")
    print()
    print(f"- Source: `{args.input}`")
    print(f"- Baseline: `{args.baseline}`")
    print(f"- Arms: {', '.join(arms)}")
    print(f"- Metric: `{args.metric}` (`{metric_field}`)")
    if args.paired:
        print(f"- Paired prompt/run keys: {len(paired_keys)}")
    if repeated_runs:
        print(f"- Structure: {len(runs_per_prompt)} prompts x up to "
              f"{max(len(r) for r in runs_per_prompt.values())} runs "
              f"(bootstrap resamples by {cluster_by})")
    if dropped_excluded:
        print(f"- Excluded prompts {sorted(excluded_prompts)}: {dropped_excluded} rows dropped")
    if args.drop_tool_rows:
        print(f"- Tool-using prompt/run keys dropped from every arm: "
              f"{len(tool_keys)} keys, {dropped_tool} rows")
    elif tool_keys and args.metric == "prose":
        print(f"- **Warning:** {len(tool_keys)} prompt/run key(s) answered via tools "
              f"({sorted(tool_keys)}) but are scored on prose tokens only. "
              f"Re-run with `--drop-tool-rows` for a like-for-like comparison.")
    print()
    print("## Output-token distribution per arm")
    print()
    print("| Arm | N | Median | Mean | Min | Max | Stdev | Savings vs baseline (median) |")
    print("| --- | -:| -----: | ---: | --: | --: | ----: | ---------------------------: |")
    for arm in arms:
        s = stats_for(by_arm[arm])
        savings = "—"
        if baseline_median and s["median"] is not None and arm != args.baseline:
            saved = (baseline_median - s["median"]) / baseline_median * 100.0
            savings = f"{saved:+.1f}%"
        elif arm == args.baseline:
            savings = "(baseline)"
        print(f"| `{arm}` | {fmt(s['n'])} | {fmt(s['median'])} | {fmt(s['mean'])} | "
              f"{fmt(s['min'])} | {fmt(s['max'])} | {fmt(s['stdev'])} | {savings} |")
    print()

    print_paired_stats(by_key, arms, args.baseline,
                       paired_keys if args.paired else None,
                       args.bootstrap, cluster_by, args.seed)

    if repeated_runs:
        print_noise_floor(by_key, arms)

    compare = choose_compare_arms(arms, args.compare)
    if compare:
        print_direct_comparison(by_key, compare[0], compare[1],
                                paired_keys if args.paired else None)

    if "terse" in arms:
        print_control_comparison(by_key, arms, "terse",
                                 paired_keys if args.paired else None)

    if args.show_text:
        sample_keys = paired_keys if args.paired else set.intersection(
            *[set(by_key[arm]) for arm in arms]
        )
        print_text_samples(results, arms, sample_keys, args.show_text)

    unresolved_errors: dict[str, int] = {}
    for arm, keys in error_keys.items():
        unresolved = [
            key for key in keys
            if not (isinstance(key[0], int) and key in by_key.get(arm, {}))
        ]
        if unresolved:
            unresolved_errors[arm] = len(unresolved)

    if unresolved_errors:
        print("## Errors")
        print()
        for arm, n in unresolved_errors.items():
            print(f"- `{arm}`: {n} failed runs")
        print()

    print("## Interpretation")
    print()
    print("- `output_tokens` is the agent runtime's recorded value (from session JSONL `usage.output_tokens`), not a tokenizer estimate.")
    print("- Savings % is *estimate-only* — same prompt, same model, but the assistant text is not identical, so equivalent information density is assumed (see benchmarks/README.md).")
    print("- Median dominates the headline; mean is reported but distorts on long-tail outliers.")
    print("- Stdev close to median = unstable arm. Re-run with `--runs N` higher to firm up.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
