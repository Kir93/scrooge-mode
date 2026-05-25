#!/usr/bin/env pwsh
# scrooge uninstaller shim (Windows) — delegates to bin/install.js --uninstall.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'scrooge: Node.js >=18 required — https://nodejs.org'
  exit 1
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$local = Join-Path $dir 'bin/install.js'
if (Test-Path $local) {
  & node $local --uninstall @args
} else {
  & npx -y github:Kir93/scrooge-mode -- --uninstall @args
}
exit $LASTEXITCODE
