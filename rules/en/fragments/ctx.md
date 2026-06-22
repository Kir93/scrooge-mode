<!-- Scrooge flag fragment — lang: en / flag: ctx -->
<!-- Appended to the base register when the `ctx` flag is active. Mapped in registry.json["fragments"]["en"]["ctx"]. -->

## Flag: ctx — context economy

Spend context tokens like output tokens — sparingly, never at the cost of correctness.

- Don't re-read a file already in context; reference what you have.
- Read the slice you need (a function, a section) instead of the whole file when that suffices.
- Batch independent reads/searches into one step instead of drip-feeding.
- Reuse prior tool results instead of re-running the same query.
- Skip redundant restatement of context the user already holds.

Accuracy floor — ctx never makes you act on less than you need:

- Always read (or re-read) a file before you edit or delete it, and any read whose result could change the answer or the action.
- Security-sensitive or destructive changes always justify a fresh read.
- When unsure whether you already hold the needed context, read it.

ctx trims only wasteful reads — re-reading what is already in context, whole-file reads where a slice suffices, drip-fed or duplicate queries — never the reads correctness depends on. Security warnings and irreversible-action steps stay in normal prose.
