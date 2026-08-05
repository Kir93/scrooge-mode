#!/usr/bin/env bash
# agentic-run.sh — drive the agentic corpus with a fixture reset before EVERY call.
#
# run.py runs arm after arm in one --cwd and never resets. On an agentic corpus the
# tasks MUTATE that cwd, so without a reset arm 2 starts from arm 1's edits: the
# arms stop answering the same question and the comparison is void. The first
# attempt at this benchmark was invalidated exactly that way — a large apparent
# win turned out to be later arms finding the work already done.
#
# So: restore the fixture from a pristine tarball, run ONE (arm, prompt) pair,
# repeat. --resume makes each invocation execute only the pair that is missing.
#
# usage: benchmarks/agentic-run.sh <n-prompts> <arm[,arm...]> <output.jsonl>
set -euo pipefail

N="${1:?prompt count}"; ARMS="${2:?arms}"; OUT="${3:?output}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$REPO/benchmarks/agentic-fixture"
PRISTINE="${AGENTIC_PRISTINE:-/tmp/ag-fixture-pristine.tgz}"
GLOBAL_MD="$HOME/.claude/CLAUDE.md"
ASIDE="$HOME/.claude/CLAUDE.md.bench-aside"

[ -f "$PRISTINE" ] || { echo "missing pristine tarball: $PRISTINE" >&2; exit 1; }

reset_fixture() { rm -rf "$FIX"; tar xzf "$PRISTINE" -C "$REPO/benchmarks"; }
restore() { [ -e "$ASIDE" ] && mv "$ASIDE" "$GLOBAL_MD"; reset_fixture; }
trap restore EXIT INT TERM

# The global CLAUDE.md is user context, not a register — it reaches every arm
# equally but carries unrelated workflow rules, so it goes aside for the run.
[ -e "$GLOBAL_MD" ] && mv "$GLOBAL_MD" "$ASIDE"

for p in $(seq 1 "$N"); do
  IFS=',' read -ra ARR <<< "$ARMS"
  for arm in "${ARR[@]}"; do
    reset_fixture
    python3 "$REPO/benchmarks/run.py" \
      --prompts "$REPO/benchmarks/prompts/en-agentic.txt" \
      --arms "$arm" --runs 1 --model "${AGENTIC_MODEL:-claude-opus-4-8}" \
      --resume --max-prompts "$p" --timeout 300 \
      --system-prompt-mode append --cwd "$FIX" --output "$OUT" \
      2>&1 | grep -E "^\s+\[[0-9]+/" || true
  done
done
