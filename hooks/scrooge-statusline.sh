#!/bin/bash
# scrooge — statusline badge for Claude Code.
# Reads the {lang,dial} state file and prints a colored badge, optionally with a
# pre-rendered token-savings suffix written by scrooge-stats.js.
#
# Usage in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash /path/to/scrooge-statusline.sh" }
#
# Security: the state/suffix paths are predictable. A local attacker could point
# them at a secret (e.g. ~/.ssh/id_rsa) or plant ANSI/OSC escape bytes. We refuse
# symlinks, hard-cap the read, validate values against a whitelist, and strip
# control bytes — never echo attacker-controlled bytes to the terminal.

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Derive the session key once, up front, from the stdin payload Claude Code
# provides. State is session-scoped (`.scrooge-active-<sid>`) so a different or
# fresh session never renders another's badge; sessionless hosts fall back to the
# global `.scrooge-active`. SID is sanitized to the SAME charset as the JS
# sanitizeSessionKey ([A-Za-z0-9_-], ≤64) so both sides resolve the same file.
SID=""
if [ ! -t 0 ]; then
  PAYLOAD=$(cat 2>/dev/null)
  SID=$(printf '%s' "$PAYLOAD" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]+"' | grep -oE '"[^"]+"$' | tr -d '"' | head -1)
  SID=$(printf '%s' "$SID" | tr -cd 'A-Za-z0-9_-' | cut -c1-64)
fi

if [ -n "$SID" ]; then
  STATE="$CONFIG_DIR/.scrooge-active-$SID"
else
  STATE="$CONFIG_DIR/.scrooge-active"
fi

[ -L "$STATE" ] && exit 0
[ ! -f "$STATE" ] && exit 0

RAW=$(head -c 256 "$STATE" 2>/dev/null | tr -d '\000-\037\177')

# Extract whitelisted values only. The alternation IS the whitelist — anything
# else yields an empty match and we render nothing.
LANG_V=$(printf '%s' "$RAW" | grep -oE '"lang"[[:space:]]*:[[:space:]]*"(ko|en|ja)"' | grep -oE '(ko|en|ja)"$' | tr -d '"' | head -1)
DIAL_V=$(printf '%s' "$RAW" | grep -oE '"dial"[[:space:]]*:[[:space:]]*"(lite|full)"' | grep -oE '(lite|full)"$' | tr -d '"' | head -1)

{ [ -z "$LANG_V" ] || [ -z "$DIAL_V" ]; } && exit 0

# Orange badge: [SCROOGE:ko/full]
printf '\033[38;5;172m[SCROOGE:%s/%s]\033[0m' "$LANG_V" "$DIAL_V"

# Savings suffix: on by default. Opt out via SCROOGE_STATUSLINE_SAVINGS=0.
# scrooge-stats.js writes the suffix as "<sessionId>:<text>". We render it only
# when its sessionId matches THIS statusline's session ($SID, derived above) — so
# a different or fresh session never shows a stale number. Reading a pre-rendered
# file avoids shelling out to node per keystroke. Same symlink/control-byte
# hardening as the state file.
if [ "${SCROOGE_STATUSLINE_SAVINGS:-1}" != "0" ]; then
  SUFFIX_FILE="$CONFIG_DIR/.scrooge-statusline-suffix"
  if [ -n "$SID" ] && [ -f "$SUFFIX_FILE" ] && [ ! -L "$SUFFIX_FILE" ]; then
    CONTENT=$(head -c 256 "$SUFFIX_FILE" 2>/dev/null | tr -d '\000-\037\177')
    FILE_SID="${CONTENT%%:*}"
    FILE_TEXT="${CONTENT#*:}"
    if [ "$FILE_SID" = "$SID" ] && [ -n "$FILE_TEXT" ] && [ "$FILE_TEXT" != "$CONTENT" ]; then
      printf ' \033[38;5;172m%s\033[0m' "$FILE_TEXT"
    fi
  fi
fi
