# Packs the project into quicksign.tar.gz (without node_modules, local data or secrets) for upload.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File deploy\package.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$out = Join-Path (Get-Location) 'quicksign.tar.gz'
if (Test-Path $out) { Remove-Item $out }

tar -czf $out --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.venv `
  --exclude=./.env --exclude=./quicksign.tar.gz --exclude='*.log' .

Write-Host "Created $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
