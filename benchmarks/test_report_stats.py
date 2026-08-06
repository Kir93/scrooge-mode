#!/usr/bin/env python3
"""Unit tests for report.py's paired statistics.

Run: python3 -m unittest discover -s benchmarks -p 'test_*.py'
Stdlib only, fixed seed — the bootstrap must be reproducible or a published CI
cannot be re-derived from a committed JSONL.
"""

import unittest

import importlib.util
import json
import os
import pathlib
import shutil
import tempfile

from report import bootstrap_ci, mde, noise_floor, sign_test


class TestSignTest(unittest.TestCase):
    def test_all_wins_is_two_sided_binomial_tail(self):
        # 5 wins, 0 losses → 2 * C(5,0)/2^5 = 0.0625
        self.assertAlmostEqual(sign_test(5, 0), 0.0625)
        # 21 wins, 0 losses → 2 / 2^21, the value every headline arm reports
        self.assertAlmostEqual(sign_test(21, 0), 2 / 2**21)

    def test_even_split_is_not_significant(self):
        self.assertEqual(sign_test(5, 5), 1.0)

    def test_symmetric_in_wins_and_losses(self):
        self.assertEqual(sign_test(7, 2), sign_test(2, 7))

    def test_no_decisive_pairs_returns_none(self):
        self.assertIsNone(sign_test(0, 0))


class TestMde(unittest.TestCase):
    def test_scales_with_spread_and_sample_size(self):
        tight = mde([10.0, 10.5, 9.5, 10.2])
        wide = mde([10.0, 40.0, -20.0, 30.0])
        self.assertLess(tight, wide)

    def test_degenerate_sample_returns_none(self):
        self.assertIsNone(mde([1.0]))
        self.assertIsNone(mde([]))

    def test_zero_variance_is_zero(self):
        self.assertEqual(mde([5.0] * 6), 0.0)


class TestBootstrapCi(unittest.TestCase):
    def test_constant_sample_has_degenerate_interval(self):
        lo, hi = bootstrap_ci([[7.0]] * 20, n_resamples=200, seed=0)
        self.assertEqual((lo, hi), (7.0, 7.0))

    def test_interval_brackets_the_median(self):
        clusters = [[float(v)] for v in range(1, 21)]
        lo, hi = bootstrap_ci(clusters, n_resamples=2000, seed=0)
        self.assertLessEqual(lo, 10.5)
        self.assertGreaterEqual(hi, 10.5)

    def test_same_seed_is_reproducible(self):
        clusters = [[float(v)] for v in (3, 9, 1, 14, 6, 22, 8, 11)]
        self.assertEqual(bootstrap_ci(clusters, 500, seed=42),
                         bootstrap_ci(clusters, 500, seed=42))

    def test_too_few_clusters_returns_none(self):
        self.assertEqual(bootstrap_ci([[1.0]], 100, seed=0), (None, None))
        self.assertEqual(bootstrap_ci([], 100, seed=0), (None, None))

    def test_clustering_widens_the_interval(self):
        # Same 24 values. Clustered: 8 prompts x 3 correlated runs — the real
        # shape of results-lean2-*.jsonl. Unclustered: 24 independent draws.
        # Treating correlated runs as independent understates the interval, so
        # the clustered CI must not be narrower.
        prompts = [[v, v + 0.5, v - 0.5] for v in (5.0, 40.0, 8.0, 35.0,
                                                   6.0, 38.0, 7.0, 36.0)]
        flat = [[v] for prompt in prompts for v in prompt]
        c_lo, c_hi = bootstrap_ci(prompts, 4000, seed=0)
        f_lo, f_hi = bootstrap_ci(flat, 4000, seed=0)
        self.assertGreater(c_hi - c_lo, f_hi - f_lo)


class TestNoiseFloor(unittest.TestCase):
    def test_reports_cv_percent_per_cell(self):
        nf = noise_floor([[100.0, 100.0], [100.0, 200.0]])
        self.assertEqual(nf["cells"], 2)
        self.assertGreater(nf["max"], 40.0)
        self.assertEqual(nf["median"], nf["max"] / 2)

    def test_single_run_cells_are_skipped(self):
        self.assertIsNone(noise_floor([[1.0], [2.0]]))

    def test_zero_mean_cell_is_skipped(self):
        self.assertIsNone(noise_floor([[0.0, 0.0]]))


