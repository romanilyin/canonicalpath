param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [string] $GoCommand = 'go',
    [string] $Endpoint = '',
    [string] $Token = '',
    [string] $HostRoot = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$useExternalDaemon = $Endpoint -ne '' -and $Token -ne '' -and $HostRoot -ne ''
if (-not $useExternalDaemon) {
    $goProbe = Get-Command $GoCommand -ErrorAction SilentlyContinue
    if ($null -eq $goProbe) {
        Write-Host ('Go command not found; skipping CanonicalFS daemon PowerShell smoke tests: ' + $GoCommand)
        exit 0
    }
}

$modulePath = Join-Path $RepoRoot 'packages/powershell/CanonicalPath/CanonicalPath.psd1'
Import-Module $modulePath -Force
$module = Get-Module CanonicalPath
$errorCodeCommand = $module.Invoke({ Get-Command Get-CanonicalErrorCode })

function New-FreeTcpPort {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
    $listener.Start()
    try { return [int] $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

function Assert-Equal {
    param([string] $Name, $Expected, $Actual)
    if (-not [string]::Equals([string] $Expected, [string] $Actual, [System.StringComparison]::Ordinal)) {
        throw ($Name + ': expected ' + $Expected + ', got ' + $Actual)
    }
}

function Assert-True {
    param([string] $Name, [bool] $Value)
    if (-not $Value) { throw ($Name + ': expected true') }
}

$tempParent = $null
$projectRoot = $HostRoot
$endpointValue = $Endpoint
$tokenValue = $Token
$daemon = $null

try {
    if (-not $useExternalDaemon) {
        $tempParent = Join-Path ([System.IO.Path]::GetTempPath()) ('canonicalfs-ps-smoke-' + [guid]::NewGuid().ToString('n'))
        $projectRoot = Join-Path $tempParent 'project'
        New-Item -ItemType Directory -Path $projectRoot -Force | Out-Null
        $port = New-FreeTcpPort
        $tokenValue = 'ps-smoke-token-' + [guid]::NewGuid().ToString('n')
        $endpointValue = 'http://127.0.0.1:' + $port

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $GoCommand
        $psi.Arguments = 'run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:' + $port + ' -allow-root "' + $projectRoot + '"'
        $psi.WorkingDirectory = $RepoRoot
        $psi.UseShellExecute = $false
        $psi.RedirectStandardError = $true
        $psi.RedirectStandardOutput = $true
        $psi.EnvironmentVariables['CANONICALFS_DAEMON_TOKEN'] = $tokenValue
        $daemon = [System.Diagnostics.Process]::Start($psi)
    }

    $client = New-CanonicalFSDaemonClient -Endpoint $endpointValue -Token $tokenValue
    $healthy = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if ($null -ne $daemon -and $daemon.HasExited) {
            $stderr = $daemon.StandardError.ReadToEnd()
            throw ('canonicalfs daemon exited early with code ' + $daemon.ExitCode + ': ' + $stderr)
        }
        try {
            $health = Get-CanonicalFSDaemonHealth -Client $client
            if ($health.ok) { $healthy = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 250
    }
    if (-not $healthy) { throw 'canonicalfs daemon did not become healthy' }

    $caps = Get-CanonicalFSDaemonCapabilities -Client $client
    Assert-True 'caps auth required' ([bool] $caps.auth_required)
    Assert-True 'caps include readFile' (@($caps.endpoints) -contains 'POST /v1/fs/readFile')
    Assert-Equal 'caps max read' 16777216 ([int64] $caps.limits.max_read_bytes)

    Open-CanonicalFSProject -Client $client -ProjectId 'project-1' -HostRoot $projectRoot | Out-Null
    New-CanonicalFSDirectory -Client $client -ProjectId 'project-1' -Path 'safe' | Out-Null
    Write-CanonicalFSText -Client $client -ProjectId 'project-1' -Path 'safe/file.txt' -Text 'hello from powershell' | Out-Null

    $text = Read-CanonicalFSText -Client $client -ProjectId 'project-1' -Path 'safe/file.txt' -MaxBytes 64
    Assert-Equal 'read text' 'hello from powershell' $text

    $stat = Get-CanonicalFSItem -Client $client -ProjectId 'project-1' -Path 'safe/file.txt'
    Assert-Equal 'stat path' 'safe/file.txt' ([string] $stat.path)
    Assert-Equal 'stat size' 21 ([int64] $stat.size)
    Assert-True 'stat is file' (-not [bool] $stat.is_directory)

    $bytes = Read-CanonicalFSFile -Client $client -ProjectId 'project-1' -Path 'safe/file.txt' -MaxBytes 64
    Assert-Equal 'read byte count' 21 ([int] $bytes.Length)

    Rename-CanonicalFSItem -Client $client -ProjectId 'project-1' -Path 'safe/file.txt' -Target 'safe/file-renamed.txt' | Out-Null
    $renamedText = Read-CanonicalFSText -Client $client -ProjectId 'project-1' -Path 'safe/file-renamed.txt' -MaxBytes 64
    Assert-Equal 'read renamed text' 'hello from powershell' $renamedText
    Remove-CanonicalFSItem -Client $client -ProjectId 'project-1' -Path 'safe/file-renamed.txt' | Out-Null

    $gotOutsideRoot = $false
    try {
        Read-CanonicalFSText -Client $client -ProjectId 'project-1' -Path '../escape.txt' -MaxBytes 64 | Out-Null
    } catch {
        $code = & $errorCodeCommand $_
        if ($code -eq 'ERR_OUTSIDE_ROOT') { $gotOutsideRoot = $true } else { throw }
    }
    Assert-True 'traversal rejected by daemon' $gotOutsideRoot

    $unauthorizedClient = New-CanonicalFSDaemonClient -Endpoint $endpointValue -Token 'wrong-token'
    $gotUnauthorized = $false
    try {
        Open-CanonicalFSProject -Client $unauthorizedClient -ProjectId 'project-1' -HostRoot $projectRoot | Out-Null
    } catch {
        $code = & $errorCodeCommand $_
        if ($code -eq 'ERR_UNAUTHORIZED') { $gotUnauthorized = $true } else { throw }
    }
    Assert-True 'bearer token required' $gotUnauthorized

    Close-CanonicalFSProject -Client $client -ProjectId 'project-1' | Out-Null
    Write-Host 'CanonicalFS daemon PowerShell smoke tests passed'
} finally {
    if ($null -ne $daemon -and -not $daemon.HasExited) {
        $daemon.Kill()
        $daemon.WaitForExit()
    }
    if ($null -ne $tempParent -and (Test-Path -LiteralPath $tempParent)) {
        Remove-Item -LiteralPath $tempParent -Recurse -Force
    }
}
