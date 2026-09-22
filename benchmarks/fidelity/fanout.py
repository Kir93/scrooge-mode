#!/usr/bin/env python3
"""fidelity/fanout.py — judge several languages under ONE host-isolation window.

`host_isolation` takes a machine-global lock (benchmarks/run.py `isolation_lock_dir`),
so five hand-started `fidelity/run.py` processes do not run side by side: the second
one exits 2 rather than clobber the first one's backups. This driver holds that lock
once and starts the per-language children with `--no-isolate-host`.

The children then skip more than the lock. `fidelity/run.py`'s `--no-isolate-host`
branch bypasses `verify_register_clean` too — the check lives only in the isolated
branch — so the driver runs it here instead. Without that, a run with the user's own
scrooge hook active would judge every pair through a biased judge and say nothing.

Execution and preflight are `run.py`'s, imported rather than reimplemented, the same
way `benchmarks/iso-single.py` does it.

Pairs up to `len(results) x --workers` judge calls run at once; the README's "2-4
only when quota is ample" advice is about that product, not about either factor.

usage:
  python3 benchmarks/fidelity/fanout.py \
    benchmarks/results-{ko,en,ja,hi,zh}-report-v025.jsonl \
    -- --judge-runs 3 --resume
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import queue
import re
import signal
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
BENCH_DIR = HERE.parent

sys.path.insert(0, str(HERE))  # fidelity/run.py imports its sibling `judge` by name


def _load(name: str, path: Path):
    """Load a script as a module. `sys.modules` registration precedes exec_module:
    run.py's @dataclass with `from __future__ import annotations` resolves field
    types via sys.modules[cls.__module__]."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


BENCH = _load("_bench_run", BENCH_DIR / "run.py")
FID = _load("_fid_run", HERE / "run.py")

# <dir>/results-<tag>-report<suffix>.jsonl -> <dir>/fidelity/results-<tag>-fidelity<suffix>.jsonl
RESULTS_NAME = re.compile(r"^results-(?P<tag>.+?)-report(?P<suffix>.*)\.jsonl$")


def derive_job(results: Path, baseline_arm: str) -> tuple[str, str, Path]:
    """(tag, candidate_arm, output_path) for one results file. Raises ValueError —
    a job the driver cannot name is a job it must not silently skip."""
    m = RESULTS_NAME.match(results.name)
    if not m:
        raise ValueError(f"{results.name}: expected results-<tag>-report<suffix>.jsonl")
    arms = {r.get("arm") for r in FID.load_rows(results)} - {None}
    candidates = sorted(arms - {baseline_arm})
    if len(candidates) != 1:
        raise ValueError(
            f"{results.name}: need exactly one arm besides {baseline_arm!r}, found {candidates}")
    # Relative to the INPUT, not to this file: a results file elsewhere (a test
    # tempdir, a scratch copy) must not append rows into the repo's fidelity/.
    out = results.parent / "fidelity" / f"results-{m['tag']}-fidelity{m['suffix']}.jsonl"
    return m["tag"], candidates[0], out


