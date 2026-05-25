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
// Codex sessions live under ~/.codex/sessions/{YYYY}/ but their schema is not
// yet reversed here — parseCodexSession is a best-effort stub that degrades to
// an empty summary rather than guessing.

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

// Most-recently-modified *.jsonl under ~/.claude/projects/. Used only as a
// fallback when the hook did not pass an explicit transcript path.
export function findRecentClaudeSession(claudeDir) {
  const projectsDir = claudeProjectsDir(claudeDir);
  let best = null;
  const stack = [projectsDir];
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

// Best-effort Codex stub. Codex session schema is not reversed yet, so this
// degrades to an empty summary instead of guessing. Fill in when the schema is
// confirmed (Task 5 benchmark work touches Codex logs).
export function parseCodexSession(_filePath) {
  return { ...EMPTY_SUMMARY };
}

// Single entry point. agent defaults to 'claude'. sessionFile, when given
// (e.g. the hook's transcript_path), wins over auto-discovery.
export function readSession({ agent = 'claude', claudeDir, sessionFile } = {}) {
  if (agent === 'codex') {
    return { agent, file: sessionFile || null, ...parseCodexSession(sessionFile) };
  }
  const file = sessionFile || findRecentClaudeSession(claudeDir);
  if (!file) return { agent: 'claude', file: null, ...EMPTY_SUMMARY };
  return { agent: 'claude', file, ...parseClaudeSession(file) };
}
