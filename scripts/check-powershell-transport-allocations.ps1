param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [Parameter(Mandatory = $true)][string] $Endpoint,
    [Parameter(Mandatory = $true)][string] $Token,
    [Parameter(Mandatory = $true)][string] $HostRoot,
    [int] $Iterations = 250,
    [int64] $MaxPrivateBytesDelta = 402653184
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

$client = New-CanonicalFSDaemonClient -Endpoint $Endpoint -Token $Token
$projectId = 'transport-alloc-' + [guid]::NewGuid().ToString('n')
$sink = ''

Open-CanonicalFSProject -Client $client -ProjectId $projectId -HostRoot $HostRoot | Out-Null
try {
    New-CanonicalFSDirectory -Client $client -ProjectId $projectId -Path 'safe' | Out-Null
    Write-CanonicalFSText -Client $client -ProjectId $projectId -Path 'safe/file.txt' -Text 'hello from powershell transport allocation' | Out-Null

    for ($warmup = 0; $warmup -lt 20; $warmup++) {
        $health = Get-CanonicalFSDaemonHealth -Client $client
        $caps = Get-CanonicalFSDaemonCapabilities -Client $client
        $stat = Get-CanonicalFSItem -Client $client -ProjectId $projectId -Path 'safe/file.txt'
        $text = Read-CanonicalFSText -Client $client -ProjectId $projectId -Path 'safe/file.txt' -MaxBytes 128
        $sink = [string] $health.ok + '|' + [string] $caps.auth_required + '|' + [string] $stat.size + '|' + $text
    }

    Invoke-CanonicalPathGC
    $before = Get-PrivateBytes

    for ($index = 0; $index -lt $Iterations; $index++) {
        $health = Get-CanonicalFSDaemonHealth -Client $client
        $caps = Get-CanonicalFSDaemonCapabilities -Client $client
        $stat = Get-CanonicalFSItem -Client $client -ProjectId $projectId -Path 'safe/file.txt'
        $text = Read-CanonicalFSText -Client $client -ProjectId $projectId -Path 'safe/file.txt' -MaxBytes 128
        $sink = [string] $health.ok + '|' + [string] $caps.auth_required + '|' + [string] $stat.size + '|' + $text
    }

    Invoke-CanonicalPathGC
    $after = Get-PrivateBytes
    $delta = $after - $before
    if ($delta -lt 0) { $delta = 0 }

    if ($delta -gt $MaxPrivateBytesDelta) {
        throw ('PowerShell transport allocation check exceeded private bytes delta: ' + $delta + ' > ' + $MaxPrivateBytesDelta)
    }
    if ($sink.Length -eq 0) { throw 'PowerShell transport allocation check sink is empty' }

    Write-Host ('CanonicalFS PowerShell transport allocation check passed: private bytes delta ' + $delta + ' over ' + $Iterations + ' iterations')
} finally {
    try { Close-CanonicalFSProject -Client $client -ProjectId $projectId | Out-Null } catch {}
}