def _pump(stream, tag: str, sink: queue.Queue):
    """Relay a child's output line by line, tagged. fidelity/run.py's progress
    lines name the arm, but its `[note]`, `resume:` and aggregate lines do not, and
    five children interleave — an untagged `error:` line would belong to nobody."""
    for line in iter(stream.readline, ""):
        sink.put(f"[{tag}] {line.rstrip()}")
    stream.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("results", nargs="+", type=Path,
                    help="benchmarks/run.py output files, one per language.")
    ap.add_argument("--baseline-arm", default="normal",
                    help="Baseline arm. Default normal. Also used to derive each "
                         "candidate arm from its results file.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Skip isolation and pass --dry-run to every child (no quota).")
    ap.add_argument("--allow-contaminated", action="store_true",
                    help="Proceed despite blocking register-hook findings.")
    argv = sys.argv[1:]
    passthrough: list[str] = []
    if "--" in argv:
        cut = argv.index("--")
        argv, passthrough = argv[:cut], argv[cut + 1:]
    args = ap.parse_args(argv)

    # The driver owns these child flags; a passthrough copy would win by argparse
    # last-wins and, for --output, funnel every language into one file where their
    # (prompt_id, run) keys collide.
    owned = {"--results", "--candidate-arm", "--output", "--no-isolate-host", "--baseline-arm"}
    clash = sorted(owned & {a.split("=", 1)[0] for a in passthrough})
    if clash:
        print(f"error: {' '.join(clash)} belong to the driver, not after `--`", file=sys.stderr)
        return 2
    if "--dry-run" in passthrough:
        args.dry_run = True  # a child-only dry-run would still take the lock here

    jobs = []
    for r in args.results:
        if not r.exists():
            print(f"error: results file not found: {r}", file=sys.stderr)
            return 2
        try:
            jobs.append((*derive_job(r, args.baseline_arm), r))
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2

    workers = 1
    for i, a in enumerate(passthrough):
        if a == "--workers" and i + 1 < len(passthrough):
            workers = int(passthrough[i + 1])
        elif a.startswith("--workers="):
            workers = int(a.split("=", 1)[1])
    print(f"fanout: {len(jobs)} job(s) x --workers {workers} = up to "
          f"{len(jobs) * workers} concurrent judge calls", file=sys.stderr)
    for tag, arm, out, r in jobs:
        print(f"  {tag}: {r} [{arm}] -> {out}", file=sys.stderr)

    with BENCH.host_isolation(enabled=not args.dry_run):
        if not args.dry_run:
            # The children skip this check entirely (`--no-isolate-host`), so it
            # happens here — inside the window, which is what makes it a check that
            # the state files actually moved.
            if BENCH.check_register_clean(BENCH_DIR, args.allow_contaminated,
                                          per_row_backstop=False) is None:
                return 2

        sink: queue.Queue = queue.Queue()
        procs, pumps = [], []
        # Everything from the first spawn on runs under this try: a Ctrl-C between
        # two spawns must still reap the children already started.
        try:
            for tag, arm, out, r in jobs:
                cmd = [sys.executable, str(HERE / "run.py"),
                       "--results", str(r), "--candidate-arm", arm,
                       "--baseline-arm", args.baseline_arm,
                       "--output", str(out), "--no-isolate-host"]
                if args.dry_run:
                    cmd.append("--dry-run")
                cmd += passthrough
                # No env=: host_isolation works by moving files under
                # claude_config_dir(), which children resolve themselves. Passing an
                # explicit env risks dropping CLAUDE_CONFIG_DIR, and then the parent
                # isolates one directory while the children read another.
                # start_new_session: each child heads its own process group, so the
                # reap below reaches its `claude` / `node` grandchildren too — a bare
                # terminate() would orphan a judge call mid-flight.
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, bufsize=1, start_new_session=True)
                procs.append((tag, proc))
                t = threading.Thread(target=_pump, args=(proc.stdout, tag, sink), daemon=True)
                t.start()
                pumps.append(t)

            # Drain while the children run, then join before leaving the isolation
            # window: host_isolation's restore knows nothing about child processes,
            # and a judge call that outlives it runs under a live register hook
            # while its row still looks clean.
            alive = True
            while alive or not sink.empty():
                try:
                    print(sink.get(timeout=0.2), file=sys.stderr)
                except queue.Empty:
                    pass
                alive = any(t.is_alive() for t in pumps)
        finally:
            # Reached on the normal path (children already exited) and on Ctrl-C /
            # any exception. The children are in their own sessions, so a terminal
            # Ctrl-C does not reach them — this is the only thing that stops them.
            for _, proc in procs:
                for sig in (None, signal.SIGTERM, signal.SIGKILL):
                    if sig is not None and proc.poll() is None:
                        os.killpg(proc.pid, sig)
                    try:
                        proc.wait(timeout=5)
                        break
                    except subprocess.TimeoutExpired:
                        continue
            for t in pumps:
                t.join(timeout=5)
            while not sink.empty():  # a child's last lines, e.g. its HEADLINE
                print(sink.get_nowait(), file=sys.stderr)
        failed = [(tag, proc.wait()) for tag, proc in procs]

    bad = [(tag, rc) for tag, rc in failed if rc != 0]
    for tag, rc in bad:
        print(f"fanout: {tag} exited {rc}", file=sys.stderr)
    if bad:
        # Silence here would be the dangerous outcome: a child that died before
        # judging leaves its previous output file untouched, and --resume makes that
        # look like a completed re-measurement of the current register.
        print(f"fanout: {len(bad)}/{len(failed)} job(s) failed", file=sys.stderr)
        return 1
    print(f"fanout: {len(failed)} job(s) ok", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
