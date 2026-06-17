# Release procedure

Maintainer runbook for publishing Scrooge. Both install paths resolve **directly
from the public GitHub repo** — no central submission is required to make them
work. Tagging + pushing is the release.

Repo: `Kir93/scrooge-mode`. Plugin/marketplace name: `scrooge`. npm name: `scrooge-mode`.

## Version sources (must match)

A release sets one version in three places. They must be identical:

| File | Field |
| ---- | ----- |
| `package.json` | `version` |
| `.claude-plugin/marketplace.json` | `metadata.version` |
| `.claude-plugin/marketplace.json` | `plugins[0].version` |

`.claude-plugin/plugin.json` currently has no `version` field. If one is
added later, update this table at the same time.

## 1. Pre-flight

Run from a clean tree on `main`:

- `npm test` — passes (Node `node:test` harness).
- `npx markdownlint-cli2 "**/*.md"` — clean.
- `node -e "JSON.parse(require('fs').readFileSync('registry.json'))"` and the same
  for `package.json`, `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json` — all parse.
- Every `registry.json` path resolves to an existing `rules/**` file, and every
  `rules/**` file is reachable from the registry.
- Bilingual + dial parity holds (`ko`/`en`, `lite`/`full`, `README.md`/`README.ko.md`).
- The three version sources above match.

## 2. Bump version

Edit the three version sources to the new version (semver). Commit:

```bash
git commit -m "chore: 버전 vX.Y.Z" package.json .claude-plugin/marketplace.json
```

## 3a. Workflow tag and push (recommended)

After the version commit is on `main`, run the manual GitHub Actions workflow:

```bash
gh workflow run release.yml -f version=vX.Y.Z --ref main
```

The workflow is `workflow_dispatch` only. It checks that `package.json.version`,
`.claude-plugin/marketplace.json` `metadata.version`, and
`.claude-plugin/marketplace.json` `plugins[0].version` all match the input
version without the leading `v`, then creates tag `vX.Y.Z` and runs:

```bash
git push origin vX.Y.Z
```

The workflow declares `permissions: contents: write` so `GITHUB_TOKEN` can push
the tag. It does not run `npm publish`; §6 stays optional and manual.

## 3. Tag and push

```bash
git tag vX.Y.Z
git push origin main --tags
```

This publishes the git-based install paths. Both commands below now resolve.

> Hook payload note: changes under `hooks/`, `rules/`, `lib/`, or `registry.json`
> reach existing Codex installs only on reinstall — the installer copies them into
> `~/.codex/scrooge/`, so a published fix does not auto-update an already-installed
> Codex hook. When a release touches those paths, call out "existing Codex users:
> reinstall to upgrade" in the release notes.

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

## 6. (Optional) npm publish

The installer uses the `github:` shorthand, so npm is not required. Publish
`scrooge-mode` only if an npm vector is wanted:

```bash
npm pack --dry-run   # confirm file set (hooks/lib/skills/commands/.claude-plugin included)
npm publish
```
