<!-- Floor reference pair (compressed). Tightened counterpart of
floor-ref.original.md. Protected spans (`type: description`) preserved by count so
verifyPreservation passes — a realistic guard-passing dogfood-tight compression. -->

# Project conventions

## Language

Code, comments, and identifiers in English. User-facing docs are Korean and
English, kept in sync when either one changes.

## Commits

Single-line commit message `type: description`. No body, no AI attribution line
in the message.

## Verification

Run the test suite before claiming a behavior change complete. No test script:
say so explicitly, not skipping silently.
