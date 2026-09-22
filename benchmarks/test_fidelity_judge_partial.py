#!/usr/bin/env python3
"""A judge call that fails among N must not discard the pair.

`--judge-runs N` is the only knob against judge noise, but a single failed call
used to mark the whole pair errored: judge.py filled `judge_error` in its SUCCESS
branch, fidelity/run.py copied it to `rec["error"]`, and both consumers then threw
the row away (`run.py` aggregate() routes the key to `error_keys`;
`fidelity/report.py` skips any row with `error`). So raising N lowered the
published N instead of tightening it — pair loss grows as 1-(1-p)^N — and the
coverage warning could not see it, because the row left the numerator and the
denominator together.

These pin the split: partial failures ride `judge_partial_error` and stay scored;
`judge_error` is reserved for the no-verdict case.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
import unittest.mock


def _load(name, rel):
    here = pathlib.Path(__file__).resolve().parent
    # fidelity/run.py imports its sibling `judge` by bare name.
    fid = str(here / "fidelity")
    if fid not in sys.path:
        sys.path.insert(0, fid)
    spec = importlib.util.spec_from_file_location(name, here / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


VERDICT = '{"equivalent": true, "missing_claims": [], "altered_claims": [], "score": 1.0}'


class TestPartialJudgeFailure(unittest.TestCase):
    def setUp(self):
        self.fid = _load("_fid_partial_run", "fidelity/run.py")
        self.rep = _load("_fid_partial_report", "fidelity/report.py")
        self.judge = sys.modules["judge"]

    def _stub_calls(self, outcomes):
        """outcomes: list of (verdict_text, error) served in order."""
        seq = list(outcomes)

        def fake(baseline, candidate, model, timeout=120):
            return seq.pop(0)

        return unittest.mock.patch.object(self.judge, "call_judge", fake)

    def _row(self, scored):
        return {
            "prompt_id": 0, "run": 0, "candidate_arm": "scrooge:ko/full",
            "baseline_tokens": 100, "candidate_tokens": 40, "saved_pct": 60.0,
            "error": scored.get("judge_error"),
            "judge_partial_error": scored.get("judge_partial_error"),
            "equivalent": scored.get("equivalent"),
            "score": (scored.get("verdict") or {}).get("score"),
            "judge_runs": scored.get("judge_runs"),
        }

    def test_one_failure_of_three_keeps_the_majority_verdict(self):
        with self._stub_calls([(VERDICT, None), (None, "judge timeout"), (VERDICT, None)]):
            scored = self.judge.judge_pair("base text", "cand text", "m", runs=3)
        self.assertTrue(scored["equivalent"])
        self.assertEqual(scored["judge_runs"], 2)
        self.assertIsNone(scored["judge_error"], "a survivable failure must not be judge_error")
        self.assertEqual(scored["judge_partial_error"], "judge timeout")

    def test_partially_failed_pair_stays_in_the_aggregate(self):
        """Scored, not discarded — but below the runs asked for it is a partial
        verdict: HOLD for the headline (README "Filter to judge_runs == 3 first"),
        visible to the coverage warning, and tallied so it is never mistaken for
        a full verdict."""
        with self._stub_calls([(VERDICT, None), (None, "judge timeout"), (VERDICT, None)]):
            scored = self.judge.judge_pair("base text", "cand text", "m", runs=3)
        out = self.fid.aggregate([self._row(scored)], "m", "scrooge:ko/full", min_runs=3)
        self.assertIn("Pairs scored:          1", out)
        self.assertIn("(judged 0/1, 1 hold, 0 error, 1 of them partial-run)", out)
        self.assertIn("⚠ only 0/1 pairs were judged", out)
        # With the runs it has counted as enough, the verdict is in the headline.
        out = self.fid.aggregate([self._row(scored)], "m", "scrooge:ko/full", min_runs=2)
        self.assertIn("(judged 1/1, 0 hold, 0 error)", out)

    def test_partially_failed_pair_survives_the_report_loader(self):
        """fidelity/report.py is the second consumer of the same field."""
        with self._stub_calls([(VERDICT, None), (None, "judge timeout"), (VERDICT, None)]):
            scored = self.judge.judge_pair("base text", "cand text", "m", runs=3)
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "f.jsonl"
            p.write_text(json.dumps(self._row(scored)) + "\n", encoding="utf-8")
            rows = self.rep.load(p, min_judge_runs=1)
        self.assertEqual(len(rows), 1, "a scored pair must reach the comparison report")

    def test_total_failure_is_still_an_error(self):
        """No verdict at all means the pair has nothing to score — and --resume
        must keep retrying it (load_done_keys skips rows with `error`)."""
        with self._stub_calls([(None, "judge timeout")] * 3):
            scored = self.judge.judge_pair("base text", "cand text", "m", runs=3)
        self.assertEqual(scored["judge_runs"], 0)
        self.assertEqual(scored["judge_error"], "judge timeout")
        self.assertIsNone(scored["judge_partial_error"])
        out = self.fid.aggregate([self._row(scored)], "m", "scrooge:ko/full")
        self.assertIn("Pairs scored:          0", out)
        self.assertIn("1 error", out)
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "f.jsonl"
            p.write_text(json.dumps(self._row(scored)) + "\n", encoding="utf-8")
            self.assertEqual(self.fid.load_done_keys(p), set())

    def test_partial_row_reaches_the_file_and_stays_resumable(self):
        """Through the real runner, not a hand-built row: judge_pair -> judge_one ->
        JSONL. Pins the seam (the field must be copied into the record) and the
        --resume rule (a pair short of the runs asked for is re-judged, so it can
        still reach fidelity/report.py's --min-judge-runs floor)."""
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            rows = [{"arm": a, "prompt_id": 0, "run": 0, "output_text": f"{a} t",
                     "output_tokens": 10} for a in ("normal", "scrooge:ko/full")]
            (d / "r.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            argv = ["run.py", "--results", str(d / "r.jsonl"), "--candidate-arm",
                    "scrooge:ko/full", "--output", str(d / "f.jsonl"),
                    "--no-isolate-host", "--judge-runs", "3"]
            with self._stub_calls([(VERDICT, None), (None, "judge timeout"), (VERDICT, None)]), \
                    unittest.mock.patch.object(sys, "argv", argv):
                self.assertEqual(self.fid.main(), 0)
            rec = json.loads((d / "f.jsonl").read_text().splitlines()[0])
            self.assertIsNone(rec["error"])
            self.assertEqual(rec["judge_partial_error"], "judge timeout")
            self.assertEqual(rec["judge_runs"], 2)
            self.assertEqual(self.fid.load_done_keys(d / "f.jsonl", 3), set(),
                             "2 of 3 runs is scored but not done — --resume must retry it")
            self.assertEqual(self.fid.load_done_keys(d / "f.jsonl", 2), {(0, 0)})

    def test_clean_run_carries_neither_field(self):
        with self._stub_calls([(VERDICT, None)] * 3):
            scored = self.judge.judge_pair("base text", "cand text", "m", runs=3)
        self.assertEqual(scored["judge_runs"], 3)
        self.assertIsNone(scored["judge_error"])
        self.assertIsNone(scored["judge_partial_error"])


if __name__ == "__main__":
    unittest.main()
