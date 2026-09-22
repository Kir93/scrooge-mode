// pack-links.mjs — link extraction and resolution for verify-pack.mjs.
//
// Split out from the CLI so the syntax coverage is unit-testable: the defect this
// catches is a notation the extractor does not recognize, and a guard that runs
// `npm pack` at import time cannot be tested for that.

import fs from 'node:fs';
import path from 'node:path';

// Three notations, all of which put a working link in a rendered README:
// inline `](target)`, an HTML `src=`/`href=` attribute under either quote style,
// and a reference-style definition `[id]: target`. Missing any one of them is a
// silent hole — the link renders, resolves on GitHub, and dies in the tarball.
//
// The attribute arm requires a non-word boundary in front and pairs its quotes by
// back-reference, so `data-src=`/`xlink:href=` and a mismatched `src="x'` stay out:
// this is a blocking gate, and a non-link attribute reaching it fails an innocent
// PR. `:` is in the boundary class for `xlink:href`, which is an SVG reference,
// not a document link.
export const LINK =
  /\]\(([^)\s]+)|(?<![\w:-])(?:src|href)=(["'])([^"']+)\2|^[ \t]{0,3}\[[^\]\n]+\]:[ \t]+(\S+)/gm;

// `seen` counts every match, absolute URLs included; `relative` and `repoUrls` are
// the two subsets the guard checks. The caller asserts on the two subsets rather
// than on `seen`, because `seen` also counts anchors, `mailto:` and third-party
// URLs — a scan whose two checked faces both emptied would still show a high
// `seen` and pass.
export function extractLinks(body) {
  const relative = [];
  const repoUrls = [];
  let seen = 0;
  for (const m of body.matchAll(LINK)) {
    const raw = m[1] ?? m[3] ?? m[4];
    seen += 1;
    if (/^https?:/.test(raw)) {
      repoUrls.push(raw);
      continue;
    }
    if (/^(?:mailto:|#)/.test(raw)) continue;
    const target = raw.split('#')[0];
    if (target) relative.push({ raw, target });
  }
  return { relative, repoUrls, seen };
}

// Derived from the manifest rather than hardcoded: a wrong repository base is one
// of the ways a rewritten absolute URL goes dead, and a constant here would be a
// second place for it to be wrong.
export function repoBases(repositoryUrl) {
  const m = String(repositoryUrl ?? '').match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  return {
    owner,
    repo,
    blob: `https://github.com/${owner}/${repo}`,
    raw: `https://raw.githubusercontent.com/${owner}/${repo}`,
  };
}

const GH_CONTENT = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/[^/]+\/([^#?]+)/;
const GH_RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/([^#?]+)/;

// Returns the repo-content coordinates a URL claims, whatever repository it names.
// Owner and repo are kept rather than matched here so the caller can tell "points
// at another repository" from "is not a repo-content URL at all" — a badge, an
// issue link or another host. Collapsing those two makes an owner rename read as
// "nothing to check".
export function repoUrlTarget(url) {
  const content = url.match(GH_CONTENT);
  if (content) {
    return { owner: content[1], repo: content[2], kind: content[3], raw: content[4] };
  }
  const raw = url.match(GH_RAW);
  if (raw) return { owner: raw[1], repo: raw[2], kind: 'raw', raw: raw[3] };
  return null;
}

// A directory target (`skills/`) is never itself a packed entry, so it resolves on
// the prefix instead — the same "this root is present" test REQUIRED uses.
export function resolves(packed, doc, target) {
  // A root-relative target renders against the repo root on GitHub and is a
  // filesystem absolute path inside the tarball, so it is dead there however the
  // join below would fold it.
  if (target.startsWith('/')) return false;
  // `normalize` keeps a trailing slash, which would make every directory target
  // miss both arms below (`skills/` is in no packed path as `skills//`).
  const norm = path.posix.normalize(path.posix.join(path.posix.dirname(doc), target)).replace(/\/+$/, '');
  // `](./)` normalizes to the package root, which always exists in the tarball.
  return norm === '.' || packed.has(norm) || [...packed].some((p) => p.startsWith(`${norm}/`));
}

// The tarball check above cannot see these — they leave the package by design — so
// the failure they have instead is a wrong repository, a wrong path, or `/blob/`
// where the target is a directory. All three are decidable against the checked-out
// tree, with no network call in CI.
//
// Returns `{ target, fault }`: `target` is null when the URL is not repo content at
// all (nothing to check), and `fault` is null when it checks out. The caller counts
// non-null targets, so this is one parse rather than two.
export function checkRepoUrl(url, bases, root) {
  const target = repoUrlTarget(url);
  if (!target) return { target: null, fault: null };
  if (target.owner !== bases.owner || target.repo !== bases.repo) {
    return {
      target,
      fault: `${url} — points at ${target.owner}/${target.repo}, but package.json declares ${bases.owner}/${bases.repo}`,
    };
  }
  let rel;
  try {
    rel = decodeURIComponent(target.raw).replace(/\/+$/, '');
  } catch {
    // Report it as this guard's own named failure instead of dying on a URIError
    // and losing which document the bad URL is in.
    return { target, fault: `${url} — malformed percent-encoding in the path` };
  }
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return { target, fault: `${url} — no such path in the repo: ${rel}` };
  const isDir = fs.statSync(abs).isDirectory();
  if (target.kind === 'tree' && !isDir) {
    return { target, fault: `${url} — /tree/ but ${rel} is a file (use /blob/)` };
  }
  if (target.kind !== 'tree' && isDir) {
    return { target, fault: `${url} — /${target.kind}/ but ${rel} is a directory (use /tree/)` };
  }
  return { target, fault: null };
}
