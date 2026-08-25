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
  scrooge:LANG/DIAL+FLAG       — base rule + flag fragment(s), mirroring the hook's
                                 assembleRuleBody (e.g. scrooge:ko/full+lean). Stack
                                 with `+`: scrooge:en/full+lean+ctx.
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
import random
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
# Default bench cwd lives OUTSIDE the repo: an empty dir means no project
# CLAUDE.md leaks into context (see build_cmd docstring) and bench session
# JSONL stays out of the repo's interactive session list.
DEFAULT_BENCH_CWD = Path.home() / ".cache" / "scrooge-bench"


def claude_config_dir() -> Path:
    """Where Claude Code keeps config, state, and transcripts.

    Mirrors `claudeDir()` in hooks/scrooge-config.js: CLAUDE_CONFIG_DIR wins over
    ~/.claude. Every path in this module that reaches into the config dir must go
    through here — a hardcoded ~/.claude means that on a host with the override
    set, isolation moves nothing, verification finds nothing to block, and the
    user's own register hook injects into every arm while the row still says
    `isolation_verified: true`.

    A function rather than a module constant so a test can set the env var; a
    constant would be frozen at import time.
    """
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude"))

TERSE_CONTROL_SYSTEM = (
    "Answer concisely. Respond in the language the user writes in. Keep all "
    "technical substance and required reasoning."
)


# ---------------------------------------------------------------------------
# Arm rule-text resolution
# ---------------------------------------------------------------------------

