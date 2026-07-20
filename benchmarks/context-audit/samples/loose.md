<!-- Synthetic Phase 0 corpus fixture (low density). Intentionally holds clear
duplicate blocks, dead-letter markers, and filler prose so the deterministic
detectors have labeled ground truth. NOT a real project doc — do not act on it. -->

# Contributor notes (synthetic loose sample)

## Setup

Basically, to get started you just need to install the dependencies and then you
can simply run the build, which is honestly pretty much all there is to it here.

Always run the linter before every commit so the shared style stays consistent.
This keeps diffs small and avoids noisy review comments about pure formatting.

## Deployment

Always run the linter before every commit so the shared style stays consistent.
This keeps diffs small and avoids noisy review comments about pure formatting.

## Legacy

For the older flow, see `docs/legacy/OLD-GUIDE.md` for the full walkthrough.

The migration to the new pipeline is pending until the infra work lands.

## Tooling

Run `scripts/deploy.sh --force` to push a release, then verify the health check.

Run `scripts/deploy.sh --force` to push a release, then verify the health check.
