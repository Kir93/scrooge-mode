---
description: 현재 세션의 실측 출력 토큰과 (벤치마크 존재 시) 추정 절감량 표시 — measured output tokens + estimated savings for this session
argument-hint: '[--share]'
allowed-tools: Bash
---

# scrooge-stats

Show measured Scrooge session token usage and an estimated savings figure.

**Primary path — hook intercept.** The `UserPromptSubmit` hook
(`hooks/scrooge-activate.js`) catches the raw `/scrooge-stats` prompt, runs
`hooks/scrooge-stats.js` against the active session transcript, and blocks the
turn — returning the stats block directly. When that fires you never see this
body, and the model never computes anything.

**Fallback — you are reading this because the hook did not intercept.** Run the
script yourself and show its output verbatim:

```bash
node hooks/scrooge-stats.js
```

Append `--share` for a one-line summary. Do **not** recompute or estimate tokens
yourself — report only what the script prints (measured output tokens, plus a
benchmark-based "(est)" savings figure when available). If the script is not
found (a host without the repo), say so rather than fabricating numbers.
