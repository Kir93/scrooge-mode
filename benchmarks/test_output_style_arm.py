#!/usr/bin/env python3
"""Unit tests for run.py's `style:NAME` arm (a Claude Code output style).

Run: python3 -m unittest discover -s benchmarks -p 'test_*.py'

The arm carries no rule text: the style reaches the model only through
`--settings '{"outputStyle": NAME}'`, which the CLI can ignore (a misspelled
name, a version without the style), and a host `outputStyle` setting can reach a
non-style arm. Either way a row would be scored under the wrong treatment, so a
row counts only when the style its transcript records matches its arm.
"""

import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import run  # noqa: E402
from run import build_cmd, recorded_output_style, resolve_arm  # noqa: E402

# Shaped like the attachment Claude Code 2.1.300 writes (measured 2026-10-15).
CONCISE_PROMPT = (
    "You are an interactive CLI tool that helps users with software engineering "
    "tasks. Keep your responses short and direct.\n\n# Concise Style Active\n"
    "The user chose brevity over narration."
)


def _session(lines):
    tmp = tempfile.NamedTemporaryFile(
        "w", suffix=".jsonl", delete=False, encoding="utf-8"
    )
    for obj in lines:
        tmp.write(json.dumps(obj, ensure_ascii=False) + "\n")
    tmp.close()
    return pathlib.Path(tmp.name)


def _style_line(name, prompt):
    return {"type": "attachment",
            "attachment": {"type": "output_style_instructions",
                           "style": {"name": name, "prompt": prompt}}}


class TestStyleArmArgv(unittest.TestCase):
    def test_style_arm_has_no_rule_text(self):
        self.assertEqual(resolve_arm("style:Concise"), ("style:Concise", ""))

    def test_style_arm_without_a_name_is_refused(self):
        with self.assertRaises(ValueError):
            resolve_arm("style:")

    def test_style_reaches_the_cli_through_settings(self):
        cmd = build_cmd("", "q", system_prompt_mode="append", output_style="Concise")
        i = cmd.index("--settings")
        self.assertEqual(json.loads(cmd[i + 1]), {"outputStyle": "Concise"})
        self.assertNotIn("--append-system-prompt", cmd)
        self.assertNotIn("--system-prompt", cmd)
        self.assertEqual(cmd[-2:], ["--", "q"])

    def test_other_arms_pass_no_settings(self):
        self.assertNotIn("--settings", build_cmd("rule", "q", system_prompt_mode="append"))


class TestStyleArmNeedsAppendMode(unittest.TestCase):
    def _main(self, *extra):
        with tempfile.TemporaryDirectory() as d:
            prompts = pathlib.Path(d) / "p.txt"
            prompts.write_text("q\n", encoding="utf-8")
            out = pathlib.Path(d) / "out.jsonl"
            argv = ["run.py", "--prompts", str(prompts), "--arms", "normal,style:Concise",
                    "--output", str(out), "--dry-run", *extra]
            with mock.patch.object(sys, "argv", argv):
                return run.main(), out.exists()

    def test_replace_mode_is_refused_before_any_call(self):
        self.assertEqual(self._main(), (2, False))

    def test_append_mode_runs(self):
        self.assertEqual(self._main("--system-prompt-mode", "append"), (0, True))


class TestRunOneExcludesAStyleMismatch(unittest.TestCase):
    """run_one scores a row only when the recorded style matches its arm."""

    def _run(self, arm, transcript_lines):
        with tempfile.TemporaryDirectory() as d:
            cwd = pathlib.Path(d) / "cwd"

            def fake_call(make_cmd, *_args, **_kwargs):
                cmd = make_cmd(1)
                sid = cmd[cmd.index("--session-id") + 1]
                session_dir = run.cwd_session_dir(cwd)
                session_dir.mkdir(parents=True)
                with open(session_dir / f"{sid}.jsonl", "w", encoding="utf-8") as f:
                    for obj in transcript_lines:
                        f.write(json.dumps(obj) + "\n")
                return mock.Mock(stdout="answer"), None, None

            with mock.patch.dict("os.environ", {"CLAUDE_CONFIG_DIR": d}), \
                    mock.patch.object(run, "call_with_retry", fake_call):
                return run.run_one(arm, "", "q", 0, 0, cwd=cwd, dry_run=False, timeout=5,
                                   system_prompt_mode="append")

    def test_style_arm_with_its_style_recorded_is_kept(self):
        r = self._run("style:Concise", [_style_line("Concise", CONCISE_PROMPT)])
        self.assertIsNone(r.error)

    def test_style_arm_without_a_record_is_excluded(self):
        r = self._run("style:Concise", [])
        self.assertIsNone(r.output_tokens)
        self.assertIn("output style mismatch", r.error)

    def test_non_style_arm_with_a_host_style_is_excluded(self):
        r = self._run("normal", [_style_line("Concise", CONCISE_PROMPT)])
        self.assertIsNone(r.output_tokens)
        self.assertIn("output style mismatch", r.error)


class TestRecordedOutputStyle(unittest.TestCase):
    def test_recorded_style_is_returned(self):
        path = _session([_style_line("Concise", CONCISE_PROMPT)])
        self.assertEqual(recorded_output_style(path), "Concise")

    def test_default_style_records_none(self):
        path = _session([{"type": "user", "message": {"role": "user", "content": "q"}}])
        self.assertIsNone(recorded_output_style(path))

    def test_another_style_is_told_apart(self):
        path = _session([_style_line("Explanatory", "# Explanatory Style Active")])
        self.assertEqual(recorded_output_style(path), "Explanatory")

    def test_marker_outside_the_attachment_does_not_count(self):
        # The prompt text can echo the marker; only the CLI's own record counts.
        path = _session([{"type": "user", "message": {
            "role": "user", "content": "# Concise Style Active"}}])
        self.assertIsNone(recorded_output_style(path))

    def test_unreadable_session_records_none(self):
        self.assertIsNone(recorded_output_style(pathlib.Path("/nonexistent.jsonl")))


if __name__ == "__main__":
    unittest.main()
