# agentic-fixture — the repo the agentic benchmark works on

A deliberately small, self-contained Node project. Every task in
`benchmarks/prompts/en-agentic.txt` is answerable by reading and editing files
here, so an agentic arm has real tool work to do and the token stream contains
what a real session's does: file reads, diffs, test output, error strings.

**It is fixed, and it MUST be reset between every single call.** Tasks mutate
files, and the harness does not reset for you — `run.py` runs one arm after
another in the same `--cwd`. Without a reset, arm 2 starts from arm 1's edits and
the arms are not answering the same question. The first attempt at this benchmark
was invalidated exactly that way. `benchmarks/agentic-run.sh` does the reset; use
it rather than calling `run.py` directly.

Keep it dependency-free (plain `node --test`) so no install step sits between the
model and the task. `npm test` on a pristine tree is **2 pass / 1 fail** — the one
failure is the bug task 1 asks the model to find.
