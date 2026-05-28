#!/usr/bin/env python3
"""Scrooge benchmark driver — Codex CLI secondary harness.

Runs the same arm specs as run.py through `codex exec` and emits the same JSONL
shape, so report.py can compare normal / scrooge / caveman with paired scoring.

This is a secondary cross-agent signal. Do not mix these numbers with the
Claude Code subscription benchmark; Codex uses a different runtime, tokenizer,
and instruction wrapper.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from run import REPO_ROOT, RunResult, iter_jobs, load_prompts, load_success_keys, resolve_arm


NORMAL_INSTRUCTION = (
    "Respond in the user's language. Provide complete, accurate technical "
    "answers without artificial brevity."
)


def build_prompt(rule_text: str, prompt: str) -> str:
    instruction = rule_text if rule_text else NORMAL_INSTRUCTION
    return (
        "You are running a benchmark. Follow ONLY the instruction block below. "
        "Do not mention the benchmark.\n\n"
        "<instruction>\n"
        f"{instruction}\n"
        "</instruction>\n\n"
        "<user_prompt>\n"
        f"{prompt}\n"
        "</user_prompt>"
    )


def parse_codex_json(output: str) -> tuple[Optional[str], Optional[int], Optional[int], Optional[int], Optional[str]]:
    text = None
    total_output = None
    reasoning_output = 0
    input_tokens = None
    error = None

    for raw in output.splitlines():
        line = raw.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "item.completed":
            item = obj.get("item") or {}
            if item.get("type") == "agent_message":
                text = item.get("text")
        elif obj.get("type") == "turn.completed":
            usage = obj.get("usage") or {}
            if isinstance(usage.get("output_tokens"), int):
                total_output = usage["output_tokens"]
            if isinstance(usage.get("reasoning_output_tokens"), int):
                reasoning_output = usage["reasoning_output_tokens"]
            if isinstance(usage.get("input_tokens"), int):
                input_tokens = usage["input_tokens"]
        elif obj.get("type") == "error":
            error = obj.get("message") or str(obj)

    return text, total_output, reasoning_output, input_tokens, error


def run_one(arm: str, rule_text: str, prompt: str, prompt_id: int, run: int,
            cwd: Path, dry_run: bool, timeout: int, model: str) -> RunResult:
    start = time.monotonic()

    if dry_run:
        base = 200 + len(prompt) // 3 + (prompt_id * 7 % 80)
        ratio = 1.0
        if "full" in arm:
            ratio = 0.55 + (prompt_id * 13 % 15) / 100.0
        fake_tokens = max(40, int(base * ratio))
        fake_text = f"[codex dry-run] {arm} prompt={prompt_id} run={run}"
        return RunResult(arm=arm, prompt_id=prompt_id, run=run,
                         output_tokens=fake_tokens, cache_read_tokens=None,
                         model="codex-dry-run", elapsed_s=time.monotonic() - start,
                         session_file=None, output_chars=len(fake_text),
                         output_text=fake_text, provider="codex")

    with tempfile.NamedTemporaryFile(prefix="scrooge-codex-", suffix=".txt", delete=False) as f:
        out_path = Path(f.name)

    cmd = [
        "codex", "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox", "read-only",
        "--json",
        "--output-last-message", str(out_path),
        "-C", str(cwd),
    ]
    if model:
        cmd.extend(["-m", model])
    cmd.append(build_prompt(rule_text, prompt))

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        return RunResult(arm=arm, prompt_id=prompt_id, run=run,
                         output_tokens=None, cache_read_tokens=None, model=model or None,
                         elapsed_s=time.monotonic() - start, session_file=None,
                         error="timeout")

    elapsed = time.monotonic() - start
    combined = "\n".join([r.stdout, r.stderr])
    text, total_output, reasoning_output, input_tokens, parsed_error = parse_codex_json(combined)
    if text is None and out_path.exists():
        text = out_path.read_text(encoding="utf-8").strip()

    if r.returncode != 0:
        detail = parsed_error or (r.stderr.strip() or r.stdout.strip())[:400]
        return RunResult(arm=arm, prompt_id=prompt_id, run=run,
                         output_tokens=None, cache_read_tokens=input_tokens,
                         model=model or "codex", elapsed_s=elapsed,
                         session_file=None, output_chars=len(text or ""),
                         output_text=text, error=f"codex exit {r.returncode}: {detail}",
                         provider="codex")

    visible_output = None
    if isinstance(total_output, int):
        visible_output = max(0, total_output - (reasoning_output or 0))

    text = text or ""
    return RunResult(arm=arm, prompt_id=prompt_id, run=run,
                     output_tokens=visible_output, cache_read_tokens=input_tokens,
                     model=model or "codex", elapsed_s=elapsed, session_file=None,
                     output_chars=len(text), output_text=text, provider="codex")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompts", required=True, type=Path)
    ap.add_argument("--arms", required=True)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--cwd", type=Path, default=REPO_ROOT)
    ap.add_argument("--timeout", type=int, default=240)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--model", default="", help="Codex model override. Default = Codex config default.")
    ap.add_argument("--max-prompts", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    arms = [resolve_arm(s.strip()) for s in args.arms.split(",") if s.strip()]
    prompts = load_prompts(args.prompts)
    if args.max_prompts > 0:
        prompts = prompts[:args.max_prompts]
    if not prompts:
        print(f"error: no prompts loaded from {args.prompts}", file=sys.stderr)
        return 2

    jobs = list(enumerate(iter_jobs(arms, prompts, args.runs, "prompt-major"), 1))
    if args.resume:
        done = load_success_keys(args.output)
        before = len(jobs)
        jobs = [job for job in jobs if (job[1][0], job[1][3], job[1][4]) not in done]
        print(f"resume={len(done)} successes found; skipping {before - len(jobs)}; remaining={len(jobs)}",
              file=sys.stderr)

    total = len(arms) * len(prompts) * args.runs
    print(f"provider=codex arms={len(arms)} prompts={len(prompts)} runs={args.runs} total={total}",
          file=sys.stderr)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("a", encoding="utf-8") as out:
        for idx, (arm_label, rule_text, prompt, pid, run) in jobs:
            result = run_one(arm_label, rule_text, prompt, pid, run,
                             cwd=args.cwd.resolve(), dry_run=args.dry_run,
                             timeout=args.timeout, model=args.model)
            out.write(json.dumps(asdict(result), ensure_ascii=False) + "\n")
            out.flush()
            tok = result.output_tokens if result.output_tokens is not None else "—"
            err = f" ERR: {result.error}" if result.error else ""
            print(f"  [{idx}/{total}] arm={result.arm} prompt={result.prompt_id} "
                  f"run={result.run} tokens={tok} chars={result.output_chars} "
                  f"t={result.elapsed_s:.1f}s{err}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
