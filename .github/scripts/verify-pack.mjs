// verify-pack.mjs — assert the published tarball actually contains the runtime.
//
// `package.json` `files[]` decides what ships. Dropping an entry there produces a
// package that installs fine and then fails at runtime, and nothing else catches
// it: a `--dry-run` install returns 0 without ever reading `lib/` (measured), so
// only the file list itself is a real signal.
//
// Run in CI (every push/PR) and again at tag time, before the release object is
// created — see .github/workflows/{ci,release}.yml.

import { execFileSync } from 'node:child_process';

// One entry per shipped root. A prefix match, so `hooks/` passes when any file
// under it is packed — the point is "this root is not missing", not a full
// inventory that would churn on every added file.
const REQUIRED = [
  'registry.json',
  'hooks/',
  'rules/',
  'lib/',
  'bin/install.js',
  'skills/',
  '.claude-plugin/',
];

// npm has changed this output shape before (bare object vs single-element array,
// and `files[]` entries were once plain strings), so normalize defensively rather
// than trusting one version's schema.
function packedPaths() {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(raw);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = entry?.files ?? [];
  return files
    .map((f) => (typeof f === 'string' ? f : f?.path))
    .filter((p) => typeof p === 'string' && p.length > 0);
}

const paths = packedPaths();
if (paths.length === 0) {
  console.error('verify-pack: npm pack --dry-run --json produced no file list — schema changed?');
  process.exit(1);
}

const missing = REQUIRED.filter((req) =>
  req.endsWith('/') ? !paths.some((p) => p.startsWith(req)) : !paths.includes(req)
);

if (missing.length > 0) {
  console.error(`verify-pack: package.json "files" no longer ships:\n  ${missing.join('\n  ')}`);
  console.error(`\npacked ${paths.length} files; first 10:\n  ${paths.slice(0, 10).join('\n  ')}`);
  process.exit(1);
}

console.info(`verify-pack: ok — ${paths.length} files, all ${REQUIRED.length} required roots present`);
