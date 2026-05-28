#!/usr/bin/env python3
"""Scrooge benchmark driver — subscription-CLI based.

Runs a fixed prompt corpus against several register "arms" (normal, scrooge,
caveman, or any rule file) via the Claude Code subscription CLI in headless
print mode, then parses the session JSONL to recover *actual* output token
counts written by the agent runtime (not tiktoken estimates).

No paid API key required — uses the user's subscription `claude` CLI.

Arm syntax (comma-separated to --arms):
  normal                       — no rule injection (baseline).
  terse                        — generic "answer concisely" control arm.
  scrooge:LANG/DIAL            — inject rules/LANG/DIAL.md (e.g. scrooge:ko/full).
  caveman:LEVEL                — inject caveman SKILL.md filtered to LEVEL (best-effort path search).
  file:PATH                    — inject the file at PATH verbatim.
  NAME=PATH                    — inject PATH, labelled NAME (e.g. caveman=~/.claude/.../caveman.md).

Output: one JSON object per (arm, prompt, run) appended to --output as JSONL.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterator, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
RULES_DIR = REPO_ROOT / "rules"
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"

TERSE_CONTROL_SYSTEM = (
    "Answer concisely. Respond in the language the user writes in. Keep all "
    "technical substance and required reasoning."
)


# ---------------------------------------------------------------------------
# Arm rule-text resolution
# ---------------------------------------------------------------------------

def resolve_arm(spec: str) -> tuple[str, str]:
    """Return (label, rule_text) for an arm spec. Empty rule_text = baseline."""
    if spec == "normal":
        return "normal", ""
    if spec == "terse":
        return "terse", TERSE_CONTROL_SYSTEM
    if "=" in spec:
        label, path = spec.split("=", 1)
        return label, _read_text(Path(path).expanduser())
    if spec.startswith("scrooge:"):
        rest = spec.split(":", 1)[1]
        if "/" not in rest:
            raise ValueError(f"scrooge arm needs LANG/DIAL, got {spec!r}")
        lang, dial = rest.split("/", 1)
        path = RULES_DIR / lang / f"{dial}.md"
        return spec, _read_text(path)
    if spec.startswith("caveman:"):
        level = spec.split(":", 1)[1]
        path = _find_caveman_rule(level)
        if path is None:
            raise FileNotFoundError(
                f"caveman rule for level {level!r} not found in known install paths"
            )
        return spec, _read_text(path)
    if spec.startswith("file:"):
        return spec, _read_text(Path(spec.split(":", 1)[1]).expanduser())
    raise ValueError(f"unknown arm spec: {spec!r}")


def _read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"rule file not found: {path}")
    return path.read_text(encoding="utf-8")


def _find_caveman_rule(level: str) -> Optional[Path]:
    """Best-effort: search known caveman install paths for a rule at LEVEL.

    Tries: ~/.claude/skills/caveman/SKILL.md and the standard plugin marketplace
    layout. Returns the matched path, or None.
    """
    candidates = [
        Path.home() / ".claude" / "skills" / "caveman" / "SKILL.md",
        *Path(Path.home() / ".claude" / "plugins").glob(
            "marketplaces/*/plugins/caveman/skills/caveman/SKILL.md"
        ),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


# ---------------------------------------------------------------------------
# Prompt corpus
# ---------------------------------------------------------------------------

def load_prompts(path: Path) -> list[str]:
    """Read prompts; one per non-comment, non-blank line. Expands literal \\n."""
    out: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        # Expand escaped newlines so multi-line code prompts stay one-per-line in file.
        out.append(line.replace("\\n", "\n"))
    return out


def load_success_keys(path: Path) -> set[tuple[str, int, int]]:
    """Return successful (arm, prompt_id, run) keys already present in output."""
    if not path.exists():
        return set()
    keys: set[tuple[str, int, int]] = set()
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("error"):
                continue
            if not isinstance(obj.get("output_tokens"), int):
                continue
            arm = obj.get("arm")
            pid = obj.get("prompt_id")
            run = obj.get("run")
            if isinstance(arm, str) and isinstance(pid, int) and isinstance(run, int):
                keys.add((arm, pid, run))
    return keys


# ---------------------------------------------------------------------------
# Claude CLI invocation
# ---------------------------------------------------------------------------

@dataclass
class RunResult:
    arm: str
    prompt_id: int
    run: int
    output_tokens: Optional[int]
    cache_read_tokens: Optional[int]
    model: Optional[str]
    elapsed_s: float
    session_file: Optional[str]
    output_chars: Optional[int] = None
    output_text: Optional[str] = None
    error: Optional[str] = None
    provider: str = "claude"


NORMAL_BASELINE_SYSTEM = (
    "You are a helpful technical assistant. Respond in the language the user "
    "writes in. Provide complete, accurate technical answers."
)


def build_cmd(rule_text: str, prompt: str) -> list[str]:
    """Build the `claude --print` argv.

    - `--system-prompt RULE`: REPLACE the default system prompt entirely so the
      register rule is the only system-level instruction. Otherwise the host's
      default Claude Code system prompt (~thousands of tokens of tool / style
      preamble) would dominate every arm equally, but also encourage verbose
      responses regardless of register. The neutral baseline still uses
      `--system-prompt` with a minimal "helpful assistant" instruction so all
      arms differ only in their register text.
    - `--`: separator so prompts beginning with `-` or `--` (e.g. caveman's
      YAML frontmatter `---`) are not mis-parsed as options.

    `--bare` is NOT used: it disables OAuth/keychain auth and requires
    ANTHROPIC_API_KEY, which contradicts the subscription-only design.

    Per-machine sources of register pollution (host CLAUDE.md, caveman state
    file `.caveman-active`) still leak through. Callers should arrange
    isolation before invoking — see `caveman_isolation` context manager
    elsewhere in this module.
    """
    system = rule_text if rule_text else NORMAL_BASELINE_SYSTEM
    return ["claude", "--print", "--system-prompt", system, "--", prompt]


def cwd_session_dir(cwd: Path) -> Path:
    """Compute the Claude projects subdir for the given cwd (slugified)."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", str(cwd))
    slug = re.sub(r"-+", "-", slug).strip("-")
    return CLAUDE_PROJECTS_DIR / f"-{slug}"