def _load(name, rel):
    import sys
    here = pathlib.Path(__file__).resolve().parent
    # fidelity/run.py imports its sibling `judge`; without this the load fails on
    # ModuleNotFoundError rather than on anything this test is about.
    fid = str(here / "fidelity")
    if fid not in sys.path:
        sys.path.insert(0, fid)
    spec = importlib.util.spec_from_file_location(name, here / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestModelPin(unittest.TestCase):
    """The latest-Opus pin is a policy; these keep it from becoming a note.

    The published tables sat on claude-opus-4-8 for months after Claude Code moved
    to Opus 5, with only a README caveat to show for it. A prose rule did not stop
    that, so the pin now lives in code as a default and CI asserts the docs agree.
    """

    def test_every_harness_shares_one_pin(self):
        run = _load("_pin_run", "run.py")
        fid = _load("_pin_fid", "fidelity/run.py")
        deb = _load("_pin_deb", "fidelity/debunk.py")
        self.assertEqual(run.LATEST_OPUS, fid.LATEST_OPUS)
        self.assertEqual(run.LATEST_OPUS, deb.LATEST_OPUS)

    def test_pin_is_an_opus_and_not_a_side_tier(self):
        run = _load("_pin_run2", "run.py")
        self.assertIn("opus", run.LATEST_OPUS)
        # fable/mythos are a different tier and price: not what Claude Code runs,
        # so a headline measured there would describe neither behaviour nor cost.
        for other in ("fable", "mythos", "sonnet", "haiku"):
            self.assertNotIn(other, run.LATEST_OPUS)

    def test_readme_documents_the_pin_the_code_uses(self):
        run = _load("_pin_run3", "run.py")
        readme = (pathlib.Path(__file__).resolve().parent / "README.md").read_text(encoding="utf-8")
        self.assertIn(f"`{run.LATEST_OPUS}`", readme)


class TestUltracodeNeutralization(unittest.TestCase):
    """`ultracode: true` makes a --print child spawn a workflow and die mid-response,
    which silently biases the `normal` baseline. Isolation must switch it off for the
    run and put the file back byte-for-byte otherwise."""

    def setUp(self):
        self.run = _load("_uc_run", "run.py")
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.settings = self.tmp / "settings.json"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        for b in pathlib.Path("/tmp").glob("scrooge-bench-settings-ultracode.*.bak"):
            if b.stem.endswith(f".{os.getpid()}"):
                b.unlink()

    def _write(self, data):
        self.settings.write_text(json.dumps(data), encoding="utf-8")

    def test_disables_the_flag_and_keeps_every_other_key(self):
        self._write({"ultracode": True, "enabledPlugins": {"a": True}, "model": "opus"})
        edit = self.run._neutralize_ultracode(self.settings, os.getpid())
        self.assertIsNotNone(edit)
        after = json.loads(self.settings.read_text(encoding="utf-8"))
        self.assertFalse(after["ultracode"])
        self.assertEqual(after["enabledPlugins"], {"a": True})
        self.assertEqual(after["model"], "opus")
        # the backup restores the original verbatim
        live, backup = edit
        self.assertTrue(backup.exists())
        self.assertTrue(json.loads(backup.read_text(encoding="utf-8"))["ultracode"])
        backup.unlink()

    def test_no_op_when_the_flag_is_absent_or_off(self):
        for data in ({"model": "opus"}, {"ultracode": False}):
            self._write(data)
            before = self.settings.read_text(encoding="utf-8")
            self.assertIsNone(self.run._neutralize_ultracode(self.settings, os.getpid()))
            self.assertEqual(self.settings.read_text(encoding="utf-8"), before)

    def test_missing_or_unparseable_settings_is_not_fatal(self):
        self.assertIsNone(self.run._neutralize_ultracode(self.tmp / "absent.json", os.getpid()))
        self.settings.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.run._neutralize_ultracode(self.settings, os.getpid()))


if __name__ == "__main__":
    unittest.main()
