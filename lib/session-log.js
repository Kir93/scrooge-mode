// session-log.js — host-agent session-log adapter.
//
// Isolates the (undocumented, version-drifting) session-transcript schemas of
// each host agent behind one interface. Callers ask for a parsed token summary;
// they never touch JSONL layout directly. When a host changes its schema, the
// blast radius is this file alone.
//
// Verified locally (2026-05): Claude Code writes per-message JSONL at
//   ~/.claude/projects/<slug>/<uuid>.jsonl
// where each assistant line is { type: "assistant", message: { model, usage: {
//   input_tokens, output_tokens, cache_read_input_tokens,
//   cache_creation_input_tokens } } }.
//
// Codex desktop/CLI sessions live under ~/.codex/sessions/{YYYY}/.../*.jsonl.
// Verified locally (2026-06): token accounting appears as event messages:
//   { type: "event_msg", payload: { type: "token_count", info: {
//     last_token_usage: { output_tokens, reasoning_output_tokens,
//       cached_input_tokens }, total_token_usage: ... } } }
// Prefer cumulative total_token_usage so duplicate token_count re-emits do not
// inflate stats. For Scrooge's visible-output purpose, reasoning_output_tokens
// is subtracted from output_tokens when present.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const EMPTY_SUMMARY = Object.freeze({
  outputTokens: 0,
  proseOutputTokens: 0,
  toolUseOutputTokens: 0,
  cacheReadTokens: 0,
  turns: 0,
  model: null,
});

function claudeProjectsDir(claudeDir) {
  const base = claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function codexSessionsDir(codexDir) {
  const base = codexDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(base, 'sessions');
}

// Claude writes per-session helper transcripts under these subdirectories of a
// project (e.g. `<project>/<uuid>/subagents/agent-*.jsonl`). They are not main
// session transcripts, so the recency scan must never select one — otherwise a
// freshly-finished subagent shadows the real session.
const SKIP_DIRS = new Set(['subagents', 'tool-results']);

// Most-recently-modified *.jsonl under a host session directory, excluding the
// helper subdirs above. Used only as fallback when the hook did not pass an
// explicit transcript path. Still recurses so Codex's date-nested layout
// (sessions/YYYY/MM/DD/*.jsonl) keeps resolving.
function findRecentJsonl(rootDir) {
  let best = null;
  const stack = [rootDir];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try {
      st = fs.statSync(p);
    } catch (e) {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(p))) continue;
      let children;
      try {
        children = fs.readdirSync(p);
      } catch (e) {
        continue;
      }
      for (const c of children) stack.push(path.join(p, c));
    } else if (p.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtime)) {
      best = { file: p, mtime: st.mtimeMs };
    }
  }
  return best ? best.file : null;
}

export function findRecentClaudeSession(claudeDir) {
  return findRecentJsonl(claudeProjectsDir(claudeDir));
}

export function findRecentCodexSession(codexDir) {
  return findRecentJsonl(codexSessionsDir(codexDir));
}

// Parse a Claude Code transcript JSONL into a token summary. Never throws;
// unreadable / malformed input degrades to EMPTY_SUMMARY (or a partial sum).
//
// Claude writes one JSONL line per content block of a response, repeating the
// same message.id and usage object on each. Summing every line double-counts
// usage (verified on this repo: 385 lines / 143 distinct ids = 2.89x). So dedup
// by message.id and count its usage once; `turns` is the distinct-response count.
// Output is split into prose vs tool_use buckets: a response is tool_use when ANY
// of its content blocks is tool_use, decided only after scanning every line for
// that id — never first-seen (a text block streamed before a same-id tool_use
// block must not bucket the response as prose).
//
// The dedup guarantee is keyed on message.id, which the documented Claude schema
// always carries; id falls back to requestId, then the line index. The line-index
// fallback keeps id-less / malformed lines distinct — it never under-counts
// independent responses — but it cannot dedup a (schema-wise non-occurring)
// id-less *multi-block* response. That limit is accepted on purpose: a
// usage-signature fallback would instead wrongly merge two distinct id-less
// responses that happen to share an identical usage, which under-counts real
// usage. Conservative over-distinctness is the safer failure for an off-schema
// transcript.
export function parseClaudeSession(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ...EMPTY_SUMMARY };
  }

  const byId = new Map();
  let model = null;
  let lineIndex = -1;
  for (const line of raw.split('\n')) {
    lineIndex++;
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const msg = entry.message;
    const id = msg.id || entry.requestId || `__line_${lineIndex}`;
    let rec = byId.get(id);
    if (!rec) {
      rec = { output: 0, cacheRead: 0, hasUsage: false, hasToolUse: false };
      byId.set(id, rec);
    }
    if (msg.usage) {
      // Repeated lines carry an identical usage; last-wins is idempotent for
      // repeats and prefers the final value if a streaming partial ever differs.
      rec.output = msg.usage.output_tokens || 0;
      rec.cacheRead = msg.usage.cache_read_input_tokens || 0;
      rec.hasUsage = true;
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && block.type === 'tool_use') {
          rec.hasToolUse = true;
          break;
        }
      }
    }
    if (!model && msg.model) model = msg.model;
  }

  let outputTokens = 0;
  let proseOutputTokens = 0;
  let toolUseOutputTokens = 0;
  let cacheReadTokens = 0;
  let turns = 0;
  for (const rec of byId.values()) {
    if (!rec.hasUsage) continue;
    outputTokens += rec.output;
    cacheReadTokens += rec.cacheRead;
    if (rec.hasToolUse) toolUseOutputTokens += rec.output;
    else proseOutputTokens += rec.output;
    turns++;
  }
  return {
    outputTokens,
    proseOutputTokens,
    toolUseOutputTokens,
    cacheReadTokens,
    turns,
    model,
  };
}

function tokenNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function visibleOutputTokens(usage) {
  return Math.max(
    0,
    tokenNumber(usage.output_tokens) - tokenNumber(usage.reasoning_output_tokens)
  );
}

function codexUsageSignature(usage) {
  return [
    tokenNumber(usage.input_tokens),
    tokenNumber(usage.cached_input_tokens),
    tokenNumber(usage.output_tokens),
    tokenNumber(usage.reasoning_output_tokens),
    tokenNumber(usage.total_tokens),
  ].join(':');
}

// Parse a Codex transcript JSONL into a token summary. Never throws; unreadable
// or malformed input degrades to EMPTY_SUMMARY or a partial sum.
export function parseCodexSession(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ...EMPTY_SUMMARY };
  }

  let fallbackOutputTokens = 0;
  let fallbackCacheReadTokens = 0;
  let fallbackTurns = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalTurns = 0;
  let model = null;
  const seenTotals = new Set();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (entry.type === 'session_meta' && !model) {
      model = entry.payload && entry.payload.model ? entry.payload.model : null;
      continue;
    }
    if (entry.type !== 'event_msg' || !entry.payload || entry.payload.type !== 'token_count') continue;
    const info = entry.payload.info || {};
    const totalUsage = info.total_token_usage;
    if (totalUsage) {
      const sig = codexUsageSignature(totalUsage);
      if (seenTotals.has(sig)) continue;
      seenTotals.add(sig);
      totalOutputTokens = visibleOutputTokens(totalUsage);
      totalCacheReadTokens = tokenNumber(totalUsage.cached_input_tokens);
      totalTurns++;
      continue;
    }

    const usage = info.last_token_usage;
    if (!usage) continue;
    fallbackOutputTokens += visibleOutputTokens(usage);
    fallbackCacheReadTokens += tokenNumber(usage.cached_input_tokens);
    fallbackTurns++;
  }
  // Codex transcripts carry no per-block tool_use marker, so all visible output
  // is treated as prose for the estimate basis (parity with the prior behaviour
  // of applying the ratio to the whole figure).
  if (totalTurns > 0) {
    return {
      outputTokens: totalOutputTokens,
      proseOutputTokens: totalOutputTokens,
      toolUseOutputTokens: 0,
      cacheReadTokens: totalCacheReadTokens,
      turns: totalTurns,
      model,
    };
  }
  return {
    outputTokens: fallbackOutputTokens,
    proseOutputTokens: fallbackOutputTokens,
    toolUseOutputTokens: 0,
    cacheReadTokens: fallbackCacheReadTokens,
    turns: fallbackTurns,
    model,
  };
}

// Single entry point. agent defaults to 'claude'. sessionFile, when given
// (e.g. the hook's transcript_path), wins over auto-discovery.
export function readSession({ agent = 'claude', claudeDir, codexDir, sessionFile } = {}) {
  if (agent === 'codex') {
    const file = sessionFile || findRecentCodexSession(codexDir);
    if (!file) return { agent, file: null, ...EMPTY_SUMMARY };
    return { agent, file, ...parseCodexSession(file) };
  }
  const file = sessionFile || findRecentClaudeSession(claudeDir);
  if (!file) return { agent: 'claude', file: null, ...EMPTY_SUMMARY };
  return { agent: 'claude', file, ...parseClaudeSession(file) };
}