def newest_session_file(d: Path) -> Optional[Path]:
    if not d.exists():
        return None
    files = sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def parse_assistant_tokens(session_path: Path) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """Sum output/cache tokens across assistant turns in this session JSONL."""
    out = 0
    cache = 0
    model = None
    found = False
    with session_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "assistant":
                continue
            msg = obj.get("message") or {}
            usage = msg.get("usage") or {}
            ot = usage.get("output_tokens")
            cr = usage.get("cache_read_input_tokens")
            if isinstance(ot, int):
                out += ot
                found = True
            if isinstance(cr, int):
                cache += cr
            model = model or msg.get("model")
    if not found:
        return None, None, model
    return out, cache, model


def run_one(arm: str, rule_text: str, prompt: str, prompt_id: int, run: int,
            cwd: Path, dry_run: bool, timeout: int) -> RunResult:
    session_dir = cwd_session_dir(cwd)
    before = newest_session_file(session_dir)
    before_mtime = before.stat().st_mtime if before else 0
    start = time.monotonic()

    if dry_run:
        # Synthesize a fake response so the pipeline can be smoke-tested without
        # burning quota. Token counts vary by arm + prompt to exercise the
        # report stats meaningfully.
        base = 200 + len(prompt) // 3 + (prompt_id * 7 % 80)
        ratio = 1.0
        if "full" in arm:
            ratio = 0.55 + (prompt_id * 13 % 15) / 100.0
        elif "lite" in arm:
            ratio = 0.75 + (prompt_id * 11 % 12) / 100.0
        fake_tokens = max(40, int(base * ratio))
        fake_text = f"[dry-run] {arm} prompt={prompt_id} run={run}"
        return RunResult(arm=arm, prompt_id=prompt_id, run=run,
                         output_tokens=fake_tokens, cache_read_tokens=0,
                         model="dry-run", elapsed_s=time.monotonic() - start,
                         session_file=None, output_chars=len(fake_text),
                         output_text=fake_text)

    cmd = build_cmd(rule_text, prompt)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=None,
                         cache_read_tokens=None, model=None,
                         elapsed_s=time.monotonic() - start, session_file=None,
                         error="timeout")
    elapsed = time.monotonic() - start
    if r.returncode != 0:
        detail = (r.stderr.strip() or r.stdout.strip())[:400]
        return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=None,
                         cache_read_tokens=None, model=None, elapsed_s=elapsed,
                         session_file=None,
                         error=f"claude exit {r.returncode}: {detail}")

    # Find the session JSONL written by this invocation.
    session_path = None
    for _ in range(20):  # short retry — disk flush
        latest = newest_session_file(session_dir)
        if latest and latest.stat().st_mtime > before_mtime:
            session_path = latest
            break
        time.sleep(0.1)

    if session_path is None:
        return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=None,
                         cache_read_tokens=None, model=None, elapsed_s=elapsed,
                         session_file=None,
                         error="no new session file found for benchmark cwd")

    out_tokens, cache_tokens, model = parse_assistant_tokens(session_path)
    output_text = r.stdout.strip()
    return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=out_tokens,
                     cache_read_tokens=cache_tokens, model=model, elapsed_s=elapsed,
                     session_file=session_path.name, output_chars=len(output_text),
                     output_text=output_text)


