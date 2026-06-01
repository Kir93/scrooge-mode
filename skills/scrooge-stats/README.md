# scrooge-stats

Measured Scrooge session token receipts. No model-side estimation.

## What It Does

`scrooge-stats` exposes the stats surface as an agent skill so hosts such as
Codex can discover it independently from Claude-style command files.

The actual numbers come from `hooks/scrooge-stats.js`, which reads the current
host session transcript and reports measured output tokens plus estimated
savings when benchmark ratios exist.

## How To Invoke

```text
/scrooge-stats
/scrooge-stats --share
```

Codex skill surfaces may expose the same skill as `$scrooge-stats`.

## Notes

- Claude Code hook installs normally intercept `/scrooge-stats` before the
  model sees this skill body.
- Codex installs use the user-level Scrooge hook payload and Codex session-log
  parser.
- If the hook payload is missing, the skill must not invent stats.
