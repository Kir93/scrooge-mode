# Doc-generation before/after samples

Real `claude --print` outputs from the document-generation benchmark — the same
prompt run through the verbose baseline and through Scrooge, so you can read what
the doc-compression register actually changes.

| File | Arm | Output tokens |
| ---- | --- | ------------: |
| `ko-release-notes.normal.md`  | `normal` (baseline) | 1839 |
| `ko-release-notes.scrooge.md` | `scrooge:ko/full`          |  776 |
| `en-release-notes.normal.md`  | `normal` (baseline) |  848 |
| `en-release-notes.scrooge.md` | `scrooge:en/full`          |  422 |

- **Prompt** (the release-notes task — index 5, the 6th non-comment line — of
  [`../prompts/ko-docgen.txt`](../prompts/ko-docgen.txt) /
  [`en-docgen.txt`](../prompts/en-docgen.txt)): write release notes for `taskline`
  v2.3.0 grouping six pinned changes by user impact. Both arms carry the **same six
  changes** — only the register differs.
- **Model**: `claude-opus-4-8`. Token counts are the runtime's `usage.output_tokens`
  (prose bucket), not a tokenizer estimate.
- **Clean baseline**: run with the host `CLAUDE.md` neutralized and
  `--disallow-tools` (inline output, no file offload), so the `normal` sample reflects
  a default assistant, not one shaped by the local `CLAUDE.md` (per-machine
  `settings.json` hooks/plugins still load, but apply equally to both arms).

What Scrooge drops: the meta-prologue ("릴리스 노트입니다…"), the closing "want me to
also reformat this?" offer, and per-item over-explanation. What it keeps: every one
of the six changes, the grouping, and the code/upgrade detail. These are single-run
samples — see [`docgen-results.md`](./docgen-results.md) for the full per-prompt token
tables and [`../README.md`](../README.md) for corpus-level numbers and variance.

## Conversational sample (JA)

| File | Arm | Output tokens |
| ---- | --- | ------------: |
| `ja-foreach-async.normal.md`  | `normal` (baseline) | 1914 |
| `ja-foreach-async.scrooge.md` | `scrooge:ja/full`   |  555 |

A held-out report-corpus prompt (the `forEach(async …)` sequential-save bug —
[`../prompts/ja-report.txt`](../prompts/ja-report.txt)), `scrooge:ja/full` vs `normal`:
**~71% fewer output tokens**, same diagnosis (forEach ignores the async callback's
Promise → 4 failure modes) and same fix (`for...of` + await vs `Promise.all`).
Conversational, not doc-generation — shows the JA register (keigo stripping ·
体言止め · 助詞 drop). Measured **cwd-isolated** so the `normal` baseline answers in
Japanese, not a host-`CLAUDE.md` "respond in Korean" instruction.