# The model every new measurement runs on. This is the *policy*, expressed as a
# default rather than a note: leaving --model unset used to fall through to the
# CLI's configured model, which is how the published tables silently ended up on
# claude-opus-4-8 months after Claude Code moved to Opus 5. A doc line did not stop
# that; a default does.
#
# Pin to the newest Opus, which is also Claude Code's default — that is the model
# users actually run the register on. Do NOT point this at a non-default tier
# (claude-fable-5): different tier, different price, not what the product runs on.
# When a newer Opus ships, change this one line; benchmarks/README.md documents the
# re-measurement policy and tests/test_report_stats.py asserts the two agree.
LATEST_OPUS = "claude-opus-5"


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
        # Optional `+flag` suffixes append register fragments, mirroring the hook's
        # assembleRuleBody (base rule + active flag fragments). e.g.
        # scrooge:ko/full+lean measures the lean code-output register against base.
        dial_spec, *flags = rest.split("+")
        if "/" not in dial_spec:
            raise ValueError(f"scrooge arm needs LANG/DIAL, got {spec!r}")
        lang, dial = dial_spec.split("/", 1)
        text = _read_text(RULES_DIR / lang / f"{dial}.md")
        for flag in flags:
            text += "\n\n" + _read_text(RULES_DIR / lang / "fragments" / f"{flag}.md")
        return spec, text
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
        claude_config_dir() / "skills" / "caveman" / "SKILL.md",
        *Path(claude_config_dir() / "plugins").glob(
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
    # Wall clock for the whole call INCLUDING any failed attempts and their
    # backoff, not the successful attempt alone.
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
    # Transport-failure cause as the CLI reported it (plain stdout/stderr under
    # the default text format, or the unwrapped `result` of a result envelope).
    # `error` stays the human line; this is the reason on its own.
    failure_reason: Optional[str] = None


NORMAL_BASELINE_SYSTEM = (
    "You are a helpful technical assistant. Respond in the language the user "
    "writes in. Provide complete, accurate technical answers."
)


def build_cmd(rule_text: str, prompt: str, model: Optional[str] = None,
              disallow_tools: bool = False,
              system_prompt_mode: str = "replace") -> list[str]:
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
    if system_prompt_mode == "append":
        # Agentic mode. `--system-prompt` REPLACES Claude Code's system prompt,
        # which strips the tool-use scaffolding an agentic run needs — the model
        # is left without the instructions that make it act on a repo. `--append`
        # keeps that scaffolding and adds the register on top, which is also what
        # a real `/scrooge` session looks like.
        #
        # It is NOT the isolation the conversational corpus uses, and the two are
        # not comparable: the host prompt is present in every arm here, so this
        # measures the register's marginal effect on top of it rather than the
        # register alone. Kept behind a flag, defaulting to `replace`, so no
        # published number moves.
        cmd = ["claude", "--print"]
        if rule_text:
            cmd += ["--append-system-prompt", rule_text]
    else:
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
    return claude_config_dir() / "projects" / slug


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


# Transport-failure retry. One measured run lost 21 of 30 calls to a 529 burst:
# the CLI writes a well-formed JSON envelope on stdout (`is_error: true`,
# `result: "API Error: 529 Overloaded..."`) AND exits non-zero, so reading stderr
# first left the cause in the JSONL as a bare `exit=1`. Bounded on both axes —
# subscription quota is the scarce resource, and a retry storm burns it. This is a
# per-call layer, one level below `agentic-run.sh --resume`, which re-runs whole
# missing pairs after the fact.
RETRY_ATTEMPTS = 3  # total attempts per call, i.e. two retries
RETRY_BASE_DELAY_S = 2.0  # 2s then 4s, plus jitter
RETRY_JITTER = 0.25  # +-25%: --workers>1 threads fail on the same burst, and an
                     # exact backoff would send them all back at the same instant


def retry_delay(attempt: int) -> float:
    """Exponential backoff with jitter. `attempt` is 1-based.

    No cap: RETRY_ATTEMPTS bounds the sequence at 2s then 4s, so a ceiling would
    guard a state this module cannot reach. Raising RETRY_ATTEMPTS is what would
    need one.
    """
    base = RETRY_BASE_DELAY_S * 2 ** (attempt - 1)
    return base * (1 + random.uniform(-RETRY_JITTER, RETRY_JITTER))


def extract_failure_reason(stdout: Optional[str], stderr: Optional[str]) -> Optional[str]:
    """Recover the cause of a failed call from whatever the CLI actually wrote.

    `build_cmd` does not pass `--output-format`, so `claude --print` writes plain
    text and an API failure lands on stdout or stderr as a bare line. The JSON
    branch is still first because the CLI wraps some failures in its result
    envelope (`is_error: true`, `result: "API Error: 529 Overloaded..."`), where
    the cause is in `result` and everything else is noise. Returns None only when
    both streams are empty — a crash with nothing to report.
    """
    for stream in (stdout, stderr):
        if not stream or not stream.strip():
            continue
        try:
            payload = json.loads(stream)
        except ValueError:
            return stream.strip()
        if isinstance(payload, dict):
            reason = payload.get("result")
            if isinstance(reason, str) and reason.strip():
                return reason.strip()
        return stream.strip()
    return None


def is_retryable(error: Optional[str]) -> bool:
    """Whether a failed call is worth another attempt.

    Same shape as `is_session_limit` below — error string in, verdict out, no I/O
    — so both are unit-testable. Retries transient server/transport states
    (429 / 5xx incl. 529, timeout) and nothing else: a 401 never recovers on its
    own, a malformed prompt is a 400 forever, and a subscription quota limit does
    not clear inside a backoff window. Retrying any of those only burns quota.

    `is_session_limit` wins on overlap: a 429 that names a session/usage/rate
    limit is quota exhaustion wearing an HTTP code, and the run stops early for it.
    """
    if not error:
        return False
    if is_session_limit(error):
        return False
    lowered = error.lower()
    if "timeout" in lowered:
        return True
    # Anchored on the code's own context word: `error` carries up to 400 chars of
    # raw CLI output, where a bare 3-digit match would also hit a stack-trace line
    # number or an id and spend two extra calls on a permanent failure.
    return bool(re.search(r"(?:error|status|code|http)[^a-z0-9]{0,8}(?:429|5\d\d)\b", lowered))


def call_with_retry(make_cmd, cwd: Path, timeout: int, label: str = "",
                    retryable=None):
    """Run the CLI under the bounded retry policy above.

    Returns `(completed_process | None, error, reason)`; on success the error and
    reason are None. `make_cmd(attempt)` builds the argv per attempt rather than
    once, so a caller whose first attempt allocates something (a session id) can
    retry with a fresh one instead of colliding with what it just used.

    Every runner in this directory goes through here. Copying the loop instead
    would let one copy drift: the attempt bound, the both-streams retry verdict,
    and the backoff are the parts that decide whether a 529 burst costs a row or
    the whole run.

    `retryable` overrides the default verdict for a caller whose retry is not
    always safe. A stateless single-shot call can retry anything transient; a call
    that mutates a live session cannot retry a TIMEOUT, because a timeout says the
    local process died, not that the remote turn was never applied.
    """
    decide = retryable or is_retryable
    proc = error = reason = signal = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        cmd = make_cmd(attempt)
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=timeout, cwd=cwd)
        except subprocess.TimeoutExpired:
            proc, error, reason, signal = None, "timeout", None, "timeout"
        else:
            if proc.returncode == 0:
                return proc, None, None
            reason = extract_failure_reason(proc.stdout, proc.stderr)
            error = f"claude exit {proc.returncode}: {(reason or '')[:400]}"
            # The retry verdict reads BOTH streams, not just the one the reason
            # came from: a 529 on stderr behind an unrelated line on stdout would
            # otherwise classify as permanent and lose the row the retry exists
            # to save.
            signal = f"{error}\n{proc.stdout or ''}\n{proc.stderr or ''}"
        if attempt == RETRY_ATTEMPTS or not decide(signal):
            break
        delay = retry_delay(attempt)
        print(f"  [retry {attempt}/{RETRY_ATTEMPTS - 1}] {label}: {error[:120]} "
              f"- waiting {delay:.0f}s", file=sys.stderr)
        time.sleep(delay)
    return None, error, reason


