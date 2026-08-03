# Release procedure

Maintainer runbook for publishing Scrooge. Both install paths resolve **directly
from the public GitHub repo** — no central submission is required to make them
work. Tagging + pushing is the release.

Repo: `Kir93/scrooge-mode`. Plugin/marketplace name: `scrooge`. npm name: `scrooge-mode`.

## Version sources (must match)

A release sets one version in six places. They must be identical:

| File | Field |
| ---- | ----- |
| `package.json` | `version` |
| `.claude-plugin/marketplace.json` | `metadata.version` |
| `.claude-plugin/marketplace.json` | `plugins[0].version` |
| `.claude-plugin/plugin.json` | `version` |
| `package-lock.json` | `version` |
| `package-lock.json` | `packages[""].version` |

`npm test` runs `test_version_consistency`, which fails if any of the six
sources drifts — so a bump that misses one is caught before a tag is pushed.

The lockfile pair is not hand-edited: run `npm install --package-lock-only`
after bumping `package.json`. `npm ci` succeeds even when the lockfile version
disagrees, so this guard is the only thing that catches it.

## 1. Pre-flight

Run from a clean tree on `main`:

- `npm test` — passes (Node `node:test` harness).
- `npx markdownlint-cli2 "**/*.md"` — clean.
- `node -e "JSON.parse(require('fs').readFileSync('registry.json'))"` and the same
  for `package.json`, `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json` — all parse.
- Every `registry.json` path resolves to an existing `rules/**` file, and every
  `rules/**` file is reachable from the registry.
- Bilingual + dial parity holds (`ko`/`en`, `lite`/`full`, `README.md`/`README.ko.md`).
- Doc-truth: no language with a measured savings/fidelity section still carries a
  "measurement pending" sentence (the `npm test` doc-truth guard enforces this).
- The six version sources above match (`npm test` guards this).

## 1a. Fidelity judge gate (manual, release-time)

The LLM **claim-equivalence judge** is a release-time **manual, local** gate: it runs
on a subscription CLI, so it structurally cannot run in CI. CI runs only the
**deterministic** half — the golden-corpus tripwire (`tests/test_golden_corpus.js`,
inside `npm test`) — which is a **weak proxy** for claim-preservation. The judge is the
measured half. (Per the savings-measurement decision ADR-003: a benchmark
re-measurement consumes subscription quota — an external action behind a human
approval gate, not metered cash — which is why it stays manual.)

**Rule-regression detection lives here, not in CI (F1).** The deterministic CI check
runs over a *frozen* corpus, so it is blind to `rules/**` edits — checks.js returns the
same verdict before and after a rule change. Catching a real rule/register regression
is therefore split across two signals, both outside the deterministic check:

- the **CI rule-diff marker** — a PR **or a direct push to `main`** touching `rules/**`
  gets a non-blocking "register 재측정 필요" annotation (`.github/workflows/ci.yml`),
  flagging that this gate may need a re-run — so a `/my-release` direct push surfaces the
  reminder too, not only an external contributor's PR;
- **this judge gate** — the actual re-measurement.

**When to re-measure — minimal trigger.** Re-run the judge only on a **substantive**
register change; skip it otherwise. Substantive = an edit that can move model output:
adding/removing/changing the meaning of an instruction, a dial tone change, or an edit
to a safety/boundary clause. Exempt (no re-measurement): a typo fix, a comment, a
markdownlint fix, or any change that cannot alter output. When it is ambiguous, default
to re-measuring — the conservative direction.

**How to re-measure — N=3.** Regenerate the paired outputs and judge with
`--judge-runs 3` (majority verdict per pair) over the **held-out** report corpus, per
[`benchmarks/README.md`](benchmarks/README.md) § "Fidelity bench" (Steps 1–2 of
`benchmarks/fidelity/run.py`). Pin `--model` for a reproducible headline; update a
cited savings/fidelity number only if it actually moves.

## 2. Bump version

Edit `package.json`, `.claude-plugin/marketplace.json`, and `.claude-plugin/plugin.json` to the new version (semver), then regenerate the lockfile so its two version fields follow:

```bash
npm install --package-lock-only
git commit -m "chore: 버전 vX.Y.Z" package.json package-lock.json .claude-plugin/marketplace.json .claude-plugin/plugin.json
```

## 3a. Tag-push release (recommended)

