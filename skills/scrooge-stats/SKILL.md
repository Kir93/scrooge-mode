---
name: scrooge-stats
description: >
  Show measured Scrooge session token usage and estimated savings when
  available. Use when the user invokes /scrooge-stats, $scrooge-stats, asks for
  Scrooge token stats, or asks how many output tokens Scrooge saved.
disable-model-invocation: true
---

This skill is delivered by `hooks/scrooge-stats.js` (read by
`hooks/scrooge-activate.js` on `/scrooge-stats`). The model does not compute or
estimate token usage. The hook reads the active Claude/Codex transcript and
returns `decision: "block"` with the formatted stats. If the hook did not run,
report that the stats hook payload is unavailable; do not fabricate numbers.