def run_one(arm: str, rule_text: str, prompt: str, prompt_id: int, run: int,
            cwd: Path, dry_run: bool, timeout: int, model: Optional[str] = None,
            isolation_verified: Optional[bool] = None,
            disallow_tools: bool = False,
            system_prompt_mode: str = "replace") -> RunResult:
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
        if "+lean" in arm:
            ratio *= 0.85  # lean trims code output further (smoke-test illustration)
        fake_tokens = max(40, int(base * ratio))
        fake_text = f"[dry-run] {arm} prompt={prompt_id} run={run}"
        return RunResult(arm=arm, prompt_id=prompt_id, run=run,
                         output_tokens=fake_tokens, cache_read_tokens=0,
                         model="dry-run", elapsed_s=time.monotonic() - start,
                         session_file=None, output_chars=len(fake_text),
                         output_text=fake_text, tool_use_output_tokens=0,
                         total_output_tokens=fake_tokens, raw_output_tokens=fake_tokens,
                         turns=1, isolation_verified=isolation_verified)

    cmd = build_cmd(rule_text, prompt, model, disallow_tools, system_prompt_mode)
    r, error, reason = call_with_retry(
        lambda _attempt: cmd, cwd, timeout,
        label=f"arm={arm} prompt={prompt_id} run={run}")

    elapsed = time.monotonic() - start
    if error:
        return RunResult(arm=arm, prompt_id=prompt_id, run=run, output_tokens=None,
                         cache_read_tokens=None, model=None, elapsed_s=elapsed,
                         session_file=None,
                         error=error, failure_reason=reason[:400] if reason else None)

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


