#!/usr/bin/env bash
# scrooge installer shim.
#   Local clone:  ./install.sh [flags]        → node cli/install.js
#   curl | bash:  curl -fsSL .../install.sh | bash → npx github delegation
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "scrooge: Node.js >=18 required — https://nodejs.org" >&2
  exit 1
fi

SOURCE="${BASH_SOURCE[0]:-$0}"
DIR="$(cd "$(dirname "$SOURCE")" 2>/dev/null && pwd || true)"

if [ -n "$DIR" ] && [ -f "$DIR/cli/install.js" ]; then
  exec node "$DIR/cli/install.js" "$@"
fi
exec npx -y github:Kir93/scrooge-mode -- "$@"
