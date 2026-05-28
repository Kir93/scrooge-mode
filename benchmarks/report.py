#!/usr/bin/env python3
"""Scrooge benchmark report — aggregate run.py output and compute savings %.

Reads the JSONL emitted by `benchmarks/run.py` and prints a markdown summary:
per-arm distribution stats (median / mean / min / max / stdev) plus the
savings ratio against a baseline arm.

Only median is used for the savings headline (mean is reported alongside but
distorts under outliers). Information equivalence between arms is the
benchmark caller's responsibility — see benchmarks/README.md.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path


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
    args = ap.parse_args()

    results = load_results(args.input)
    if not results:
        print(f"error: no results in {args.input}", file=sys.stderr)
        return 2

    all_arms: list[str] = []
    by_arm: dict[str, list[int]] = defaultdict(list)
    by_key: dict[str, dict[tuple[int, int], int]] = defaultdict(dict)
    error_keys: dict[str, set[tuple[int, int] | tuple[str, int]]] = defaultdict(set)
    providers: set[str] = set()
    for r in results:
        arm = r["arm"]
        if arm not in all_arms:
            all_arms.append(arm)
        provider = r.get("provider")
        if isinstance(provider, str) and provider:
            providers.add(provider)
        if r.get("error"):
            pid = r.get("prompt_id")
            run = r.get("run")
            if isinstance(pid, int) and isinstance(run, int):
                error_keys[arm].add((pid, run))
            else:
                error_keys[arm].add(("unknown", len(error_keys[arm])))
            continue
        tok = r.get("output_tokens")
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

    print(f"# Scrooge benchmark report")
    print()
    print(f"- Source: `{args.input}`")
    print(f"- Baseline: `{args.baseline}`")
    print(f"- Arms: {', '.join(arms)}")
    if args.paired:
        print(f"- Paired prompt/run keys: {len(paired_keys)}")
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
