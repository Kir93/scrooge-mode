# context-audit — Phase 0 measurement harness

Deterministic, LLM-free measurement of whether a `scrooge audit` feature is worth
building. It statically audits the context docs injected every session
(`CLAUDE.md` / `AGENTS.md` / `rules/**`) for three removable-waste categories and
scores detection rate + byte-exact saving against a GO/NO-GO threshold.

> **Phase 0 is measurement only.** The `scrooge audit` command and any
> rewrite/compression logic are Non-goals until this gate returns GO. The
> detectors here are throwaway measurement prototypes isolated under
> `benchmarks/context-audit/` — the product surface (`lib/` · `hooks/` · `bin/`)
> is never touched. Anchors: mcp-shrink 2.6% NO-GO, memory-compress 7.7% floor.

## Categories

| key | category | deterministic basis |
| --- | -------- | ------------------- |
| `dup` | duplicate blocks | exact + normalized paragraph hash (threshold exposed) |
| `dead` | dead-letter rules | broken path refs (target absent on disk) + stale markers (`pending` / `until X lands` / `TBD Task N` / `TODO`) |
| `lowdensity` | low-density prose | filler dictionary + density heuristic (KO/EN) |

Only the **deterministic subset** of each category is measured — semantic
dead-letter judgment is a Non-goal (would need an LLM). Recall is reported honestly
against that subset, never claimed as full-category recall.

## Corpus

- **self-repo** (`corpus.json` `files[].source: self-repo`) — the real injected
  docs. Dogfood-tight (floor regime), so detection is expected to be low. These
  are the **unlabeled wild set**: flagged counts are reported but not scored
  (recall/precision), because their content drifts with normal edits (spec §3
  cross-dependency #1). This keeps the committed report reproducible.
- **synthetic** (`samples/*.md`) — labeled ground-truth fixtures with clear
  duplicate blocks, dead markers, and filler. Scoring (recall/precision) runs over
  these only, so a self-repo edit never invalidates the numbers.
- **local_expansion** — optional private files (a maintainer's real `CLAUDE.md`),
  added to a local `corpus.json` and **never committed** (local-corpus convention,
  `benchmarks/README.md`). Only the synthetic reproducible measurement is committed.

## Honesty rules baked in

- **Protected-span masking (G3)** — `protectedSpans` (reused from
  `lib/memory-compress.js`) marks security / code / path / URL spans; masked bytes
  count as **0** removable. We never count as saving what the product guard cannot
  remove.
- **Duplicate-block guard modeling (F2)** — a duplicate block's removable is
  counted only if `verifyPreservation` (reused) still passes after simulating the
  removal. A block holding a protected span whose count drops (N→N−1) is REJECTed
  → the **whole block** (prose included) counts 0. Prevents overstating marginal.
- **Marginal ≠ memory-compress (G4, F1)** — low-density prose is the axis
  memory-compress already absorbs, so it is **excluded** from marginal; only the
  structural categories (`dup` + `dead`) count as net-new value. This avoids
  double-counting and is computed by category exclusion, with no LLM compressed
  text generated.

## Floor re-measurement

`compressionDelta` is deterministic but does **not** generate compressed text (it
is a token-delta meter over two existing texts), so the memory-compress **floor
point** is re-measured against a committed reference pair
(`samples/floor-ref.original.md` + `.compressed.md`) declared in
`corpus.json` `floor_pair`. Re-running yields a bit-identical delta. This pair sits
in the single-digit dogfood-tight floor regime near the historical **7.7%** anchor
(superset spec); it is a reference fixture for deterministic re-measurement, not a
re-run of that original LLM measurement. The corpus-expansion **range**
(min/median/max) needs live per-file LLM compression and is therefore isolated to
Task 4 (`mc-range.js`) — LLM-dependent, non-bit-identical, excluded from the
deterministic GO verdict (F1).

## Reproduce

```bash
node benchmarks/context-audit/run.js        # deterministic report -> results/ (Task 3)
npm test                                     # detector determinism + masking canaries
```

No subscription quota, no LLM, no external dependency — the deterministic core is
zero-dep `node` and CI-testable, mirroring `benchmarks/fidelity/checks.js`.

## Files

| path | role |
| ---- | ---- |
| `corpus.json` | corpus manifest (self-repo + synthetic + local slot + floor pair) |
| `labels.jsonl` | labeled ground truth (`{file, category, anchor, note}`) |
| `lib.js` | shared util: loader, byte/token wrappers, protected-span masking, label schema |
| `samples/{medium,loose}.md` | synthetic labeled fixtures |
| `samples/floor-ref.{original,compressed}.md` | floor re-measurement reference pair |
| `detectors.js` | the three deterministic detectors (Task 2) |
| `run.js` | scorer + GO/NO-GO report (Task 3) |
| `mc-range.js` | LLM-dependent range measurement (Task 4, optional) |
| `results/` | committed reproducible reports |