With the version commit on `main` (and `main` pushed), push its tag. **Pushing
the tag is the release** — `.github/workflows/release.yml` reacts to the tag push;
it no longer creates the tag itself:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow triggers on `push:` for tags matching `v*.*.*`. It checks out the
**tagged commit** (not `main` HEAD), verifies that all six version sources in
that commit — `package.json` `version`, `.claude-plugin/marketplace.json`
`metadata.version` and `plugins[0].version`, and `.claude-plugin/plugin.json`
`version` — equal the tag without its leading `v`, then creates the GitHub release
for that tag with `GITHUB_TOKEN` (`permissions: contents: write`; no Kir93 PAT
needed). The release body combines the committed
`.github/release-notes-template.md` callout header with the version's generated
changelog. The workflow does not run `npm publish` (§6).

A mistyped or mismatched tag does not produce a release. The trigger's `v*.*.*`
filter ignores non-version tags, and the six-source version gate runs **before**
the release step — if any source disagrees with the tag, or the tag is malformed,
the job fails and no release is created. Because the gate reads the tagged
commit's tree rather than `main`, pushing a tag on an older release commit after
`main` has advanced to the next bump still verifies against the right version.

The workflow triggers only for a tag pushed onto a commit that already contains
this `release.yml`. Push-tags is the only trigger — there is no
`workflow_dispatch` fallback — so tag the `main` HEAD that includes this workflow.
A tag on an older commit predating it will not trigger any release, and there is
no automated path to re-release such a commit.

## 3. What a pushed tag resolves

A pushed tag publishes the git-based install paths — both commands in §4 resolve
against it, and `npx -y github:Kir93/scrooge-mode#vX.Y.Z` pins to the tagged
commit.

> Hook payload note: changes under `hooks/`, `rules/`, `lib/`, or `registry.json`
> reach existing Codex installs only on reinstall — the installer copies them into
> `~/.codex/scrooge/`, so a published fix does not auto-update an already-installed
> Codex hook. This is the "existing Codex users: reinstall to upgrade" callout; its
> canonical wording lives in `.github/release-notes-template.md`, which the release
> workflow prepends to every release body.
>
> Statusline note: the installer copies `hooks/scrooge-statusline.sh` into
> `<config>/hooks/`, and plugin updates do NOT refresh that copy. When a release
> changes state-file locations the installed script reads, call out "statusline
> users: re-run the installer" (the script keeps a legacy-path fallback, so only
> an outdated copy paired with migrated state is affected).

## 4. Verify resolution

Claude Code plugin path:

```bash
claude plugin marketplace add Kir93/scrooge-mode   # reads .claude-plugin/marketplace.json
claude plugin install scrooge@scrooge              # plugin@marketplace
```

skills ecosystem path (Codex and other agents):

```bash
npx skills add Kir93/scrooge-mode --list           # lists skills/scrooge
npx skills add Kir93/scrooge-mode -a codex --yes --all
```

The one-line installer (`bin/install.js`, run via `npx -y github:Kir93/scrooge-mode`)
drives both of the above per detected agent — no npm publish needed.

A pushed tag is directly installable: `npx -y github:Kir93/scrooge-mode#vX.Y.Z`
pins to the tagged commit (npm git-ref), and `bin/install.js --tag vX.Y.Z` forwards
the ref to the marketplace / skills channels best-effort. So "tagging is the
release" (§ top) now yields a reproducible, pinnable install — see INSTALL.md
"Pin a released version" for the per-channel pinning matrix.

## 5. (Optional) skills.sh directory listing

`npx skills add <repo>` works without this; it only affects `npx skills find`
discoverability. Submission to <https://skills.sh> is external and manually
reviewed — expect approval delay. Treat as a separate, non-blocking step.

Status (2026-05-29): prepared, external merge non-blocking. Current skills.sh
FAQ says leaderboard listing appears automatically through anonymous telemetry
when users run `npx skills add <owner/repo>`; no separate PR submission path was
found in the public skills.sh docs. Track discovery with:

- Install source: `npx skills add Kir93/scrooge-mode`
- Directory URL: <https://skills.sh/Kir93/scrooge-mode>
- Badge URL: <https://skills.sh/b/Kir93/scrooge-mode>
- Submit/PR URL: N/A until skills.sh exposes a manual submission queue.

## 6. npm publish — deferred (not adopted)

Publishing `scrooge-mode` to npm is an **explicit deferral** (decision D1=B,
2026-07-08), not a pending option — neither automatic nor manual publish is
adopted. The `github:` shorthand (§4) is the only distribution vector.

Rationale:

- The one-line installer resolves from GitHub directly, so npm is not required to
  install (§4).
- An npm publish is an irreversible public release; the `github:` path already
  covers every install channel without it.
- npm provenance (`--provenance`) can only be generated by a CI publish (GitHub
  OIDC), which would reintroduce the auto-publish surface the launch deliberately
  avoided.

Reopen only on real demand for an npm vector. Even then automatic publish stays
off: a provenance publish would run behind a manual `workflow_dispatch` (a human
trigger), never hung on the tag-push release trigger.
