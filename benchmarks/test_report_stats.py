#!/usr/bin/env python3
"""Unit tests for report.py's paired statistics.

Run: python3 -m unittest discover -s benchmarks -p 'test_*.py'
Stdlib only, fixed seed — the bootstrap must be reproducible or a published CI
cannot be re-derived from a committed JSONL.
"""

import unittest
import unittest.mock
import types

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


class TestTransportRetry(unittest.TestCase):
    """Which transport failures are worth another attempt, and where the cause comes from.

    A 529 burst invalidated 21 of 30 calls in one measured run and left `exit=1`
    as the only trace. Both deciders are pure string->verdict functions so the
    classification is pinned here rather than re-derived at each call site.
    """

    def setUp(self):
        self.run = _load("_retry_run", "run.py")

    def test_transient_server_states_are_retried(self):
        for error in (
            "claude exit 1: API Error: 529 Overloaded",
            "claude exit 1: API Error: 429 Too Many Requests",
            "claude exit 1: API Error: 503 Service Unavailable",
            "claude exit 1: API Error: 500 Internal Server Error",
            "timeout",
        ):
            self.assertTrue(self.run.is_retryable(error), error)

    def test_permanent_failures_are_not_retried(self):
        # Retrying these only burns subscription quota: auth does not fix itself,
        # a malformed prompt stays malformed, and 4xx-other is a client error.
        for error in (
            "claude exit 1: API Error: 401 Unauthorized",
            "claude exit 1: API Error: 400 Bad Request",
            "claude exit 1: Invalid model name",
            "no new session file found for benchmark cwd",
            None,
            "",
        ):
            self.assertFalse(self.run.is_retryable(error), repr(error))

    def test_quota_exhaustion_wins_over_the_http_code(self):
        # A 429 that names a session/usage limit is quota exhaustion, not a
        # transient burst — it does not clear inside a backoff window, and
        # is_session_limit() already stops the run early for it.
        for error in (
            "claude exit 1: API Error: 429 session limit reached",
            "claude exit 1: usage limit reached",
            "claude exit 1: rate limit exceeded",
        ):
            self.assertTrue(self.run.is_session_limit(error), error)
            self.assertFalse(self.run.is_retryable(error), error)

    def test_session_limit_ignores_unrelated_errors(self):
        # Never had a test; pinned here alongside the retry decider it gates.
        self.assertFalse(self.run.is_session_limit("claude exit 1: API Error: 529"))
        self.assertFalse(self.run.is_session_limit(None))

    def test_reason_is_recovered_from_plain_output(self):
        # build_cmd passes no --output-format, so `claude --print` writes plain
        # text: the reason must survive without a JSON envelope, or every real
        # failure records None and the row keeps saying only "exit=1".
        self.assertEqual(
            self.run.extract_failure_reason("API Error: 529 Overloaded\n", ""),
            "API Error: 529 Overloaded",
        )
        self.assertEqual(self.run.extract_failure_reason("", "auth failed"), "auth failed")

    def test_reason_unwraps_a_result_envelope_when_there_is_one(self):
        # The CLI wraps some failures in its result envelope; the cause is in
        # `result` and the surrounding JSON is noise.
        payload = json.dumps({"is_error": True, "result": "API Error: 529 Overloaded"})
        self.assertEqual(
            self.run.extract_failure_reason(payload, ""), "API Error: 529 Overloaded"
        )

    def test_no_output_yields_no_reason(self):
        # A crash with nothing on either stream must not fabricate a cause.
        for stdout, stderr in (("", ""), (None, None), ("   ", "\n")):
            self.assertIsNone(self.run.extract_failure_reason(stdout, stderr))

    def test_a_line_number_is_not_read_as_an_http_code(self):
        # `error` carries up to 400 chars of raw output, so a bare 3-digit match
        # would retry a permanent failure twice and burn quota for it.
        self.assertFalse(
            self.run.is_retryable("claude exit 1: Internal error at line 512 of foo.js")
        )

    def test_retry_count_is_finite(self):
        # The risk this bounds: an unbounded retry loop spends the whole quota on
        # one dead call.
        self.assertGreaterEqual(self.run.RETRY_ATTEMPTS, 2)
        self.assertLessEqual(self.run.RETRY_ATTEMPTS, 5)

    def test_backoff_grows_and_is_jittered(self):
        delays = [self.run.retry_delay(a) for a in (1, 2)]
        for a, d in zip((1, 2), delays):
            base = self.run.RETRY_BASE_DELAY_S * 2 ** (a - 1)
            self.assertLessEqual(d, base * (1 + self.run.RETRY_JITTER))
            self.assertGreaterEqual(d, base * (1 - self.run.RETRY_JITTER))
        self.assertLess(delays[0], delays[1])
        # Jitter is real, not a constant: --workers threads failing on one burst
        # must not come back at the same instant.
        self.assertGreater(len({self.run.retry_delay(1) for _ in range(20)}), 1)

    def test_a_code_on_stderr_still_reads_as_retryable(self):
        # The loop feeds both streams to the verdict, so a 529 behind unrelated
        # stdout noise is not misclassified as permanent.
        self.assertTrue(
            self.run.is_retryable("claude exit 1: \nPartial answer\nAPI Error: 529 Overloaded")
        )


