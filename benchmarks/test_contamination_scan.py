#!/usr/bin/env python3
"""Unit tests for run.py's per-row contamination detector.

Run: python3 -m unittest discover -s benchmarks -p 'test_*.py'

Why this file exists: the detector scans a session transcript for a competing
register's name, but the transcript also records the register text the harness
itself injected via `--system-prompt`. A register file that NAMES a competitor to
contrast with it therefore excluded its own arm — measured 2026-09-16, all 11
`scrooge:zh/full` rows dropped (`rules/zh/full.md` says "caveman 走文言方向,
scrooge zh 不走"), leaving zero pairs and making the zh register unmeasurable.

The fix subtracts only the injected text, so the tests that matter are the ones
pinning that the net is still up everywhere else: a competitor name arriving
through any OTHER channel must still be caught.
"""

import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from run import detect_contamination  # noqa: E402

# Shaped like a real transcript line: the injected prompt lands at
# `attachment.systemPrompt[0]` (measured — see the module docstring).
OWN_RULE = (
    "# ZH · full\n\nRespond in compressed Chinese.\n"
    "- 现代简洁体。caveman 走文言方向"
    ",scrooge zh 不走。\n"
)


def _session(lines):
    tmp = tempfile.NamedTemporaryFile(
        "w", suffix=".jsonl", delete=False, encoding="utf-8"
    )
    for obj in lines:
        tmp.write(json.dumps(obj, ensure_ascii=False) + "\n")
    tmp.close()
    return pathlib.Path(tmp.name)


def _system_prompt_line(text):
    return {"type": "attachment", "cwd": "/tmp/x", "gitBranch": "main",
            "attachment": {"systemPrompt": [text]}}


def _user_line(text):
    return {"type": "user", "cwd": "/tmp/x",
            "message": {"role": "user", "content": text}}


class TestOwnSystemPromptIsNotContamination(unittest.TestCase):
    def test_own_rule_naming_a_competitor_is_clean(self):
        path = _session([_system_prompt_line(OWN_RULE)])
        self.assertIsNone(
            detect_contamination(path, "scrooge:zh/full", OWN_RULE),
            "a register naming a competitor in its own injected text is not a leak",
        )

    def test_trailing_newline_difference_still_subtracts(self):
        # The transcript stores the file minus its trailing newline (measured:
        # 4105 chars on disk, 4104 in `systemPrompt`), so the match must be
        # whitespace-insensitive at the edges or the fix silently does nothing.
        path = _session([_system_prompt_line(OWN_RULE.rstrip("\n"))])
        self.assertIsNone(
            detect_contamination(path, "scrooge:zh/full", OWN_RULE),
        )

    def test_without_own_system_the_same_line_is_still_flagged(self):
        # Red-first anchor: proves `systemPrompt` is really what trips the
        # detector, so the test above is passing because of the subtraction and
        # not because the fixture was toothless.
        path = _session([_system_prompt_line(OWN_RULE)])
        self.assertEqual(
            detect_contamination(path, "scrooge:zh/full", None),
            "caveman fingerprint in session transcript",
        )


class TestNetIsStillUp(unittest.TestCase):
    def test_competitor_name_outside_system_prompt_is_flagged(self):
        # The case the detector exists for: the name arrived through the user
        # channel, which is how a hook/skill leak actually reaches the model.
        path = _session([
            _system_prompt_line(OWN_RULE),
            _user_line("caveman mode: use short words"),
        ])
        self.assertEqual(
            detect_contamination(path, "scrooge:zh/full", OWN_RULE),
            "caveman fingerprint in session transcript",
        )

    def test_extra_text_inside_system_prompt_is_still_scanned(self):
        # `--append-system-prompt` keeps the host prompt alongside ours. Only the
        # injected slice is subtracted, so a leak sharing the field is still seen.
        path = _session([
            _system_prompt_line(OWN_RULE + "\n\ncaveman: grunt like cave person"),
        ])
        self.assertEqual(
            detect_contamination(path, "scrooge:zh/full", OWN_RULE),
            "caveman fingerprint in session transcript",
        )

    def test_scrooge_hook_injection_is_flagged(self):
        path = _session([
            _system_prompt_line(OWN_RULE),
            _user_line("SCROOGE 활성 (ko/full)"),
        ])
        self.assertEqual(
            detect_contamination(path, "scrooge:zh/full", OWN_RULE),
            "scrooge register-hook injection in session transcript",
        )

    def test_caveman_arm_may_carry_its_own_name(self):
        path = _session([_user_line("caveman caveman caveman")])
        self.assertIsNone(detect_contamination(path, "caveman:3", None))


if __name__ == "__main__":
    unittest.main()
