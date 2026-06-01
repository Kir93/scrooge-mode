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

// Most-recently-modified *.jsonl under a host session directory. Used only as
// fallback when the hook did not pass an explicit transcript path.
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
export function parseClaudeSession(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ...EMPTY_SUMMARY };
  }

  let outputTokens = 0;
  let cacheReadTokens = 0;
  let turns = 0;
  let model = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    outputTokens += usage.output_tokens || 0;
    cacheReadTokens += usage.cache_read_input_tokens || 0;
    turns++;
    if (!model && entry.message.model) model = entry.message.model;
  }
  return { outputTokens, cacheReadTokens, turns, model };
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
  if (totalTurns > 0) {
    return {
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheReadTokens,
      turns: totalTurns,
      model,
    };
  }
  return {
    outputTokens: fallbackOutputTokens,
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