class TestRetryLoop(unittest.TestCase):
    """The loop itself, not just the deciders it asks.

    Asserting the constants alone would stay green if the `attempt ==
    RETRY_ATTEMPTS` break or the `is_retryable` guard were dropped — which is the
    recorded risk (a retry loop that spends the whole quota on one dead call).
    """

    def setUp(self):
        self.run = _load("_loop_run", "run.py")
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.calls = []
        self.sleeps = []
        # patch.object, not attribute assignment: `run.time` / `run.subprocess`
        # ARE the process-wide stdlib modules, so a bare assignment would outlive
        # this class and hand every later test a stubbed subprocess.
        self._patch(self.run.time, "sleep", lambda s: self.sleeps.append(s))

    def _patch(self, target, attr, value):
        patcher = unittest.mock.patch.object(target, attr, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _respond(self, outcomes):
        """Stub `claude` with one (stdout, returncode) per attempt; last repeats."""
        def fake(cmd, **kw):
            self.calls.append(cmd)
            stdout, code = outcomes[min(len(self.calls), len(outcomes)) - 1]
            return types.SimpleNamespace(returncode=code, stdout=stdout, stderr="")
        self._patch(self.run.subprocess, "run", fake)

    def _fail_with(self, stdout, code=1):
        self._respond([(stdout, code)])

    def _run_one(self):
        return self.run.run_one(
            arm="normal", rule_text="", prompt="p", prompt_id=0, run=0,
            cwd=self.tmp, dry_run=False, timeout=5,
        )

    def test_a_transient_failure_is_retried_up_to_the_cap(self):
        self._fail_with("API Error: 529 Overloaded")
        result = self._run_one()
        self.assertEqual(len(self.calls), self.run.RETRY_ATTEMPTS)
        self.assertEqual(len(self.sleeps), self.run.RETRY_ATTEMPTS - 1)
        self.assertIn("529", result.error)
        self.assertEqual(result.failure_reason, "API Error: 529 Overloaded")
        self.assertIsNone(result.output_tokens)

    def test_a_permanent_failure_is_not_retried(self):
        self._fail_with("API Error: 401 Unauthorized")
        result = self._run_one()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.sleeps, [])
        self.assertEqual(result.failure_reason, "API Error: 401 Unauthorized")

    def test_a_quota_limit_stops_immediately(self):
        # Backoff cannot clear a subscription limit; the run stops early instead.
        self._fail_with("API Error: 429 usage limit reached")
        result = self._run_one()
        self.assertEqual(len(self.calls), 1)
        self.assertTrue(self.run.is_session_limit(result.error))

    def test_a_recovered_call_carries_no_error(self):
        # The path the whole feature exists for. Without it, dropping the
        # `error = None` reset would tag a recovered row as failed and the run
        # would discard a call it actually paid for.
        sessions = self.tmp / "sessions"
        sessions.mkdir()
        self._patch(self.run, "cwd_session_dir", lambda cwd: sessions)
        outcomes = [("API Error: 529 Overloaded", 1), ("answer text", 0)]
        def fake(cmd, **kw):
            self.calls.append(cmd)
            stdout, code = outcomes[min(len(self.calls), len(outcomes)) - 1]
            if code == 0:
                (sessions / "s.jsonl").write_text("", encoding="utf-8")
            return types.SimpleNamespace(returncode=code, stdout=stdout, stderr="")
        self._patch(self.run.subprocess, "run", fake)
        result = self._run_one()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(len(self.sleeps), 1)
        self.assertIsNone(result.error)
        self.assertIsNone(result.failure_reason)

    def test_a_timeout_is_retried_too(self):
        def fake(cmd, **kw):
            self.calls.append(cmd)
            raise self.run.subprocess.TimeoutExpired(cmd, kw.get("timeout", 5))
        self._patch(self.run.subprocess, "run", fake)
        result = self._run_one()
        self.assertEqual(len(self.calls), self.run.RETRY_ATTEMPTS)
        self.assertEqual(result.error, "timeout")
        self.assertIsNone(result.failure_reason)


