param([Parameter(Mandatory = $true)][string]$RepoRoot, [Parameter(Mandatory = $true)][string]$Endpoint)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $RepoRoot 'packages/powershell/CanonicalPath/CanonicalPath.psd1') -Force
$module = Get-Module CanonicalPath
$getCode = $module.Invoke({ Get-Command Get-CanonicalErrorCode })
$sentinel = 'security-test-dummy-bearer'
$client = New-CanonicalFSDaemonClient -Endpoint $Endpoint -Token $sentinel
foreach ($representation in @(($client | Out-String), ($client | Format-List * | Out-String), ($client | ConvertTo-Json -Depth 8), $client.ToString(), [System.Management.Automation.PSSerializer]::Serialize($client))) {
    if ($representation.Contains($sentinel)) { throw 'client representation disclosed bearer' }
}
if ($null -ne $client.PSObject.Properties['Token']) { throw 'client still exposes Token' }
try { Get-CanonicalFSDaemonHealth -Client ([pscustomobject]@{Endpoint=$Endpoint;Token=$sentinel}) | Out-Null; throw 'accepted lookalike client' }
catch { if ((& $getCode $_) -ne 'ERR_DAEMON_CLIENT') { throw } }
foreach ($mode in @('valid', 'fixed', 'chunked', 'gzip', 'error-large', 'headers', 'body', 'drip', 'error-body', 'redirect')) {
    $bounded = New-CanonicalFSDaemonClient -Endpoint ($Endpoint + '/' + $mode) -Token $sentinel -TimeoutMilliseconds 500 -MaxResponseBytes 1024
    $started = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Get-CanonicalFSDaemonCapabilities -Client $bounded | Out-Null
        if ($mode -ne 'valid') { throw ('unexpected success: ' + $mode) }
    } catch {
        if ($mode -eq 'valid') { throw }
        $expected = if ($mode -in @('fixed', 'chunked', 'gzip', 'error-large')) { 'ERR_RESPONSE_TOO_LARGE' } else { 'ERR_DAEMON' }
        if ((& $getCode $_) -ne $expected) { throw ('unexpected error for ' + $mode + ': ' + $_.Exception.Message) }
    }
    if ($started.ElapsedMilliseconds -gt 3000) { throw ('deadline exceeded for ' + $mode) }
}
try { New-CanonicalFSDaemonClient -Endpoint $Endpoint -TimeoutMilliseconds 30001 | Out-Null; throw 'raised deadline allowed' } catch { if ($_.Exception.Message -eq 'raised deadline allowed') { throw } }
try { New-CanonicalFSDaemonClient -Endpoint $Endpoint -MaxResponseBytes 25165825 | Out-Null; throw 'raised byte cap allowed' } catch { if ($_.Exception.Message -eq 'raised byte cap allowed') { throw } }
Write-Output ('PowerShell daemon resource limits and credential redaction passed: ' + $PSVersionTable.PSVersion)
