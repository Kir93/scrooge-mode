#!/usr/bin/env python3
"""Regression tests for the two transcript counters that decide a run's validity.

Neither counts artifacts; both answer "is this run evidence at all". `compactions`
decides whether the post-compaction path was exercised, and `injections` decides
whether the register persisted or was simply re-asserted every turn — the one
distinction that separates this harness from measuring itself. A silent change to
either republishes the same numbers under a different claim, which is the reason
CI covers benchmark helpers that decide published numbers at all.

Collected by CI's `unittest discover -s benchmarks -p 'test_*.py'` on the file
name alone, so no `package.json` or workflow edit is involved.
"""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import unittest


def _load(name, rel):
    """Load a hyphenated sibling script (not importable by name)."""
    here = pathlib.Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


RUN = _load("_prun", "persistence-run.py")
BANNER = "SCROOGE MODE ACTIVE — ko/full + lean. Apply this register"


def hook_attachment(hook_name, text=BANNER):
    return {"type": "attachment",
            "attachment": {"type": "hook_success", "hookName": hook_name,
                           "stdout": json.dumps({"hookSpecificOutput": {
                               "additionalContext": text}}, ensure_ascii=False)}}


def compact_boundary():
    return {"type": "system", "subtype": "compact_boundary",
            "compactMetadata": {"preTokens": 64700}}


class TranscriptCounterCase(unittest.TestCase):
    """Writes a transcript where the counters look for one, via CLAUDE_CONFIG_DIR."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._prev = os.environ.get("CLAUDE_CONFIG_DIR")
        os.environ["CLAUDE_CONFIG_DIR"] = self._tmp.name
        self.cwd = pathlib.Path(self._tmp.name) / "bench-cwd"
        self.cwd.mkdir(parents=True)
        self.session = "11111111-2222-3333-4444-555555555555"

    def tearDown(self):
        if self._prev is None:
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        else:
            os.environ["CLAUDE_CONFIG_DIR"] = self._prev
        self._tmp.cleanup()

    def write(self, records):
        d = RUN.BENCH.cwd_session_dir(self.cwd)
        d.mkdir(parents=True, exist_ok=True)
        with (d / f"{self.session}.jsonl").open("w", encoding="utf-8") as out:
            for rec in records:
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")


class TestInjectionsSeen(TranscriptCounterCase):
    """One injection per session is persistence; one per turn is re-injection.

    Every turn of a run is a separate `claude --print --resume` process, so the
    answer depends on whether the CLI raises `SessionStart` on resume. Measured on
    CLI 2.1.220 it does not — a 22-turn bench session recorded exactly two,
    `SessionStart:startup` and `SessionStart:compact` — but that is CLI behavior
    this repo does not control, so the count is recorded per row instead of assumed.
    """

    def test_startup_plus_compaction_is_the_persistence_shape(self):
        self.write([hook_attachment("SessionStart:startup"),
                    compact_boundary(),
                    hook_attachment("SessionStart:compact")])
        self.assertEqual(RUN.injections_seen(self.cwd, self.session), 2)

    def test_one_injection_per_resume_is_counted_as_such(self):
        self.write([hook_attachment("SessionStart:startup")]
                   + [hook_attachment("SessionStart:resume") for _ in range(7)])
        self.assertEqual(RUN.injections_seen(self.cwd, self.session), 8)

    def test_a_hook_that_emitted_no_register_is_not_an_injection(self):
        # The per-turn UserPromptSubmit reminder is boundary-free and carries no
        # banner; counting it would make every turn look like a re-injection.
        self.write([hook_attachment("SessionStart:startup"),
                    hook_attachment("UserPromptSubmit", "SCROOGE 활성 (ko/full).")])
        self.assertEqual(RUN.injections_seen(self.cwd, self.session), 1)

    def test_no_transcript_claims_nothing(self):
        self.assertIsNone(RUN.injections_seen(self.cwd, self.session))


class TestCompactionsSeen(TranscriptCounterCase):
    """`--autocompact` sets a window; it does not trigger one.

    So a clean boundary-survival number means nothing until this says the session
    actually crossed it. Zero is reported as "not tested", never as "held".
    """

    def test_compact_boundaries_are_counted(self):
        self.write([hook_attachment("SessionStart:startup"),
                    compact_boundary(), compact_boundary()])
        self.assertEqual(RUN.compactions_seen(self.cwd, self.session), 2)

    def test_a_session_that_never_compacted_reads_zero_not_none(self):
        self.write([hook_attachment("SessionStart:startup")])
        self.assertEqual(RUN.compactions_seen(self.cwd, self.session), 0)

    def test_no_transcript_claims_nothing(self):
        self.assertIsNone(RUN.compactions_seen(self.cwd, self.session))


if __name__ == "__main__":
    unittest.main()
