#!/usr/bin/env node
// scrooge-memory.js — CLI for the memory-compress surface (#4).
//
// The model produces the compressed prose (KO-aware, per the scrooge-memory
// skill); this CLI is the deterministic guard around an irreversible overwrite:
//
//   verify <original> <candidate>            dry run — print {ok,missing,baseline,saved}
//   record <original> <candidate> --session  verify, then record the input-savings
//                                            delta on the one honest bill (#1)
//
// `verify` has no side effects and exits 1 when a protected span was dropped, so a
// caller can gate the overwrite on a clean exit. `record` refuses (exits 1) unless
// verification is clean — the ledger never books savings for a corrupting compress.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPreservation, compressionDelta } from '../lib/memory-compress.js';
import { recordInputDelta } from '../lib/ledger.js';

const SOURCE = 'memory-compress';
// Cap memory-file reads the same way the rest of lib/ caps its I/O, and reject
// binary input (a NUL byte) so a mis-passed binary file is not utf8-mangled into
// a phantom baseline/saved figure.
const MAX_FILE_BYTES = 1024 * 1024;

function readArg(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

// Positional args, excluding option flags and their values, so a flag is never
// silently absorbed as <original>/<candidate> (e.g. `record orig --session k`
// must not read "--session" as the candidate path).
function positionals(argv) {
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session') {
      i++; // skip the flag's value too
      continue;
    }
    if (argv[i].startsWith('--')) continue;
    pos.push(argv[i]);
  }
  return pos;
}

function readFile(p) {
  try {
    const buf = fs.readFileSync(p);
    if (buf.length > MAX_FILE_BYTES) {
      process.stderr.write(`refusing ${p}: larger than ${MAX_FILE_BYTES} bytes\n`);
      return null;
    }
    if (buf.includes(0)) {
      process.stderr.write(`refusing ${p}: looks binary (NUL byte)\n`);
      return null;
    }
    return buf.toString('utf8');
  } catch (err) {
    process.stderr.write(`cannot read ${p}: ${err.message}\n`);
    return null;
  }
}

function main(argv) {
  const [cmd, origPath, candPath] = positionals(argv);
  if ((cmd !== 'verify' && cmd !== 'record') || !origPath || !candPath) {
    process.stderr.write(
      'usage: scrooge-memory.js <verify|record> <original> <candidate> [--session <key>]\n'
    );
    return 2;
  }

  const original = readFile(origPath);
  const candidate = readFile(candPath);
  if (original === null || candidate === null) return 2;

  const { ok, missing } = verifyPreservation(original, candidate);
  const { baseline, saved } = compressionDelta(original, candidate);

  if (cmd === 'verify') {
    process.stdout.write(JSON.stringify({ ok, missing, baseline, saved }) + '\n');
    return ok ? 0 : 1;
  }

  // record: never book savings for a corrupting compress.
  if (!ok) {
    process.stdout.write(JSON.stringify({ ok: false, missing, recorded: false }) + '\n');
    return 1;
  }
  const sessionKey = readArg(argv, '--session');
  if (!sessionKey) {
    process.stderr.write('record requires --session <key>\n');
    return 2;
  }
  const recorded = recordInputDelta({ sessionKey, source: SOURCE, baseline, saved });
  process.stdout.write(JSON.stringify({ ok: true, baseline, saved, recorded }) + '\n');
  return recorded ? 0 : 1;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));

export { main };
