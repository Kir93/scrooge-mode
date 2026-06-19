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
    tool_use_output_tokens: Optional[int] = None
    total_output_tokens: Optional[int] = None
    raw_output_tokens: Optional[int] = None
    turns: Optional[int] = None
    isolation_verified: Optional[bool] = None
    contaminated: bool = False


NORMAL_BASELINE_SYSTEM = (
    "You are a helpful technical assistant. Respond in the language the user "
    "writes in. Provide complete, accurate technical answers."
)


def build_cmd(rule_text: str, prompt: str, model: Optional[str] = None,
              disallow_tools: bool = False) -> list[str]:
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

    `disallow_tools` denies the file-mutating tools (`Write`/`Edit`/
    `NotebookEdit`/`Bash`). This matters for **document-generation** corpora: with
    tools available the model may write the doc to a file (tool_use) and emit only
    a one-line "wrote X.md" summary as prose, which collapses the prose-only token
    count and makes the arm look artificially compressed. Denying file tools forces
    every arm to emit the document inline, so the prose-only headline measures the
    register, not a tool-use decision. Leave off for conversational corpora.

    `--bare` is NOT used: it disables OAuth/keychain auth and requires
    ANTHROPIC_API_KEY, which contradicts the subscription-only design.

    Per-machine sources of register pollution (host CLAUDE.md, caveman state
    file `.caveman-active`) still leak through. Callers should arrange
    isolation before invoking — see `caveman_isolation` context manager
    elsewhere in this module.
    """
    system = rule_text if rule_text else NORMAL_BASELINE_SYSTEM
    cmd = ["claude", "--print", "--system-prompt", system]
    if model:
        cmd += ["--model", model]
    if disallow_tools:
        cmd += ["--disallowedTools", "Write", "Edit", "NotebookEdit", "Bash"]
    cmd += ["--", prompt]
    return cmd


def cwd_session_dir(cwd: Path) -> Path:
    """Compute the Claude projects subdir for the given cwd.

    Claude Code slugifies the cwd by replacing each non-alphanumeric character
    with `-` — one dash per character, with NO run-collapsing: a cwd ending
    `.../n6/_5c0` becomes `...-n6--5c0` (double dash from the `/` then `_`). The
    prior regex collapsed runs (`[^A-Za-z0-9]+` plus `-+`→`-`), so any cwd with
    consecutive separators — e.g. a macOS `/var/folders/<a>/_<hash>/T/tmp.X` temp
    dir, exactly the empty `--cwd` this benchmark wants — hashed to the wrong
    subdir and session discovery failed with "no new session file found". Match
    Claude's char-by-char rule exactly. For paths without consecutive separators
    (e.g. the repo root) the result is unchanged.
    """
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(cwd))
    return CLAUDE_PROJECTS_DIR / slug


def newest_session_file(d: Path) -> Optional[Path]:
    if not d.exists():
        return None
    files = sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


@dataclass
class TokenSummary:
    prose_output_tokens: int
    tool_use_output_tokens: int
    total_output_tokens: int
    raw_output_tokens: int
    cache_read_tokens: int
    turns: int
    model: Optional[str]
    has_usage: bool


def parse_assistant_tokens(session_path: Path) -> TokenSummary:
    """Token summary for one session JSONL, aligned with the Task 1 stats
    methodology (`lib/session-log.js` `parseClaudeSession`).

    Claude writes one JSONL line per *content block* of a response, repeating the
    same `message.id` and `usage` on each line. Naively summing every line
    double-counts usage (measured ~2.89x on agentic sessions). So dedup by
    `message.id` (fallback `requestId` -> line index) and count each id's usage
    once (last-wins for repeats). A response is bucketed as tool_use when ANY of
    its content blocks is tool_use, decided only after scanning every line for
    that id. The benchmark headline (`output_tokens`) is the prose-only bucket,
    matching how `scrooge-stats` applies its savings ratio to prose alone.

    `raw_output_tokens` keeps the pre-dedup naive sum so a regression back to
    double-counting is visible in the data.
    """
    by_id: dict = {}
    raw_sum = 0
    model = None
    line_index = -1
    try:
        text = session_path.read_text(encoding="utf-8")
    except OSError:
        return TokenSummary(0, 0, 0, 0, 0, 0, None, False)

    for line in text.split("\n"):
        line_index += 1
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "assistant":
            continue
        msg = entry.get("message") or {}
        mid = msg.get("id") or entry.get("requestId") or f"__line_{line_index}"
        rec = by_id.get(mid)
        if rec is None:
            rec = {"output": 0, "cache": 0, "has_usage": False, "tool_use": False}
            by_id[mid] = rec
        usage = msg.get("usage") or {}
        ot = usage.get("output_tokens")
        if isinstance(ot, int):
            rec["output"] = ot  # last-wins; idempotent for repeated same-id lines
            rec["cache"] = usage.get("cache_read_input_tokens") or 0
            rec["has_usage"] = True
            raw_sum += ot
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    rec["tool_use"] = True
                    break
        if model is None and msg.get("model"):
            model = msg.get("model")

    prose = tool_use = cache = turns = 0
    for rec in by_id.values():
        if not rec["has_usage"]:
            continue
        cache += rec["cache"]
        turns += 1
        if rec["tool_use"]:
            tool_use += rec["output"]
        else:
            prose += rec["output"]
    return TokenSummary(
        prose_output_tokens=prose,
        tool_use_output_tokens=tool_use,
        total_output_tokens=prose + tool_use,
        raw_output_tokens=raw_sum,
        cache_read_tokens=cache,
        turns=turns,
        model=model,
        has_usage=turns > 0,
    )


CAVEMAN_FINGERPRINT = re.compile(r"caveman", re.IGNORECASE)
# scrooge's hook reminder/injection/countermand strings (hooks/scrooge-activate.js
# buildReminder / buildFullInjection / buildCountermand). Their presence in a
# transcript means the scrooge UPS/SessionStart hook fired — which, post-isolation,
# it must not. A benchmark answer never emits these literals.
SCROOGE_HOOK_FINGERPRINT = re.compile(r"SCROOGE\s+(활성|active|MODE ACTIVE|OFF)", re.IGNORECASE)
_NOISE_KEYS = ("cwd", "gitBranch")


def _injection_scan_text(session_path: Path) -> Optional[str]:
    """Concatenate a session JSONL's register-injection surface (attachment/hook/
    message content), with the noisy top-level `cwd`/`gitBranch` metadata removed.
    Claude stamps cwd+gitBranch on most lines, so scanning the raw text would let a
    benchmark run from a path or branch containing a register name self-trigger
    contamination. Returns None if unreadable."""
    try:
        raw = session_path.read_text(encoding="utf-8")
    except OSError:
        return None
    chunks = []
    for line in raw.split("\n"):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue  # skip unparseable lines rather than scan raw metadata
        if isinstance(obj, dict):
            for k in _NOISE_KEYS:
                obj.pop(k, None)
        chunks.append(json.dumps(obj, ensure_ascii=False))
    return "\n".join(chunks)


def detect_contamination(session_path: Path, arm: str) -> Optional[str]:
    """Return a contamination marker if a register hook leaked into this arm's
    session, else None. The authoritative per-row backstop behind host_isolation.

    Two register hooks can inject a compression directive into a child
    `claude --print` through the hook channel (it lands in the transcript as a
    hook_additional_context attachment, which this scan sees):
      - scrooge — the user's own UPS/SessionStart hook ("SCROOGE 활성 …"). After
        isolation moves `.scrooge-active` aside it must inject nothing, so its
        reminder appearing in ANY arm (including the scrooge arm, whose register
        must come only from --system-prompt) means isolation failed. This is the
        contaminant that corrupted the first opus-4-8 run (compressed every
        baseline; cross-lingually broke EN).
      - caveman — the historical 34/97 leak; flagged in any NON-caveman arm (a
        caveman arm legitimately carries the word).
    A flagged row is excluded (output_tokens=None) and retried under --resume.
    The scan ignores cwd/gitBranch metadata (see `_injection_scan_text`).
    """
    text = _injection_scan_text(session_path)
    if text is None:
        return None
    if SCROOGE_HOOK_FINGERPRINT.search(text):
        return "scrooge register-hook injection in session transcript"
    if "caveman" not in arm.lower() and CAVEMAN_FINGERPRINT.search(text):
        return "caveman fingerprint in session transcript"
    return None


def run_one(arm: str, rule_text: str, prompt: str, prompt_id: int, run: int,
            cwd: Path, dry_run: bool, timeout: int, model: Optional[str] = None,
            isolation_verified: Optional[bool] = None,
            disallow_tools: bool = False) -> RunResult:
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
                         output_text=fake_text, tool_use_output_tokens=0,
                         total_output_tokens=fake_tokens, raw_output_tokens=fake_tokens,
                         turns=1, isolation_verified=isolation_verified)

    cmd = build_cmd(rule_text, prompt, model, disallow_tools)
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

    summary = parse_assistant_tokens(session_path)
    output_text = r.stdout.strip()
    contamination = detect_contamination(session_path, arm)
    if contamination:
        # Exclude (output_tokens=None) so the row is not scored and `--resume`
        # retries it once the activation channel is removed.
        return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=None,
                         cache_read_tokens=summary.cache_read_tokens, model=summary.model,
                         elapsed_s=elapsed, session_file=session_path.name,
                         output_chars=len(output_text), output_text=output_text,
                         isolation_verified=isolation_verified, contaminated=True,
                         error=f"contamination: {contamination}")
    headline = summary.prose_output_tokens if summary.has_usage else None
    return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=headline,
                     cache_read_tokens=summary.cache_read_tokens, model=summary.model,
                     elapsed_s=elapsed, session_file=session_path.name,
                     output_chars=len(output_text), output_text=output_text,
                     tool_use_output_tokens=summary.tool_use_output_tokens,
                     total_output_tokens=summary.total_output_tokens,
                     raw_output_tokens=summary.raw_output_tokens,
                     turns=summary.turns, isolation_verified=isolation_verified)


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
def host_isolation(enabled: bool, isolate_settings: bool = False):
    """Neutralize host register hooks for the benchmark by moving their *state
    files* aside (`~/.claude/.scrooge-active`, any `.scrooge-active-*`, and
    `~/.claude/.caveman-active`).

    Why state files, not settings.json: a register plugin's hook (scrooge's
    UserPromptSubmit/SessionStart, caveman's) injects its directive into EVERY
    child `claude --print` — including "normal" — only when its activation-state
    file is present. `hooks/scrooge-activate.js` injects nothing when
    `.scrooge-active` is absent (`if (state) emit(...)`), so removing the state
    file silences the hook without touching `settings.json`. This is critical:
    moving `settings.json` would also (a) drop the parent session's unrelated
    hooks and (b) — if the CLI default-enables marketplace plugins when
    `settings.json` is absent — risk RE-ENABLING a plugin into every arm. State-
    file removal avoids both. Without this, the user's own scrooge hook silently
    compresses the "neutral" baseline and (cross-lingually) corrupts the EN run.

    `isolate_settings=True` (opt-in, `--isolate-settings`) additionally moves
    `settings.json` for the rare case where a register hook is wired directly in
    `settings.json` rather than gated by a state file. Off by default.

    Concurrency safety: an atomic mkdir-based lock (`ISOLATION_LOCK_DIR`)
    serializes host isolation across processes — a second invocation fails fast
    with exit code 2 instead of clobbering the first process's backups. Backup
    paths carry the holder's PID so a stale lock dir can be diagnosed manually.

    Restoration is best-effort: if a parent-session hook re-creates a moved file
    mid-benchmark, we discard our stale backup instead of clobbering.
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

    claude = Path.home() / ".claude"
    targets = []
    if isolate_settings:
        targets.append((claude / "settings.json",
                        Path(f"/tmp/scrooge-bench-settings.json.{pid}.bak")))
    # Register activation-state files. Moving these silences register hooks
    # (scrooge injects nothing without .scrooge-active; caveman consults its flag)
    # without disturbing settings.json or plugin enablement.
    state_files = [claude / ".scrooge-active", claude / ".caveman-active"]
    state_files += sorted(claude.glob(".scrooge-active-*"))
    for sf in state_files:
        safe = re.sub(r"[^A-Za-z0-9.]+", "-", sf.name)
        targets.append((sf, Path(f"/tmp/scrooge-bench-{safe}.{pid}.bak")))
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


