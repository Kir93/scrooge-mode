<!-- Floor reference pair (original). Committed memory-file excerpt used ONLY for
the deterministic `compressionDelta` re-measurement in run.js — NOT part of the
detection corpus. Its compressed counterpart is floor-ref.compressed.md. Already
dogfood-tight: only a few connectives are removable, so the delta lands in the
single-digit floor regime near the historical 7.7% anchor (superset spec). This is
a reference fixture for deterministic re-measurement, not a re-run of that original
LLM compression. The leading comment is stripped before measurement (see lib.js
loadFloorPair). -->

# Project conventions

## Language

Code, comments, and identifiers in English. User-facing docs are Korean and
English, kept in sync when either one changes.

## Commits

Single-line commit message `type: description`. No body, and no AI attribution
line anywhere in the message.

## Verification

Run the test suite before claiming a behavior change complete. If the project has
no test script, say so explicitly rather than skipping silently.
