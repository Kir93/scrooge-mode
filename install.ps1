#!/usr/bin/env pwsh
# scrooge installer shim (Windows).
#   Local clone:  ./install.ps1 [flags]   → node cli/install.js
#   else:         npx github delegation
# Best-effort Windows shim — NOT exercised by CI (ubuntu-latest only); validate
# manually on Windows. See INSTALL.md "Platform support". Logic: delegate to node.
#
# Under `irm … | iex` this text runs in the CALLER's session scope with no script
# file behind it: $PSCommandPath is empty, an `exit` would close the user's shell,
# and a top-level $ErrorActionPreference would leak into it. So the body runs in
# a script block (preference stays local), resolves a local clone only from a real
# script path, and exits only when it is one.
& {
  $ErrorActionPreference = 'Stop'

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    # Terminating under 'Stop': ends the block (and a script run, exit code 1).
    Write-Error 'scrooge: Node.js >=18 required — https://nodejs.org'
  }

  $local = if ($PSCommandPath) { Join-Path (Split-Path -Parent $PSCommandPath) 'cli/install.js' } else { $null }
  if ($local -and (Test-Path $local)) {
    & node $local @args
  } else {
    & npx -y github:Kir93/scrooge-mode -- @args
  }
  if ($PSCommandPath) { exit $LASTEXITCODE }
} @args
