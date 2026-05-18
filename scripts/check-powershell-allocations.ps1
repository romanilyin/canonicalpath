param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [int] $Iterations = 10000,
    [int64] $MaxPrivateBytesDelta = 268435456
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $RepoRoot 'packages/powershell/CanonicalPath/CanonicalPath.psd1'
Import-Module $modulePath -Force

function Invoke-CanonicalPathGC {
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    [System.GC]::Collect()
}

function Get-PrivateBytes {
    return [int64] ([System.Diagnostics.Process]::GetCurrentProcess()).PrivateMemorySize64
}

if ($Iterations -lt 1) { throw 'Iterations must be positive' }
if ($MaxPrivateBytesDelta -lt 1) { throw 'MaxPrivateBytesDelta must be positive' }

$sink = ''

for ($warmup = 0; $warmup -lt 200; $warmup++) {
    $root = ConvertTo-CanonicalPath '/repo/src/..'
    $target = ConvertTo-CanonicalPath '/repo/src/file.txt'
    $relative = Get-CanonicalRelativePath -Root $root -Target $target
    $sink = Join-CanonicalPath -Root $root -Relative $relative
}

Invoke-CanonicalPathGC
$before = Get-PrivateBytes

for ($index = 0; $index -lt $Iterations; $index++) {
    $root = ConvertTo-CanonicalPath '/repo/src/..'
    $target = ConvertTo-CanonicalPath '/repo/src/file.txt'
    $windows = ConvertTo-CanonicalPath 'C:\Repo\src\..\README.md'
    $relative = Get-CanonicalRelativePath -Root $root -Target $target
    $joined = Join-CanonicalPath -Root $root -Relative $relative
    $win32 = ConvertTo-CanonicalWin32Path -Path $windows
    $wsl = ConvertTo-CanonicalWSLPath -Path $windows
    $equal = Test-CanonicalPathEqual -Left '/repo/./src' -Right '/repo/src'
    $component = ConvertTo-CanonicalComponent -Name 'CON.txt' -Profile 'win32'
    $gitRef = ConvertTo-CanonicalGitRef -Ref 'feature/powershell-alloc'
    $client = New-CanonicalFSDaemonClient -Endpoint 'http://127.0.0.1:1' -Token 'token'
    $sink = $joined + '|' + $win32 + '|' + $wsl + '|' + $equal + '|' + $component + '|' + $gitRef + '|' + $client.Endpoint
}

Invoke-CanonicalPathGC
$after = Get-PrivateBytes
$delta = $after - $before
if ($delta -lt 0) { $delta = 0 }

if ($delta -gt $MaxPrivateBytesDelta) {
    throw ('PowerShell allocation check exceeded private bytes delta: ' + $delta + ' > ' + $MaxPrivateBytesDelta)
}
if ($sink.Length -eq 0) { throw 'PowerShell allocation check sink is empty' }

Write-Host ('CanonicalPath PowerShell allocation check passed: private bytes delta ' + $delta + ' over ' + $Iterations + ' iterations')
