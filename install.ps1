#!/usr/bin/env pwsh
# scrooge installer shim (Windows).
#   Local clone:  ./install.ps1 [flags]   → node bin/install.js
#   else:         npx github delegation
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'scrooge: Node.js >=18 required — https://nodejs.org'
  exit 1
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$local = Join-Path $dir 'bin/install.js'
if (Test-Path $local) {
  & node $local @args
} else {
  & npx -y github:Kir93/scrooge-mode -- @args
}
exit $LASTEXITCODE