def _settings_caveman_active(path: Path) -> bool:
    """True only if settings.json *actively* wires caveman — an enabled plugin
    entry or a hook command referencing it. A disabled plugin entry
    (`"caveman@caveman": false`) or a marketplace registry entry is NOT active and
    must not block a clean run; the mere presence of the string "caveman" in the
    file (e.g. `extraKnownMarketplaces`) is not an injection channel.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    plugins = data.get("enabledPlugins")
    if isinstance(plugins, dict):
        for name, enabled in plugins.items():
            if "caveman" in str(name).lower() and enabled:
                return True
    hooks = data.get("hooks")
    if hooks is not None and "caveman" in json.dumps(hooks).lower():
        return True
    return False


def verify_register_clean(cwd: Path) -> list[tuple[str, str]]:
    """Scan the effective environment for register-hook activation channels —
    scrooge AND caveman. Returns a list of `(severity, message)`; empty = clean.

    Run this *after* `host_isolation` has moved register state files aside, so it
    confirms the isolation worked (no `.scrooge-active*` / `.caveman-active` left)
    and catches channels isolation does not move. Two severities, because "files
    present" is not the same as "actively injecting":

      - `blocking`  — an active state/hook channel that injects a register into
        every child `claude --print` right now: a present `.scrooge-active*` state
        file (scrooge's UPS/SessionStart hook would compress ALL arms — the bug
        that corrupted the first clean run), a `.caveman-active` flag, or
        host/project `settings.json` actively wiring caveman. A clean run must not
        proceed; isolation should have removed the state files.
      - `advisory`  — register files installed but only active once enabled via a
        hook channel: caveman plugin-marketplace install, skill symlink. Surfaced,
        not hard-blocked; the per-session `detect_contamination` is the
        authoritative backstop and excludes any row whose transcript shows a
        register injection regardless.

    The original 34/97 pollution (caveman) AND the scrooge-self-hook pollution
    (every arm got "SCROOGE 활성 …") both came from a register hook leaking into
    all arms; this is the pre-measurement gate recording "0 active channels".
    """
    home = Path.home()
    findings: list[tuple[str, str]] = []

    scrooge_states = [home / ".claude" / ".scrooge-active", cwd / ".scrooge-active"]
    scrooge_states += sorted((home / ".claude").glob(".scrooge-active-*"))
    for st in scrooge_states:
        if st.exists():
            findings.append(("blocking", f"scrooge register state active (hook will inject): {st}"))

    for settings in [home / ".claude" / "settings.json", cwd / ".claude" / "settings.json"]:
        if settings.exists() and _settings_caveman_active(settings):
            findings.append(("blocking", f"caveman actively wired in {settings}"))

    for flag in [home / ".claude" / ".caveman-active", cwd / ".caveman-active"]:
        if flag.exists():
            findings.append(("blocking", f"caveman state flag present: {flag}"))

    for hit in (home / ".claude" / "plugins").glob("marketplaces/*/plugins/caveman"):
        findings.append(("advisory", f"caveman plugin installed (inert unless enabled): {hit}"))

    for skills_dir in [home / ".claude" / "skills", home / ".claude" / ".agents"]:
        cav = skills_dir / "caveman"
        if cav.is_symlink() or cav.exists():
            findings.append(("advisory", f"caveman skill present (inert unless hooked): {cav}"))

    return findings


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
                    help="Skip moving register state files (.scrooge-active*, .caveman-active) "
                         "aside. Default: isolate, so host register hooks inject nothing.")
    ap.add_argument("--isolate-settings", action="store_true",
                    help="Also move ~/.claude/settings.json aside (heavy; drops the parent "
                         "session's hooks and risks plugin re-enable). Off by default — moving "
                         "register state files already silences register hooks.")
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
    ap.add_argument("--model", default=None,
                    help="Pin the model passed to `claude --print` (e.g. claude-opus-4-7). "
                         "Default: the CLI's configured model. Pin it for reproducible headline numbers.")
    ap.add_argument("--allow-contaminated", action="store_true",
                    help="Continue even if caveman activation channels are detected pre-run. "
                         "Off by default: a clean run aborts on any finding.")
    ap.add_argument("--disallow-tools", action="store_true",
                    help="Deny file-mutating tools (Write/Edit/NotebookEdit/Bash) so every arm "
                         "emits its answer inline. Use for document-generation corpora: otherwise "
                         "the model may write the doc to a file and emit only a 'wrote X.md' line, "
                         "collapsing the prose-only token count and faking compression.")
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
    isolation_verified = None

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
                            timeout=args.timeout, model=args.model,
                            isolation_verified=isolation_verified,
                            disallow_tools=args.disallow_tools)

    def write_result(idx, result):
        out.write(json.dumps(asdict(result), ensure_ascii=False) + "\n")
        out.flush()
        tok = result.output_tokens if result.output_tokens is not None else "—"
        err = f"  ERR: {result.error}" if result.error else ""
        print(f"  [{idx}/{total}] arm={result.arm} prompt={result.prompt_id} "
              f"run={result.run} tokens={tok} t={result.elapsed_s:.1f}s{err}",
              file=sys.stderr)

    with host_isolation(enabled=not args.no_isolate_host and not args.dry_run,
                        isolate_settings=args.isolate_settings):
        if not args.dry_run:
            findings = verify_register_clean(cwd_base)
            blocking = [m for sev, m in findings if sev == "blocking"]
            advisory = [m for sev, m in findings if sev == "advisory"]
            for m in advisory:
                print(f"[verify] advisory: {m}", file=sys.stderr)
            if blocking:
                print("error: register not clean — clean-run precondition failed:",
                      file=sys.stderr)
                for m in blocking:
                    print(f"  - {m}", file=sys.stderr)
                if not args.allow_contaminated:
                    print("Aborting. Isolation should have moved register state files aside; "
                          "a remaining .scrooge-active/.caveman-active means the move failed "
                          "(check the isolation lock) or you passed --no-isolate-host. Re-run "
                          "with isolation, or pass --allow-contaminated. The per-session check "
                          "still excludes any row that leaked.", file=sys.stderr)
                    return 2
                print("--allow-contaminated set; continuing despite blocking findings.",
                      file=sys.stderr)
                isolation_verified = False
            else:
                isolation_verified = True
                msg = "[verify] register clean — 0 active hook channels (scrooge + caveman)."
                if advisory:
                    msg += (f" ({len(advisory)} advisory install(s) noted above; "
                            "per-session check guards each row.)")
                print(msg, file=sys.stderr)
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
    # Remove the empty per-call cwd dirs created for parallel isolation. Only
    # the call-NNNN dirs we made, and only when empty (rmdir fails otherwise),
    # so any call that left debug output behind is preserved. resume is
    # unaffected: it keys off the output JSONL (load_success_keys), not these
    # dirs, which mkdir recreates each run.
    if args.workers > 1:
        for d in sorted(cwd_base.glob("call-*")):
            if d.is_dir() and d.name[len("call-"):].isdigit():
                try:
                    d.rmdir()
                except OSError:
                    pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
