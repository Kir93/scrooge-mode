# EN QA Checklist

Self-review baseline for Scrooge `en/full` output quality. Source rules: [rules/en/full.md](../rules/en/full.md), including the safety-escape behavior described in its [Auto-Clarity](../rules/en/full.md#auto-clarity) section.

EN-specific counterpart to [docs/ko-qa-checklist.md](ko-qa-checklist.md). Categories that only apply to Korean (honorific removal, particle drop) are dropped; a Language-fidelity category is added because the EN dial must not regress to Korean output.

**Scope.** Categories A–E judge `en/full`; F and G cover the `lean` flag (on by default) and the `lite` dial. This is a **human self-review** aid, not an automated gate — nothing here runs in `npm test`, and it is deliberately not a frozen fixture set (`RELEASE.md` pins rule-text regression to the manual judge gate instead). Checklists exist for `en` and `ko` only; `ja`/`hi`/`zh` have none, because writing one without a native reviewer would make the fixture itself the wrong baseline.

## Categories

### A. Compression register, normal grammar

Output uses compact bullets/fragments, article drop, subject pro-drop, and `→` causality — but keeps **normal English grammar** (verb conjugation, subject-verb agreement). Telegraphic pidgin (`no know`, `planner pick`, `child see`) is out of scope: that is caveman's register, not Scrooge's. Scrooge trades a few tokens for grammatical clarity and i18n parity by design.

- PASS: `Cause: parent re-renders → child gets new prop refs. Fix: wrap in React.memo.`
- FAIL (verbose): `The reason this is happening is that the parent component re-renders, which in turn causes...`
- FAIL (pidgin): `Parent re-render. Child get new prop. Child re-render too.`

### B. Code, error, and identifier verbatim

Identifiers, commands, flags, API names, error strings, and code blocks stay exact. English prose compresses around them.

- PASS: `` `useMemo`, `ERR_MODULE_NOT_FOUND`, `npm ci` kept verbatim. ``
- FAIL: abbreviating `useCallback` to `useCB`, or paraphrasing an error string.

### C. Safety prose (auto-clarity)

Security warnings and irreversible-action confirmations leave the compressed register and use normal full-sentence prose, matching core spec G7 safety-escape.

- PASS: `This command permanently deletes the files in ~/Downloads. Back up anything you need and confirm the path before running.`
- FAIL: `Danger. Backup, then run.`

### D. Hedging to assertion

Hedges (`might`, `could`, `perhaps`, `seems like`, `I think`) become assertions, or are labeled `unverified`. No empty pleasantries (`sure`, `happy to`).

- PASS: Bug in auth middleware. Token expiry uses `<`, should be `<=`.
- FAIL: It seems the token check might be slightly off — perhaps consider using `<=`?

### E. Language fidelity

`en/full` responds in **English**. A Korean response under the EN dial is a failure — a real regression observed when the host `~/.claude/CLAUDE.md` "Respond in Korean" instruction leaks into the measurement context (see Task 1 measurement finding in the `en-full-hardening` spec). Technical terms stay verbatim regardless of prose language.

- PASS: English prose with verbatim identifiers.
- FAIL: Korean prose answering an English-dial prompt (`컴포넌트가 매번 리렌더됩니다...`).

### F. `lean` flag — minimal code output

`lean` is on by default, so most sessions are judged with it active. It cuts scope and narration in code answers, never correctness. Check the code the answer produces, not its prose.

- PASS: the snippet solves exactly what was asked — no unrequested option, config knob, or single-use abstraction; an existing helper or stdlib call is reused instead of reimplemented.
- PASS: no commentary on how the answer was minimized ("I could also…", "another approach would be…", a library-vs-hand-rolled comparison).
- FAIL: speculative flexibility — a parameter, hook, or config the prompt never asked for, "in case you need it later".
- FAIL: input validation, error handling, or a required test dropped to look leaner. `lean` narrows scope, never safety.

### G. `lite` dial — trimmed, not fragmented

Judge `lite` output against `rules/en/lite.md`, not `full`. `lite` keeps full grammar and complete sentences; it only removes filler, pleasantries, and hedging.

- PASS: The token expiry check in auth middleware has a bug. It should use `<=` instead of `<`.
- FAIL (over-compressed): auth middleware bug. token expiry `<` not `<=`. — that is `full`'s register leaking into `lite`.
- FAIL (guard dropped): a trade-off, caveat, or requested step removed. Those guards apply in every dial, so a `lite` answer that sheds them fails the same way a `full` one would.

## Sample 1 — simple technical question

Prompt: `How do I check the Node version?`

Output:

```text
`node --version`

Project requirement: `package.json` `engines.node`.
```

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | Short fragments, normal grammar, no padding. |
| B | PASS | Command and `package.json`, `engines.node` verbatim. |
| C | PASS | Not a safety/irreversible context. |
| D | PASS | Direct, no hedging. |
| E | PASS | English output. |

## Sample 2 — error-fix

Prompt: `In an Express middleware, req.user is sometimes undefined. List common causes.`

Output:

```text
`req.user` undefined — common causes:

- **Auth middleware not run**: route mounted before or without it.
- **Middleware order**: your handler registered before the middleware that sets `req.user`.
- **Token missing/expired**: no `Authorization` header, or verify failed and `next()` called anyway.
- **Async gap**: DB lookup not awaited → `req.user` set after the handler runs.
- **Wrong key**: value on `req.currentUser` / `res.locals.user`, not `req.user`.
```

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | Bullets, fragments, normal grammar. |
| B | PASS | `req.user`, `Authorization`, `next()` verbatim. |
| C | PASS | No safety-critical content. |
| D | PASS | Assertive causes, no hedging. |
| E | PASS | English output. |

## Sample 3 — safety warning

Prompt: `Can I just run rm -rf ~/Downloads/* right now?`

Output:

````text
Do not run it yet. This command can irreversibly delete everything in `~/Downloads`. First list the targets, back up anything you need, and confirm the path is the one you intend.

To check:

```bash
find ~/Downloads -maxdepth 1 -mindepth 1 -print
```
````

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | Auto-clarity context allows full prose. |
| B | PASS | `rm -rf`, `~/Downloads`, `find` verbatim. |
| C | PASS | Irreversible-delete risk explained in normal prose. |
| D | PASS | Direct warning, no hedging. |
| E | PASS | English output. |

## Sample 4 — code block + English explanation

Prompt: `Show a fetch timeout example.`

Output:

````text
Use `AbortController` for an explicit timeout.

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const res = await fetch(url, { signal: controller.signal });
  return await res.json();
} finally {
  clearTimeout(timeout);
}
```

Add an `AbortError` branch to handle the timeout case.
````

| Category | Result | Notes |
| -------- | ------ | ----- |
| A | PASS | Explanation stays in fragments, normal grammar. |
| B | PASS | JS code, `AbortController`, `AbortError`, `fetch` verbatim. |
| C | PASS | Not a safety/irreversible context. |
| D | PASS | No hedging. |
| E | PASS | English output. |

## Summary

| Sample | A | B | C | D | E |
| ------ | - | - | - | - | - |
| 1 | PASS | PASS | PASS | PASS | PASS |
| 2 | PASS | PASS | PASS | PASS | PASS |
| 3 | PASS | PASS | PASS | PASS | PASS |
| 4 | PASS | PASS | PASS | PASS | PASS |
