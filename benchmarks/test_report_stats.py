#!/usr/bin/env python3
"""Unit tests for report.py's paired statistics.

Run: python3 -m unittest discover -s benchmarks -p 'test_*.py'
Stdlib only, fixed seed — the bootstrap must be reproducible or a published CI
cannot be re-derived from a committed JSONL.
"""

import unittest

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


if __name__ == "__main__":
    unittest.main()
