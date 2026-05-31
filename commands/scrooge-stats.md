---
description: 현재 세션의 실측 출력 토큰과 (벤치마크 존재 시) 추정 절감량 표시 — measured output tokens + estimated savings for this session
argument-hint: '[--share]'
disable-model-invocation: true
---

# scrooge-stats

The `UserPromptSubmit` hook (`hooks/scrooge-activate.js`) intercepts a
`/scrooge-stats` prompt, runs `hooks/scrooge-stats.js` against the active session
transcript, and blocks the turn — returning the stats block as the hook reason.
`--share` swaps the full block for a one-line summary.

So on Claude Code the work happens in the hook before the model sees this body.
On hosts without the activation hook, run it directly:
`node hooks/scrooge-stats.js [--share]`.
