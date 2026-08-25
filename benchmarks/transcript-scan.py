#!/usr/bin/env python3
"""Score the SHIPPED register's boundary behavior from transcripts already on disk.

The live harness (`persistence-run.py`) spends subscription quota to build a
synthetic session. This spends none: sessions where scrooge was actually active
are already recorded under `~/.claude/projects/**`, they ran under the real hooks
rather than a `--print` reconstruction of them, and their artifacts are real work
rather than corpus prompts. It re-runs for free as more accumulate.

What it measures, precisely: every `## Boundaries` artifact written while the
register was active, bucketed by how many user turns had passed since the last
time the FULL rule was injected. Three classes, each with a STRUCTURAL fence —
no `=== OUTPUT ===` marker needed, because the artifact is a whole tool argument
rather than prose the model has to be asked to delimit:

  - `commit`   — the body of `git commit -m` (permanently excluded)
  - `pr`       — the body behind `gh pr create/edit --body`/`--body-file`
                 (permanently excluded); `--body-file` is resolved back to the
                 `Write`/heredoc that produced the file earlier in the session
  - `outbound` — the `text` of a Slack MCP send (Docs·prose: padding stripped,
                 tone kept, so 음슴체 in one IS the violation)

Why turns-since-injection is the axis: the per-turn `UserPromptSubmit` reminder is
boundary-FREE (`hooks/lang-meta.js`), so between full injections the model is
running on a reminder that never mentions commit messages. The full rule returns
at every `SessionStart`, compaction included. So the question the data can answer
is "does the boundary hold across N turns of boundary-free reminders", and N is
bounded in practice — measured p99 = 22 user turns, max 33.

Read `scorable=` before reading `violations=`. A single-line Korean commit SUBJECT
(`type: 한글 설명`, the format most repos here enforce) carries no sentence ending
for the scorer to judge, so it cannot produce a violation whatever the register
did. Counting those into a clean rate turns "0 violations" into a near-tautology,
which is why the summary reports the prose-shaped subset separately.

Privacy: rows carry verbatim commit messages, PR bodies, and Slack text from EVERY
project on this machine, most of them not this repo's. `--output` is a local
diagnostic — scrub before publishing anything derived from it (`scrub.js`), and do
not commit the raw file.

usage:
  benchmarks/transcript-scan.py [--projects-dir DIR] [--output scored.jsonl]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


SCORE = _load("_ts_score", "persistence-score.py")
BENCH = _load("_ts_run", "run.py")

# The full-rule injection banner (`buildFullInjection` in hooks/scrooge-activate.js),
# emitted at every SessionStart — start, resume, compaction — and on an activation
# turn. Matched only inside a hook's own recorded output: see `is_injection`.
FULL_INJECTION = "SCROOGE MODE ACTIVE"
# `SCROOGE OFF — …`, the deactivation countermand (`buildCountermand` in
# hooks/lang-meta.js, same prefix in all five languages). Without it `active`
# latches on for the rest of the transcript and artifacts written AFTER the user
# turned the register off score as if it were still on.
DEACTIVATION = "SCROOGE OFF"
# The banner names the register: `SCROOGE MODE ACTIVE — ko/full + lean.` The
# separator is matched as a bounded gap rather than a literal em-dash: the record
# is read as serialized JSON, and a host that escapes non-ASCII writes `\u2014`
# there instead of the character.
BANNER_LANG_RE = re.compile(r"SCROOGE MODE ACTIVE.{0,20}?\b(?P<lang>[a-z]{2})/[a-z]+")
# `git commit -m "..."` / -m '...' in a Bash tool_use input. Captures the body.
COMMIT_RE = re.compile(r"""git\s+commit\b[^\n]*?-m\s+(?P<q>["'])(?P<body>.+?)(?<!\\)(?P=q)""", re.S)
# PR bodies. Measured over this machine's transcripts, `--body-file` is how they
# are actually written (129 of 163 `gh pr create/edit` calls), so the file has to
# be resolved back to its writer or the whole PR class scans as zero.
PR_BODY_FILE_RE = re.compile(r"gh\s+pr\s+(?:create|edit)\b[^\n]*?--body-file\s+(?P<path>\S+)")
PR_BODY_RE = re.compile(r"""gh\s+pr\s+(?:create|edit)\b[^\n]*?--body\s+(?P<q>["'])(?P<body>.+?)(?<!\\)(?P=q)""", re.S)
# `cat > file <<'EOF' ... EOF` — the other way a body file gets written.
HEREDOC_WRITE_RE = re.compile(r"cat\s*>\s*(?P<path>\S+)\s*<<\s*'?(?P<tag>\w+)'?\n(?P<body>.*?)\n(?P=tag)", re.S)
# Slack MCP send tools are namespaced per install, so match the operation name.
SLACK_SEND = "slack_send_message"
SLACK_TEXT_KEYS = ("text", "markdown_text", "message", "content")
# An artifact shaped like prose: more than one line, or a sentence ending. Only
# these can carry the endings the scorer looks for.
PROSE_RE = re.compile(r"[.!?](?:\s|$)")


def iter_records(path: Path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            yield json.loads(line)
        except ValueError:
            continue


def hook_context(rec: dict) -> str | None:
    """The text a hook emitted in this record, if it is a hook record at all."""
    if rec.get("type") != "attachment":
        return None
    att = rec.get("attachment")
    if not isinstance(att, dict) or att.get("type") != "hook_success":
        return None
    return json.dumps(att, ensure_ascii=False)


def is_injection(rec: dict) -> bool:
    """Did a HOOK emit the full rule here?

    Scoped to the hook's own `hook_success` attachment rather than "the banner
    appears anywhere in this record". Any session that works ON this repo quotes
    the banner — in an assistant message, in a `cat hooks/*.js` tool result, in a
    grep hit. Measured across this machine: 96 such records, every one of which
    a substring test would have read as a fresh injection, resetting drift to 0
    and (because the loop skips an injection record) dropping any commit made in
    the same assistant turn.
    """
    ctx = hook_context(rec)
    return bool(ctx) and FULL_INJECTION in ctx


def is_deactivation(rec: dict) -> bool:
    """Did a hook emit the `/scrooge off` countermand here?"""
    ctx = hook_context(rec)
    return bool(ctx) and DEACTIVATION in ctx


def injection_lang(rec: dict) -> str | None:
    """The register language named by this record's injection banner."""
    ctx = hook_context(rec) or ""
    m = BANNER_LANG_RE.search(ctx)
    return m.group("lang") if m else None


def tool_uses(rec: dict):
    """Every tool_use block in an assistant record, as (name, input)."""
    msg = rec.get("message")
    if not isinstance(msg, dict):
        return
    for block in msg.get("content") or []:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        yield block.get("name") or "", block.get("input") or {}


def is_real_user_turn(rec: dict) -> bool:
    """A person typing, not a tool result.

    Claude Code records tool results as `type: "user"` too, so counting every one
    inflates the drift depth by the whole tool round trip — measured p50 jumped
    from 1 to 50 before this filter, which would have made the deep end look far
    deeper than any session actually gets.
    """
    msg = rec.get("message")
    if not isinstance(msg, dict):
        return False
    content = msg.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if not isinstance(content, list):
        return False
    return any(
        isinstance(b, dict) and b.get("type") == "text" and str(b.get("text", "")).strip()
        for b in content
    )


def artifacts_in(name: str, inp: dict, files: dict[str, str]):
    """Boundary artifacts in one tool_use, as (class, body). Records file writes."""
    if name in ("Write", "NotebookEdit") and isinstance(inp.get("file_path"), str):
        content = inp.get("content")
        if isinstance(content, str):
            files[inp["file_path"]] = content
        return
    if SLACK_SEND in name:
        for key in SLACK_TEXT_KEYS:
            value = inp.get(key)
            if isinstance(value, str) and value.strip():
                yield "outbound", value.strip()
                return
        return
    if name != "Bash":
        return
    cmd = inp.get("command")
    if not isinstance(cmd, str):
        return
    for m in HEREDOC_WRITE_RE.finditer(cmd):
        files[m.group("path")] = m.group("body")
    for m in COMMIT_RE.finditer(cmd):
        body = m.group("body").replace("\\n", "\n").strip()
        if body:
            yield "commit", body
    for m in PR_BODY_RE.finditer(cmd):
        body = m.group("body").replace("\\n", "\n").strip()
        if body:
            yield "pr", body
    for m in PR_BODY_FILE_RE.finditer(cmd):
        body = (files.get(m.group("path")) or "").strip()
        if body:
            yield "pr", body


def scan_session(path: Path) -> list[dict]:
    """Boundary artifacts in one transcript, each with its drift depth.

    `drift` = user turns since the last full-rule injection. 0 means the rule was
    injected on this very turn.
    """
    rows: list[dict] = []
    files: dict[str, str] = {}
    active = False
    lang = None
    turns_since = 0
    for rec in iter_records(path):
        if is_injection(rec):
            active = True
            lang = injection_lang(rec) or lang
            turns_since = 0
            continue
        if is_deactivation(rec):
            active = False
            continue
        if rec.get("type") == "user":
            if is_real_user_turn(rec):
                turns_since += 1
            continue
        if rec.get("type") != "assistant":
            continue
        for name, inp in tool_uses(rec):
            # File writes are tracked whether or not the register is active yet:
            # a PR body is written before the `gh` call, sometimes turns before.
            for kind, body in artifacts_in(name, inp, files):
                if not active:
                    continue
                rows.append({
                    "session": path.stem,
                    "project": path.parent.name,
                    "class": kind,
                    "lang": lang,
                    "drift_turns": turns_since,
                    "artifact": body,
                    # Whether this artifact can carry a sentence ending at all.
                    # A single-line commit subject cannot, so it cannot violate.
                    "prose_shaped": "\n" in body or bool(PROSE_RE.search(body)),
                    # No `=== OUTPUT ===` fence in real work, so score the body
                    # directly — each class here IS a whole tool argument, with no
                    # room for the trailing meta that made the fence necessary.
                    **SCORE.score(body),
                })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--projects-dir", type=Path,
                    default=BENCH.claude_config_dir() / "projects",
                    help="Claude Code transcript root. Default: <config dir>/projects.")
    ap.add_argument("--output", type=Path,
                    help="Scored JSONL. Default: summary only. Carries verbatim "
                         "artifacts from every project on this machine — local "
                         "diagnostic, not something to commit unscrubbed.")
    ap.add_argument("--min-drift", type=int, default=0,
                    help="Only report artifacts at least this many turns after the "
                         "last full injection. Use it to look at the deep end.")
    args = ap.parse_args()

    if not args.projects_dir.is_dir():
        print(f"no transcript root at {args.projects_dir}", file=sys.stderr)
        return 2

    rows: list[dict] = []
    sessions = 0
    for path in sorted(args.projects_dir.rglob("*.jsonl")):
        found = scan_session(path)
        if found:
            sessions += 1
            rows.extend(found)

    # `persistence-score.py` only knows Korean endings, so a session running an
    # en/ja/hi/zh register would come back clean by construction. Dropped, and
    # counted, rather than pooled into a rate they cannot move.
    non_ko = [r for r in rows if r["lang"] not in (None, "ko")]
    rows = [r for r in rows if r["lang"] in (None, "ko")]
    rows = [r for r in rows if r["drift_turns"] >= args.min_drift]
    if args.output:
        with args.output.open("w", encoding="utf-8") as out:
            for r in rows:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")

    violations = [r for r in rows if r["violated"]]
    scorable = [r for r in rows if r["prose_shaped"]]
    deep = [r for r in rows if r["drift_turns"] >= 10]
    depths = sorted(r["drift_turns"] for r in rows)
    by_class: dict[str, list[dict]] = {}
    for r in rows:
        by_class.setdefault(r["class"], []).append(r)
    print(f"sessions={sessions} artifacts={len(rows)} scorable={len(scorable)} "
          f"violations={len(violations)}", file=sys.stderr)
    for kind in sorted(by_class):
        group = by_class[kind]
        print(f"  {kind}: n={len(group)} "
              f"scorable={sum(1 for r in group if r['prose_shaped'])} "
              f"violations={sum(1 for r in group if r['violated'])}", file=sys.stderr)
    if rows and len(scorable) < len(rows):
        print(f"  ^ {len(rows) - len(scorable)} artifact(s) are single-line with no "
              "sentence ending — they cannot carry a leak the scorer can see, so "
              "they are not evidence either way. Read `violations` against "
              "`scorable`, not against `artifacts`.", file=sys.stderr)
    # Outbound is the one class whose correct voice is 존댓말 (`## Boundaries`:
    # Docs·prose keeps 어조·존댓말). An artifact there that reads as uncompressed only
    # because it is 평서형 carries no compression leak — `violated` is right to be
    # false — but it is not in the voice the class asks for either, and nothing else
    # would ever say so.
    plain_outbound = [r for r in rows
                      if r["class"] == "outbound" and r.get("uncompressed_by") == "plain"]
    if plain_outbound:
        print(f"  ^ {len(plain_outbound)} outbound artifact(s) read as uncompressed only "
              "via 평서형, not 존댓말 — no compression leak, but not the voice the "
              "Docs·prose class asks for either.", file=sys.stderr)
    if non_ko:
        print(f"  ^ {len(non_ko)} artifact(s) skipped from non-ko sessions — the "
              "scorer reads Korean endings only.", file=sys.stderr)
    if depths:
        p = lambda q: depths[min(len(depths) - 1, int(len(depths) * q))]
        print(f"drift_turns: p50={p(0.5)} p90={p(0.9)} p99={p(0.99)} max={depths[-1]} "
              f"(>=10 turns: {len(deep)})", file=sys.stderr)
    for r in violations[:10]:
        print(f"  VIOLATION [{r['class']}] drift={r['drift_turns']} {r['violations']} "
              f"{r['artifact'][:70]}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
