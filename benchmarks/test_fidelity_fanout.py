#!/usr/bin/env python3
"""The multi-language judge driver must fail loudly, never quietly.

`fanout.py` holds one host-isolation window and runs the per-language children with
`--no-isolate-host`. Two things can go wrong without a trace:

  - a child that dies before judging leaves its PREVIOUS output file untouched, and
    `--resume` then reads like a finished re-measurement of the current register —
    the exact mislabelling RELEASE.md 1a's disclose rule exists to prevent. So a
    failing child must reach the driver's exit code.
  - the children's progress lines carry no language, so five interleaved streams
    make an `ERR:` line unattributable. Every relayed line is tagged.

Derivation is the third: a results file the driver cannot name is refused, not
skipped.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


def _load(name, rel):
    here = pathlib.Path(__file__).resolve().parent
    fid = str(here / "fidelity")
    if fid not in sys.path:
        sys.path.insert(0, fid)
    spec = importlib.util.spec_from_file_location(name, here / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


REPO = pathlib.Path(__file__).resolve().parent.parent
FANOUT = REPO / "benchmarks" / "fidelity" / "fanout.py"


def _results(path: pathlib.Path, arm: str, pairs: int = 3, usable: bool = True):
    rows = []
    for pid in range(pairs):
        for a in ("normal", arm):
            rows.append({"arm": a, "prompt_id": pid, "run": 0,
                         "output_text": f"{a} text {pid}" if usable else "",
                         "output_tokens": 50 + pid})
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


class TestDeriveJob(unittest.TestCase):
    def setUp(self):
        self.mod = _load("_fanout_derive", "fidelity/fanout.py")
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_tag_arm_and_output_come_from_the_file(self):
        p = self.tmp / "results-ko-report-v025.jsonl"
        _results(p, "scrooge:ko/full")
        tag, arm, out = self.mod.derive_job(p, "normal")
        self.assertEqual((tag, arm), ("ko", "scrooge:ko/full"))
        self.assertEqual(out.name, "results-ko-fidelity-v025.jsonl")
        # Next to the input, never in the repo's own fidelity/ — an earlier version
        # of this test left rows appended there.
        self.assertEqual(out.parent, p.parent / "fidelity")

    def test_suffixless_name_still_derives(self):
        p = self.tmp / "results-en-report.jsonl"
        _results(p, "scrooge:en/full")
        _, _, out = self.mod.derive_job(p, "normal")
        self.assertEqual(out.name, "results-en-fidelity.jsonl")

    def test_unnameable_file_is_refused(self):
        p = self.tmp / "whatever.jsonl"
        _results(p, "scrooge:ko/full")
        with self.assertRaises(ValueError):
            self.mod.derive_job(p, "normal")

    def test_ambiguous_candidate_arm_is_refused(self):
        """Two non-baseline arms in one file: guessing would judge the wrong one."""
        p = self.tmp / "results-ko-report.jsonl"
        rows = [{"arm": a, "prompt_id": 0, "run": 0, "output_text": "t", "output_tokens": 9}
                for a in ("normal", "scrooge:ko/full", "caveman:full")]
        p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.mod.derive_job(p, "normal")


class TestFanoutRun(unittest.TestCase):
    """End-to-end through the CLI: --dry-run takes no isolation lock and no quota."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _run(self, *args):
        return subprocess.run(
            [sys.executable, str(FANOUT), *[str(a) for a in args]],
            capture_output=True, text=True, timeout=180, cwd=REPO)

    def test_every_relayed_line_is_tagged(self):
        ko = self.tmp / "results-ko-report-t.jsonl"
        en = self.tmp / "results-en-report-t.jsonl"
        _results(ko, "scrooge:ko/full")
        _results(en, "scrooge:en/full")
        r = self._run(ko, en, "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.tmp / "fidelity" / "results-ko-fidelity-t.jsonl").exists())
        relayed = [l for l in r.stderr.splitlines() if "HEADLINE" in l or " p=" in l]
        self.assertTrue(relayed, "no child output was relayed")
        for line in relayed:
            self.assertRegex(line, r"^\[(ko|en)\] ", f"untagged child line: {line}")

    def test_a_failing_child_reaches_the_exit_code(self):
        ok = self.tmp / "results-ko-report-t.jsonl"
        bad = self.tmp / "results-en-report-t.jsonl"
        _results(ok, "scrooge:ko/full")
        _results(bad, "scrooge:en/full", usable=False)  # no pairs -> child exits 2
        r = self._run(ok, bad, "--dry-run")
        self.assertNotEqual(r.returncode, 0,
                            "a child that judged nothing must not read as success")
        self.assertIn("en exited", r.stderr)

    def test_concurrency_budget_is_stated(self):
        ko = self.tmp / "results-ko-report-t.jsonl"
        _results(ko, "scrooge:ko/full")
        r = self._run(ko, "--dry-run", "--", "--workers=3")
        self.assertIn("x --workers 3 = up to 3 concurrent", r.stderr)

    def test_baseline_arm_reaches_the_children(self):
        """A non-default baseline is used to derive the job AND passed on; a child
        left on its own default would pair `normal` against itself."""
        p = self.tmp / "results-ko-report-t.jsonl"
        rows = [{"arm": a, "prompt_id": 0, "run": 0, "output_text": f"{a} t",
                 "output_tokens": 9} for a in ("terse", "scrooge:ko/full")]
        p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
        r = self._run(p, "--dry-run", "--baseline-arm", "terse")
        self.assertEqual(r.returncode, 0, r.stderr)
        rec = json.loads((self.tmp / "fidelity" / "results-ko-fidelity-t.jsonl")
                         .read_text().splitlines()[0])
        self.assertEqual((rec["baseline_arm"], rec["candidate_arm"]), ("terse", "scrooge:ko/full"))

    def test_driver_owned_flags_are_refused_after_the_separator(self):
        ko = self.tmp / "results-ko-report-t.jsonl"
        _results(ko, "scrooge:ko/full")
        r = self._run(ko, "--dry-run", "--", "--output", str(self.tmp / "one.jsonl"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("--output", r.stderr)


if __name__ == "__main__":
    unittest.main()
