#!/usr/bin/env python3
"""`--workers N` must judge concurrently AND land the same rows as serial.

The judge step had no worker knob while generation did (`benchmarks/run.py:1110`),
so the release-time gate spent hours in the one stage that could not fan out.
Parallelising the stage that produces published numbers needs two guards, not one:

  - same rows as serial, compared as a SET. Order is free: aggregate() dedups by
    (prompt_id, run) and one run emits one row per key, so completion order cannot
    reach a number.
  - actually concurrent. A pool that silently ran one at a time would pass the
    equality check alone — a green fixture proving nothing.

Plus the structural rule the design rests on: rows are written by ONE thread
(`benchmarks/run.py:1193-1223` uses the same split), which removes torn JSONL
lines as a category rather than guarding them with a lock. load_rows() drops an
unparseable line silently, so a torn write would never surface.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import shutil
import tempfile
import threading
import time
import types
import unittest
import unittest.mock


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


PAIRS = 8


def _results_fixture(path: pathlib.Path):
    """A minimal benchmarks/run.py output: one `normal` + one candidate row per prompt."""
    rows = []
    for pid in range(PAIRS):
        rows.append({"arm": "normal", "prompt_id": pid, "run": 0,
                     "output_text": f"baseline answer {pid}", "output_tokens": 100 + pid})
        rows.append({"arm": "scrooge:ko/full", "prompt_id": pid, "run": 0,
                     "output_text": f"compressed {pid}", "output_tokens": 40 + pid})
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


class _Probe:
    """Stub judge + instrumentation: concurrency peak and writer threads."""

    def __init__(self):
        self.lock = threading.Lock()
        self.live = 0
        self.peak = 0
        self.writer_threads = set()

    def judge_pair(self, baseline, candidate, model, timeout=120, dry_run=False, runs=1):
        with self.lock:
            self.live += 1
            self.peak = max(self.peak, self.live)
        try:
            time.sleep(0.05)  # long enough for a real pool to overlap
            # Deterministic in the pair's content, so serial and parallel must agree.
            score = round(len(candidate) / (len(baseline) + len(candidate)), 4)
            return {"equivalent": True, "verdict": {"score": score, "missingClaims": []},
                    "byteExact": {"pass": True}, "safety": {"pass": True},
                    "strictPass": True, "judge_runs": runs, "run_scores": [score] * runs,
                    "run_equivalents": [True] * runs, "judge_error": None,
                    "judge_partial_error": None}
        finally:
            with self.lock:
                self.live -= 1

    def dumps(self, *a, **kw):
        # run.py calls json.dumps in exactly one place: the row writer. Recording the
        # calling thread here is what pins "no worker touches the output file".
        self.writer_threads.add(threading.current_thread().name)
        return json.dumps(*a, **kw)


def _run(workers, results, out):
    mod = _load(f"_fidw_{workers}", "fidelity/run.py")
    probe = _Probe()
    # --dry-run is a belt to the stub's braces: if the patch ever misses, the
    # runner still spends no quota.
    argv = ["run.py", "--results", str(results), "--candidate-arm", "scrooge:ko/full",
            "--output", str(out), "--dry-run", "--workers", str(workers)]
    # Swap the module's `json` reference, not json.dumps itself: patching the real
    # module would make the probe recurse into its own replacement.
    shim = types.SimpleNamespace(dumps=probe.dumps, loads=json.loads,
                                 JSONDecodeError=json.JSONDecodeError)
    with unittest.mock.patch.object(sys.modules["judge"], "judge_pair", probe.judge_pair), \
            unittest.mock.patch.object(mod, "json", shim), \
            unittest.mock.patch.object(sys, "argv", argv):
        rc = mod.main()
    rows = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
    return rc, rows, probe


class TestJudgeWorkers(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.results = self.tmp / "results.jsonl"
        _results_fixture(self.results)

    def test_workers_produce_the_same_rows_as_serial(self):
        rc1, serial, _ = _run(1, self.results, self.tmp / "serial.jsonl")
        rc4, parallel, _ = _run(4, self.results, self.tmp / "parallel.jsonl")
        self.assertEqual((rc1, rc4), (0, 0))
        self.assertEqual(len(serial), PAIRS)
        key = lambda rows: sorted(json.dumps(r, sort_keys=True) for r in rows)
        self.assertEqual(key(serial), key(parallel))

    def test_workers_actually_run_concurrently(self):
        _, _, probe = _run(4, self.results, self.tmp / "parallel.jsonl")
        self.assertGreater(probe.peak, 1,
                           "--workers 4 judged one pair at a time; the pool is not wired")

    def test_serial_stays_serial(self):
        _, _, probe = _run(1, self.results, self.tmp / "serial.jsonl")
        self.assertEqual(probe.peak, 1)

    def test_only_one_thread_writes_rows(self):
        _, _, probe = _run(4, self.results, self.tmp / "parallel.jsonl")
        self.assertEqual(len(probe.writer_threads), 1,
                         f"rows written from {probe.writer_threads}; writes must stay on "
                         "one thread so a torn JSONL line is impossible")
        self.assertEqual(probe.writer_threads, {threading.main_thread().name})


if __name__ == "__main__":
    unittest.main()