class TestConfigDirResolution(unittest.TestCase):
    """Every config path follows CLAUDE_CONFIG_DIR, as hooks/scrooge-config.js does.

    The failure this pins is silent, not loud: with the override set and the
    register active, isolation moves nothing, verification finds nothing to block,
    and the user's own hook injects into every arm — while the row still records
    `isolation_verified: true`.
    """

    def setUp(self):
        self.run = _load("_cfg_run", "run.py")
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_the_override_wins_over_home(self):
        with unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.tmp)}):
            self.assertEqual(self.run.claude_config_dir(), self.tmp)

    def test_home_is_the_fallback(self):
        env = dict(os.environ)
        env.pop("CLAUDE_CONFIG_DIR", None)
        with unittest.mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(self.run.claude_config_dir(), pathlib.Path.home() / ".claude")

    def test_transcript_discovery_follows_the_override(self):
        # cwd_session_dir feeding off the wrong root is what makes every row fail
        # with "no new session file found" AFTER the quota is already spent.
        with unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.tmp)}):
            got = self.run.cwd_session_dir(pathlib.Path("/tmp/bench"))
        self.assertEqual(got, self.tmp / "projects" / "-tmp-bench")

    def test_verification_probes_the_override_not_home(self):
        # An active state file under the override must be found and reported
        # blocking; finding nothing there is the silent-contamination path.
        state = self.tmp / ".scrooge"
        state.mkdir(parents=True)
        (state / "global").write_text('{"lang":"ko","dial":"full"}', encoding="utf-8")
        with unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.tmp)}):
            findings = self.run.verify_register_clean(self.tmp / "cwd")
        blocking = [m for sev, m in findings if sev == "blocking"]
        self.assertTrue(any(str(state / "global") in m for m in blocking), findings)

    def test_isolation_moves_state_under_the_override(self):
        state = self.tmp / ".scrooge"
        state.mkdir(parents=True)
        marker = state / "global"
        marker.write_text('{"lang":"ko","dial":"full"}', encoding="utf-8")
        # Redirect the cross-process lock into the temp dir. It is a fixed /tmp
        # path, so against the real one this test fails whenever a benchmark run
        # holds it — and, worse, takes the lock away from that run when it wins.
        lock = self.tmp / "isolation.lock.d"
        with unittest.mock.patch.object(self.run, "ISOLATION_LOCK_DIR", lock), \
                unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.tmp)}):
            with self.run.host_isolation(enabled=True):
                self.assertFalse(marker.exists(), "state file was not moved aside")
            self.assertTrue(marker.exists(), "state file was not restored")


class TestRetryablePredicateOverride(unittest.TestCase):
    """`call_with_retry(retryable=...)` — a caller whose retry is not always safe.

    `persistence-run.py` uses it: on a turn that resumes a live session a TIMEOUT
    cannot be retried, because a killed process leaves the session state ambiguous
    and a re-send can put one logical turn into the conversation twice.
    """

    def setUp(self):
        self.run = _load("_pred_run", "run.py")
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.calls = []
        patcher = unittest.mock.patch.object(self.run.time, "sleep", lambda s: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _timeouts(self):
        def fake(cmd, **kw):
            self.calls.append(cmd)
            raise self.run.subprocess.TimeoutExpired(cmd, kw.get("timeout", 5))
        patcher = unittest.mock.patch.object(self.run.subprocess, "run", fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_predicate_still_retries_a_timeout(self):
        self._timeouts()
        _, error, _ = self.run.call_with_retry(lambda a: ["claude"], self.tmp, 5)
        self.assertEqual(error, "timeout")
        self.assertEqual(len(self.calls), self.run.RETRY_ATTEMPTS)

    def test_an_override_can_refuse_the_retry(self):
        self._timeouts()
        never = lambda err: False
        _, error, _ = self.run.call_with_retry(lambda a: ["claude"], self.tmp, 5,
                                               retryable=never)
        self.assertEqual(error, "timeout")
        self.assertEqual(len(self.calls), 1, "override was ignored — the turn retried")



if __name__ == "__main__":
    unittest.main()