def is_session_limit(error: Optional[str]) -> bool:
    if not error:
        return False
    lowered = error.lower()
    return "session limit" in lowered or "usage limit" in lowered or "rate limit" in lowered


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def iter_jobs(arms: list[tuple[str, str]], prompts: list[str], runs: int,
              order: str) -> Iterator[tuple]:
    """Yield benchmark jobs.

    prompt-major is the fair default for quota-limited subscription runs: each
    prompt cycles through all arms before moving on, so a mid-run quota limit
    does not spend the whole budget on the baseline first.
    """
    if order == "arm-major":
        for arm_label, rule_text in arms:
            for pid, prompt in enumerate(prompts):
                for run in range(runs):
                    yield arm_label, rule_text, prompt, pid, run
        return

    for pid, prompt in enumerate(prompts):
        for run in range(runs):
            for arm_label, rule_text in arms:
                yield arm_label, rule_text, prompt, pid, run


ISOLATION_LOCK_DIR = Path("/tmp/scrooge-bench-isolation.lock.d")


@contextlib.contextmanager
def host_isolation(enabled: bool):
    """Move ~/.claude/settings.json and ~/.claude/.caveman-active aside.

    Why both:

    - `~/.claude/settings.json` registers caveman's SessionStart + UPS hooks
      globally; every child `claude --print` we spawn inherits them, so the
      caveman SKILL.md gets injected as a SessionStart attachment into ALL
      arms (including "normal"). That pollutes the baseline and silently
      caps the upper bound of any "savings vs normal" measurement.
    - `~/.claude/.caveman-active` is the state file caveman's hooks consult.
      Even if a hook fires without it, removing it is belt-and-suspenders.

    Moving both for the benchmark duration gives a clean child environment.
    The parent claude session (the one orchestrating the benchmark) loses
    those hooks too — that's a deliberate side effect, since the parent
    invoked the benchmark explicitly.

    Concurrency safety: an atomic mkdir-based lock (`ISOLATION_LOCK_DIR`)
    serializes host isolation across processes — a second invocation
    fails fast with exit code 2 instead of clobbering the first process's
    backups, which previously risked permanent loss of the user's real
    `~/.claude/settings.json`. Backup paths also carry the holder's PID so
    a stale lock dir can be diagnosed manually.

    Restoration is best-effort: if a parent-session hook re-creates either
    file mid-benchmark, we discard our stale backups instead of clobbering.
    """
    if not enabled:
        yield
        return

    try:
        ISOLATION_LOCK_DIR.mkdir(parents=False, exist_ok=False)
    except FileExistsError:
        print(f"error: another benchmark run is isolating the host "
              f"(lock dir {ISOLATION_LOCK_DIR} exists). Wait for it to "
              f"finish, or — if no run is active — remove the lock dir "
              f"manually after checking its `holder.pid` file.",
              file=sys.stderr)
        sys.exit(2)

    pid = os.getpid()
    try:
        (ISOLATION_LOCK_DIR / "holder.pid").write_text(f"{pid}\n", encoding="utf-8")
    except OSError:
        pass

    targets = [
        (Path.home() / ".claude" / "settings.json",
         Path(f"/tmp/scrooge-bench-settings.json.{pid}.bak")),
        (Path.home() / ".claude" / ".caveman-active",
         Path(f"/tmp/scrooge-bench-caveman-active.{pid}.bak")),
    ]
    moved = []
    try:
        for live, backup in targets:
            if live.exists():
                if backup.exists():
                    raise RuntimeError(
                        f"refusing to clobber existing backup {backup}; "
                        f"resolve manually before re-running"
                    )
                shutil.move(str(live), str(backup))
                moved.append((live, backup))
                print(f"[isolation] moved {live} → {backup}", file=sys.stderr)
        yield
    finally:
        for live, backup in moved:
            if backup.exists() and not live.exists():
                shutil.move(str(backup), str(live))
                print(f"[isolation] restored {backup} → {live}", file=sys.stderr)
            elif backup.exists():
                backup.unlink()
                print(f"[isolation] discarded stale backup {backup}", file=sys.stderr)
        try:
            (ISOLATION_LOCK_DIR / "holder.pid").unlink(missing_ok=True)
            ISOLATION_LOCK_DIR.rmdir()
        except OSError as e:
            print(f"[isolation] warning: failed to release lock dir "
                  f"{ISOLATION_LOCK_DIR}: {e}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompts", required=True, type=Path, help="Path to prompts file (one per line).")
    ap.add_argument("--arms", required=True, help="Comma-separated arm specs.")
    ap.add_argument("--runs", type=int, default=1, help="Repetitions per (arm, prompt). Default 1.")
    ap.add_argument("--output", required=True, type=Path, help="JSONL output file (results appended).")
    ap.add_argument("--cwd", type=Path, default=REPO_ROOT, help="Working dir for claude invocation. Default repo root.")
    ap.add_argument("--timeout", type=int, default=120, help="Per-call timeout seconds. Default 120.")
    ap.add_argument("--dry-run", action="store_true", help="Synthesize fake responses (smoke test).")
    ap.add_argument("--no-isolate-host", action="store_true",
                    help="Skip moving ~/.claude/{settings.json,.caveman-active} aside. Default: isolate.")
    ap.add_argument("--workers", type=int, default=1,
                    help="Concurrent claude --print calls. Default 1 (serial). >1 spawns a thread "
                         "pool; each call gets a unique sub-cwd under --cwd so session JSONL "
                         "discovery does not race. Mind subscription rate limits.")
    ap.add_argument("--order", choices=["prompt-major", "arm-major"], default="prompt-major",
                    help="Job order. Default prompt-major keeps arms balanced under quota limits.")
    ap.add_argument("--max-prompts", type=int, default=0,
                    help="Only use the first N prompts. Default 0 = all prompts.")
    ap.add_argument("--resume", action="store_true",
                    help="Skip successful (arm, prompt_id, run) keys already present in --output.")
    ap.add_argument("--keep-going-on-limit", action="store_true",
                    help="Do not stop serial execution when Claude reports a session/rate limit.")
    args = ap.parse_args()

    if not args.dry_run and shutil.which("claude") is None:
        print("error: `claude` CLI not on PATH. Install Claude Code or pass --dry-run.", file=sys.stderr)
        return 2

    arms: list[tuple[str, str]] = []
    for spec in [s.strip() for s in args.arms.split(",") if s.strip()]:
        arms.append(resolve_arm(spec))

    prompts = load_prompts(args.prompts)
    if args.max_prompts > 0:
        prompts = prompts[:args.max_prompts]
    if not prompts:
        print(f"error: no prompts loaded from {args.prompts}", file=sys.stderr)
        return 2

    total = len(arms) * len(prompts) * args.runs
    print(f"arms={len(arms)} prompts={len(prompts)} runs={args.runs} "
          f"order={args.order} total={total}", file=sys.stderr)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    jobs = list(enumerate(iter_jobs(arms, prompts, args.runs, args.order), 1))
    if args.resume:
        done = load_success_keys(args.output)
        before_count = len(jobs)
        jobs = [
            job for job in jobs
            if (job[1][0], job[1][3], job[1][4]) not in done
        ]
        print(f"resume={len(done)} successes found; "
              f"skipping {before_count - len(jobs)} jobs; remaining={len(jobs)}",
              file=sys.stderr)
    cwd_base = args.cwd.resolve()

    def execute(job_idx_and_spec):
        idx, (arm_label, rule_text, prompt, pid, run) = job_idx_and_spec
        # Per-call cwd so concurrent calls write to distinct
        # ~/.claude/projects/<slug>/ subdirs and newest-jsonl discovery
        # does not race. Serial workers=1 also tolerates this (mkdir is
        # idempotent, no extra cost).
        call_cwd = cwd_base if args.workers <= 1 else cwd_base / f"call-{idx:04d}"
        call_cwd.mkdir(parents=True, exist_ok=True)
        return idx, run_one(arm_label, rule_text, prompt, pid, run,
                            cwd=call_cwd, dry_run=args.dry_run,
                            timeout=args.timeout)

    def write_result(idx, result):
        out.write(json.dumps(asdict(result), ensure_ascii=False) + "\n")
        out.flush()
        tok = result.output_tokens if result.output_tokens is not None else "—"
        err = f"  ERR: {result.error}" if result.error else ""
        print(f"  [{idx}/{total}] arm={result.arm} prompt={result.prompt_id} "
              f"run={result.run} tokens={tok} t={result.elapsed_s:.1f}s{err}",
              file=sys.stderr)

    with host_isolation(enabled=not args.no_isolate_host and not args.dry_run):
        with args.output.open("a", encoding="utf-8") as out:
            if args.workers <= 1:
                for job in jobs:
                    idx, result = execute(job)
                    write_result(idx, result)
                    if is_session_limit(result.error) and not args.keep_going_on_limit:
                        print("session/rate limit detected; stopping early. "
                              "Re-run with --resume after reset.",
                              file=sys.stderr)
                        break
            else:
                print(f"  [workers={args.workers}] parallel execution", file=sys.stderr)
                with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
                    futures = [ex.submit(execute, job) for job in jobs]
                    for fut in concurrent.futures.as_completed(futures):
                        idx, result = fut.result()
                        write_result(idx, result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
