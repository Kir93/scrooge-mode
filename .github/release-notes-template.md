<!-- Fixed release-body header. The workflow (.github/workflows/release.yml)
     prepends this to each version's generated changelog; RELEASE.md points here
     as the single source for the callout, so the wording never drifts. -->

> **Existing Codex users: reinstall to upgrade.** Changes under `hooks/`,
> `rules/`, `lib/`, or `registry.json` reach an existing Codex install only on
> reinstall — the installer copies them into `~/.codex/scrooge/`, so a published
> fix does not auto-update an already-installed Codex hook. Re-run the one-line
> installer (`npx -y github:Kir93/scrooge-mode`) to pick up this release.
