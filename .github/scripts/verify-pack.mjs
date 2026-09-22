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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRepoUrl, extractLinks, repoBases, resolves } from './pack-links.mjs';

// One entry per shipped root. A prefix match, so `hooks/` passes when any file
// under it is packed — the point is "this root is not missing", not a full
// inventory that would churn on every added file.
//
// `LICENSE` is the exception to "root selected by files[]": npm force-includes it
// (measured — it ships despite being absent from files[]), so no manifest edit can
// drop it. It is listed for the other way it can vanish — the file itself deleted
// or renamed — which would publish a tarball whose only license statement is the
// `"license"` string in package.json, not the notice LICENSE requires to travel
// with every copy.
const REQUIRED = [
  'LICENSE',
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
const packed = new Set(paths);
if (paths.length === 0) {
  console.error('verify-pack: npm pack --dry-run --json produced no file list — schema changed?');
  process.exit(1);
}

const missing = REQUIRED.filter((req) =>
  req.endsWith('/') ? !paths.some((p) => p.startsWith(req)) : !paths.includes(req)
);

if (missing.length > 0) {
  // Not "files[] no longer ships" — LICENSE is npm-forced, so that message would
  // send you to edit a manifest field that cannot be the cause.
  console.error(`verify-pack: the published tarball no longer contains:\n  ${missing.join('\n  ')}`);
  console.error(`\npacked ${paths.length} files; first 10:\n  ${paths.slice(0, 10).join('\n  ')}`);
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bases = repoBases(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).repository?.url);
if (!bases) {
  console.error('verify-pack: package.json repository.url is not a github.com URL — cannot check absolute links');
  process.exit(1);
}

const docs = paths.filter((p) => p.endsWith('.md'));
const dead = [];
const badUrls = [];
let seen = 0;
let checked = 0;
let urls = 0;
for (const doc of docs) {
  const { relative, repoUrls, seen: docSeen } = extractLinks(readFileSync(path.join(ROOT, doc), 'utf8'));
  seen += docSeen;
  checked += relative.length;
  for (const { raw, target } of relative) {
    if (!resolves(packed, doc, target)) dead.push(`${doc} \u2192 ${raw}`);
  }
  for (const url of repoUrls) {
    const { target, fault } = checkRepoUrl(url, bases, ROOT);
    if (!target) continue;
    urls += 1;
    if (fault) badUrls.push(`${doc} \u2192 ${fault}`);
  }
}

if (dead.length > 0) {
  // Not "the link is broken in the repo" — these resolve on GitHub and fail only
  // inside the tarball, so the fix is an absolute URL, not a corrected path.
  console.error(
    `verify-pack: ${dead.length} relative link(s) do not resolve inside the tarball:\n  ${dead.join('\n  ')}`
  );
  console.error('\nUse an absolute https://github.com/... URL for targets outside package.json files[].');
  process.exit(1);
}

if (badUrls.length > 0) {
  // The absolutized links are the fix above; unchecked, a wrong base or a
  // /blob/-vs-/tree/ slip ships the same dead reference the rewrite was meant to
  // remove, and every gate stays green.
  console.error(
    `verify-pack: ${badUrls.length} absolute repo URL(s) point at nothing:\n  ${badUrls.join('\n  ')}`
  );
  process.exit(1);
}

// A scan scope that stops matching — a renamed extension, README dropped from the
// tarball, an extractor arm deleted — empties this check without failing it, which
// is the silent pass the guard exists to prevent. Asserted on the two **checked**
// faces rather than on `seen`: `seen` also counts anchors, `mailto:` and
// third-party URLs, so it stays high while both real checks scan nothing. Their
// sum rather than each alone, because zero relative links is a healthy end state —
// absolutizing a link is the fix this guard recommends. Counted for the same
// reason tests/test_meta_invariants.js counts each of its scan sides separately.
if (docs.length === 0 || checked + urls === 0) {
  console.error(
    `verify-pack: link scan covered ${docs.length} packed doc(s) and checked ` +
      `${checked} relative + ${urls} repo URL(s) — the scan scope drifted, so this check proved nothing`
  );
  process.exit(1);
}

console.info(
  `verify-pack: ok — ${paths.length} files, all ${REQUIRED.length} required roots present; ` +
    `${docs.length} packed docs, ${seen} links seen, ${checked} relative resolved, ${urls} repo URL(s) shape-checked`
);
