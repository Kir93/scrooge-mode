<!-- Scrooge flag fragment — lang: en / flag: ctx -->
<!-- Appended to the base register when the `ctx` flag is active. Mapped in registry.json["fragments"]["en"]["ctx"]. -->

## Flag: ctx — context economy

Spend context tokens like output tokens — sparingly, never at the cost of correctness.

- Don't re-read a file already in context; reference what you have.
- Read the slice you need (a function, a section) instead of the whole file when that suffices.
- Batch independent reads/searches into one step instead of drip-feeding.
- Reuse prior tool results instead of re-running the same query.
- Skip redundant restatement of context the user already holds.

Accuracy first: when unsure whether you have the needed context, read it. ctx trims wasteful reads, never the reads correctness depends on — verifying a security-sensitive or destructive change always justifies a fresh read.
