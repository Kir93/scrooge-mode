#!/usr/bin/env bash
# scrooge uninstaller shim — delegates to bin/install.js --uninstall.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "scrooge: Node.js >=18 required — https://nodejs.org" >&2
  exit 1
fi

SOURCE="${BASH_SOURCE[0]:-$0}"
DIR="$(cd "$(dirname "$SOURCE")" 2>/dev/null && pwd || true)"

if [ -n "$DIR" ] && [ -f "$DIR/bin/install.js" ]; then
  exec node "$DIR/bin/install.js" --uninstall "$@"
fi
exec npx -y github:Kir93/scrooge-mode -- --uninstall "$@"