def _neutralize_ultracode(settings: Path, pid: int) -> Optional[tuple[Path, Path]]:
    """Turn `ultracode` off in the host settings.json for the duration of a run.

    This is isolation, not a preference. `ultracode: true` tells EVERY session —
    including a `claude --print` child — to author a multi-agent workflow for any
    substantive task. The child announces the delegation, tries to spawn subagents,
    and dies mid-response in --print mode ("API Error: Connection closed"). It hits
    the `normal` baseline hardest, because the compressed arms' register suppresses
    delegation: measured on the 2026-08-06 re-measure, normal completed 8/19 with it
    on and 19/19 with it off, while the scrooge arm was ~unaffected. Leaving it on
    therefore does not add noise — it silently selects for the baseline answers that
    happened NOT to delegate, and inflates the baseline of the ones that partially
    did (KO p0: 7446 tokens with it on, 4157 with it off).

    Only this one key is rewritten. `--isolate-settings` moves the whole file, which
    also drops `enabledPlugins` and risks re-enabling marketplace plugins into every
    arm — see host_isolation's docstring.
    """
    if not settings.exists():
        return None
    try:
        data = json.loads(settings.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not data.get("ultracode"):
        return None
    backup = Path(f"/tmp/scrooge-bench-settings-ultracode.{pid}.bak")
    if backup.exists():
        raise RuntimeError(
            f"refusing to clobber existing backup {backup}; resolve manually "
            f"before re-running"
        )
    shutil.copy2(str(settings), str(backup))
    data["ultracode"] = False
    settings.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(f"[isolation] ultracode disabled in {settings} for this run "
          f"(backup {backup})", file=sys.stderr)
    return (settings, backup)


def check_register_clean(cwd: Path, allow_contaminated: bool = False,
                         per_row_backstop: bool = True) -> Optional[bool]:
    """Preflight for a measured run: report findings, abort on a blocking one.

    Returns the `isolation_verified` value to record on each row, or None when the
    caller must abort (blocking findings without `--allow-contaminated`).

    Every runner in this directory needs this, not just `run.py` — the user's own
    scrooge hook injects its register into EVERY child `claude --print` while a
    state file is present, which silently compresses the `normal` arm and, for a
    persistence run, re-injects the very register whose survival is the question.
    Call it inside a `host_isolation(...)` block, which is what moves those state
    files aside; this then confirms the move worked.

    `per_row_backstop=False` for a caller that does NOT run `detect_contamination`
    per row (`persistence-run.py` drives its own turns). The message must not
    promise a row-level exclusion the caller cannot perform — a user who reads it
    and passes `--allow-contaminated` would keep every leaked row.
    """
    findings = verify_register_clean(cwd)
    blocking = [m for sev, m in findings if sev == "blocking"]
    advisory = [m for sev, m in findings if sev == "advisory"]
    for m in advisory:
        print(f"[verify] advisory: {m}", file=sys.stderr)
    if blocking:
        print("error: register not clean — clean-run precondition failed:", file=sys.stderr)
        for m in blocking:
            print(f"  - {m}", file=sys.stderr)
        if not allow_contaminated:
            tail = ("The per-session check still excludes any row that leaked."
                    if per_row_backstop else
                    "This caller has NO per-row contamination backstop, so every row "
                    "would keep the leak.")
            print("Aborting. Isolation should have moved register state files aside; "
                  "a remaining .scrooge-active/.caveman-active means the move failed "
                  "(check the isolation lock) or you passed --no-isolate-host. Re-run "
                  f"with isolation, or pass --allow-contaminated. {tail}", file=sys.stderr)
            return None
        print("--allow-contaminated set; continuing despite blocking findings.", file=sys.stderr)
        return False
    msg = "[verify] register clean — 0 active hook channels (scrooge + caveman)."
    if advisory:
        msg += (f" ({len(advisory)} advisory install(s) noted above; "
                + ("per-session check guards each row.)" if per_row_backstop
                   else "this caller has no per-row backstop.)"))
    print(msg, file=sys.stderr)
    return True


@contextlib.contextmanager
def host_isolation(enabled: bool, isolate_settings: bool = False):
    """Neutralize host register hooks for the benchmark by moving their *state
    files* aside (`~/.claude/.scrooge/{global,default,sessions/*}`, the legacy
    root-level `.scrooge-active*` dotfiles, and `~/.claude/.caveman-active`).

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

    claude = claude_config_dir()
    targets = []
    if isolate_settings:
        targets.append((claude / "settings.json",
                        Path(f"/tmp/scrooge-bench-settings.json.{pid}.bak")))
    # Register activation-state files. Moving these silences register hooks
    # (scrooge injects nothing without .scrooge-active / .scrooge-default; caveman
    # consults its flag) without disturbing settings.json or plugin enablement.
    # .scrooge-default is the global activation default: a fresh session's
    # SessionStart seeds from it, so it must move aside too or it re-activates the
    # register inside the benchmark child and contaminates the run.
    # Both state generations: the current ~/.claude/.scrooge/ subdir layout and
    # the legacy root-level dotfiles (a host running an older scrooge still
    # writes there; the hooks fold legacy → subdir, so cover both).
    scrooge_dir = claude / ".scrooge"
    state_files = [
        scrooge_dir / "global", scrooge_dir / "default",
        claude / ".scrooge-active", claude / ".scrooge-default",
        claude / ".caveman-active",
    ]
    state_files += sorted(scrooge_dir.glob("sessions/*"))
    state_files += sorted(claude.glob(".scrooge-active-*"))
    for sf in state_files:
        safe = re.sub(r"[^A-Za-z0-9.]+", "-", str(sf.relative_to(claude)))
        targets.append((sf, Path(f"/tmp/scrooge-bench-{safe}.{pid}.bak")))
    moved = []
    settings_edit = None
    try:
        settings_edit = _neutralize_ultracode(claude / "settings.json", pid)
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
        if settings_edit:
            live, backup = settings_edit
            shutil.move(str(backup), str(live))
            print(f"[isolation] restored {live} (ultracode)", file=sys.stderr)
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
    cfg = claude_config_dir()
    findings: list[tuple[str, str]] = []

    scrooge_states = [
        cfg / ".scrooge" / "global",
        cfg / ".scrooge" / "default",
        cfg / ".scrooge-active",
        cfg / ".scrooge-default",
        cwd / ".scrooge" / "global",
        cwd / ".scrooge-active",
    ]
    scrooge_states += sorted((cfg / ".scrooge").glob("sessions/*"))
    scrooge_states += sorted(cfg.glob(".scrooge-active-*"))
    for st in scrooge_states:
        if st.exists():
            findings.append(("blocking", f"scrooge register state active (hook will inject): {st}"))

    for settings in [cfg / "settings.json", cwd / ".claude" / "settings.json"]:
        if settings.exists() and _settings_caveman_active(settings):
            findings.append(("blocking", f"caveman actively wired in {settings}"))

    for flag in [cfg / ".caveman-active", cwd / ".caveman-active"]:
        if flag.exists():
            findings.append(("blocking", f"caveman state flag present: {flag}"))

    for hit in (cfg / "plugins").glob("marketplaces/*/plugins/caveman"):
        findings.append(("advisory", f"caveman plugin installed (inert unless enabled): {hit}"))

    for skills_dir in [cfg / "skills", cfg / ".agents"]:
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
    ap.add_argument("--cwd", type=Path, default=DEFAULT_BENCH_CWD,
                    help="Working dir for claude invocation. Default ~/.cache/scrooge-bench "
                         "(empty dir: no project CLAUDE.md pollution, bench sessions stay "
                         "out of the repo's session list).")
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
    ap.add_argument("--model", default=LATEST_OPUS,
                    help=f"Model passed to `claude --print`. Default {LATEST_OPUS} — the newest "
                         "Opus, which is Claude Code's default and the model users actually run "
                         "the register on. Override only to reproduce an older published number; "
                         "every row records the model the API actually served.")
    ap.add_argument("--allow-contaminated", action="store_true",
                    help="Continue even if caveman activation channels are detected pre-run. "
                         "Off by default: a clean run aborts on any finding.")
    ap.add_argument("--system-prompt-mode", choices=["replace", "append"], default="replace",
                    help="How the register reaches the model. 'replace' (default) swaps out Claude "
                         "Code's system prompt so the register is the only system-level instruction "
                         "— the isolation every published conversational number uses. 'append' keeps "
                         "the host prompt and adds the register on top: required for agentic corpora "
                         "(replacing it strips the tool-use scaffolding) and closer to a real session, "
                         "but NOT comparable to the isolated numbers.")
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
                            disallow_tools=args.disallow_tools,
                            system_prompt_mode=args.system_prompt_mode)

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
            isolation_verified = check_register_clean(cwd_base, args.allow_contaminated)
            if isolation_verified is None:
                return 2
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
    #
    # Each per-call cwd also gets its own ~/.claude/projects/<slug>/ transcript
    # dir, so without this a parallel run leaves one stale project entry per call
    # behind in the interactive session list (hundreds after a few runs). Drop
    # them once the run is over: every measurement they held has already been
    # extracted into the output JSONL. The path is derived from a call-NNNN dir we
    # created ourselves, so nothing outside this run's own slugs is reachable.
    if args.workers > 1:
        for d in sorted(cwd_base.glob("call-*")):
            if d.is_dir() and d.name[len("call-"):].isdigit():
                try:
                    d.rmdir()
                except OSError:
                    pass
                shutil.rmtree(cwd_session_dir(d), ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
