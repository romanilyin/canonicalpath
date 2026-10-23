#requires -Version 5.1

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
    if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') {
        throw 'Starting a private smoke-test daemon requires PowerShell 7 Core; legacy compatibility runs must supply an external TLS daemon.'
    }
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
$ownsTempParent = $false
$projectRoot = $HostRoot
$endpointValue = $Endpoint
$tokenValue = $Token
$certificateSha256 = $env:CANONICALFS_TLS_CERTIFICATE_SHA256
$caCertificatePath = $env:CANONICALFS_TLS_CA_FILE
$daemon = $null

try {
    if (-not $useExternalDaemon) {
        $tempParent = Join-Path ([System.IO.Path]::GetTempPath()) ('canonicalfs-ps-smoke-' + [guid]::NewGuid().ToString('n'))
        # Protect the newly created empty parent before generating credentials.
        # The bootstrap command independently validates its owner, ACL/mode and
        # ancestors, and refuses an existing bootstrap output directory.
        New-Item -ItemType Directory -Path $tempParent | Out-Null
        $ownsTempParent = $true
        if ($IsWindows) {
            $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
            try {
                $acl = [System.Security.AccessControl.DirectorySecurity]::new()
                $acl.SetOwner($identity.User)
                $acl.SetAccessRuleProtection($true, $false)
                $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
                foreach ($sid in @($identity.User, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
                    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
                    $acl.AddAccessRule($rule)
                }
                Set-Acl -LiteralPath $tempParent -AclObject $acl
            } finally { $identity.Dispose() }
        } else {
            & chmod 700 $tempParent
            if ($LASTEXITCODE -ne 0) { throw 'failed to protect the smoke-test parent directory' }
        }
        $projectRoot = Join-Path $tempParent 'project'
        New-Item -ItemType Directory -Path $projectRoot | Out-Null
        $port = New-FreeTcpPort
        $listenAddress = '127.0.0.1:' + $port

        # Own the actual daemon process, not the go run parent. Bootstrap root
        # handles stay open until daemon exit and lock the fixture on Windows.
        $daemonExecutable = Join-Path $tempParent 'canonicalfs-daemon.exe'
        $bootstrapExecutable = Join-Path $tempParent 'canonicalfs-bootstrap.exe'
        Push-Location -LiteralPath $RepoRoot
        try {
            & $GoCommand build -o $daemonExecutable ./packages/go/cmd/canonicalfs-daemon
            if ($LASTEXITCODE -ne 0) { throw 'failed to build the smoke-test daemon' }
            & $GoCommand build -o $bootstrapExecutable ./packages/go/cmd/canonicalfs-bootstrap
            if ($LASTEXITCODE -ne 0) { throw 'failed to build the smoke-test bootstrap command' }
        } finally { Pop-Location }
        $bootstrapDirectory = Join-Path $tempParent 'bootstrap'
        & $bootstrapExecutable -out-dir $bootstrapDirectory -host '127.0.0.1' -listen $listenAddress | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'failed to create private per-launch daemon credentials' }
        $connection = [IO.File]::ReadAllText((Join-Path $bootstrapDirectory 'connection.json')) | ConvertFrom-Json
        if ($connection.version -ne 1) { throw 'unexpected bootstrap connection version' }
        $endpointValue = [string] $connection.endpoint
        $tokenValue = [string] $connection.token
        $certificateSha256 = [string] $connection.certificate_sha256
        $caCertificatePath = Join-Path $bootstrapDirectory 'ca.pem'
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $daemonExecutable
        foreach ($argument in @('-listen', $listenAddress, '-allow-root', $projectRoot,
                '-tls-cert', (Join-Path $bootstrapDirectory 'certificate.pem'),
                '-tls-key', (Join-Path $bootstrapDirectory 'key.pem'),
                '-token-file', (Join-Path $bootstrapDirectory 'token'))) {
            $psi.ArgumentList.Add($argument)
        }
        $psi.WorkingDirectory = $RepoRoot
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardError = $true
        $psi.RedirectStandardOutput = $true
        $psi.EnvironmentVariables.Remove('CANONICALFS_DAEMON_TOKEN')
        $daemon = [System.Diagnostics.Process]::Start($psi)
    }

    $client = New-CanonicalFSDaemonClient -Endpoint $endpointValue -Token $tokenValue -CertificateSha256 $certificateSha256 -CACertificatePath $caCertificatePath
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

    $unauthorizedClient = New-CanonicalFSDaemonClient -Endpoint $endpointValue -Token 'wrong-token' -CertificateSha256 $certificateSha256 -CACertificatePath $caCertificatePath
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
    if ($null -ne $daemon) { $daemon.Dispose() }
    if ($ownsTempParent -and $null -ne $tempParent -and (Test-Path -LiteralPath $tempParent)) {
        Remove-Item -LiteralPath $tempParent -Recurse -Force
    }
}
