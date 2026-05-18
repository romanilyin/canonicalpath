$ErrorActionPreference = "Stop"

$root = Join-Path $env:TEMP "cp-fixture"
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $root "project\safe") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root "outside") | Out-Null
Set-Content -Path (Join-Path $root "outside\secret.txt") -Value "secret"

try {
  New-Item -ItemType SymbolicLink -Path (Join-Path $root "project\link_out") -Target (Join-Path $root "outside") | Out-Null
} catch {
  Write-Warning "Symlink creation failed; Windows may require Developer Mode or admin rights."
}

Write-Output $root
