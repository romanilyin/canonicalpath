[CmdletBinding()]
param(
    [string]$Operation,
    [string]$ProjectId,
    [string]$HostRoot,
    [string]$Path,
    [string]$Target,
    [AllowEmptyString()][string]$Text,
    [long]$MaxBytes = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

function Read-Request {
    if (-not [Console]::IsInputRedirected) { throw 'Supply operation data as JSON on redirected stdin, or invoke canonicalfs.ps1 with named parameters.' }
    $inputStream = [Console]::OpenStandardInput()
    $buffer = New-Object byte[] 8192
    $data = New-Object IO.MemoryStream
    try {
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if ($data.Length + $count -gt 1048576) { throw 'JSON request exceeds 1 MiB.' }
            $data.Write($buffer, 0, $count)
        }
        $encoding = New-Object Text.UTF8Encoding($false, $true)
        $json = $encoding.GetString($data.ToArray())
        if ([string]::IsNullOrWhiteSpace($json)) { throw 'A JSON request on stdin is required; positional CMD arguments are no longer accepted.' }
        return ($json | ConvertFrom-Json)
    } finally { $data.Dispose() }
}

function Require-Field($Request, [string]$Name) {
    $property = $Request.PSObject.Properties[$Name]
    if ($null -eq $property -or $property.Value -isnot [string] -or $property.Value.Length -eq 0) { throw ('Required string field: ' + $Name) }
    return $property.Value
}

try {
    if ($PSBoundParameters.Count -eq 0) {
        $requestData = Read-Request
    } else {
        $requestData = [pscustomobject]@{ op=$Operation; project_id=$ProjectId; host_root=$HostRoot; path=$Path; target=$Target; text=$Text; max_bytes=$MaxBytes }
    }
    # Bound every invocation mode before JSON escaping or base64 expansion.
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $inputBytes = 0L
    foreach ($property in $requestData.PSObject.Properties) {
        if ($property.Value -is [string]) {
            $inputBytes += $utf8.GetByteCount($property.Value)
            if ($inputBytes -gt 1048576) { throw 'ERR_REQUEST_TOO_LARGE: request fields exceed 1 MiB.' }
        }
    }
    $op = Require-Field $requestData 'op'
    $method = 'POST'
    $mode = 'none'
    $body = [ordered]@{}
    switch ($op) {
        'health' { $method='GET'; $endpoint='/healthz'; $mode='json' }
        'caps' { $method='GET'; $endpoint='/v1/caps'; $mode='json' }
        'open-project' { $endpoint='/v1/projects/open'; $body.host_root=Require-Field $requestData 'host_root' }
        'close-project' { $endpoint='/v1/projects/close' }
        'mkdir-all' { $endpoint='/v1/fs/mkdirAll'; $body.path=Require-Field $requestData 'path' }
        'remove' { $endpoint='/v1/fs/remove'; $body.path=Require-Field $requestData 'path' }
        'rename' { $endpoint='/v1/fs/rename'; $body.path=Require-Field $requestData 'path'; $body.target=Require-Field $requestData 'target' }
        'stat' { $endpoint='/v1/fs/stat'; $mode='stat'; $body.path=Require-Field $requestData 'path' }
        'read-text' {
            $endpoint='/v1/fs/readFile'; $mode='text'; $body.path=Require-Field $requestData 'path'
            if ($null -ne $requestData.max_bytes) { $body.max_bytes=[long]$requestData.max_bytes }
        }
        'write-text' {
            $endpoint='/v1/fs/writeFile'; $body.path=Require-Field $requestData 'path'
            $textProperty=$requestData.PSObject.Properties['text']
            if ($null -eq $textProperty -or $textProperty.Value -isnot [string]) { throw 'Required string field: text' }
            $body.data_base64=''
            $writeText=$textProperty.Value
        }
        default { throw 'Unsupported transport operation.' }
    }
    if ($method -eq 'POST') { $body.project_id=Require-Field $requestData 'project_id' }
    $json = $null
    if ($method -eq 'POST') {
        $json = $body | ConvertTo-Json -Compress
        if ($op -eq 'write-text') {
            $base64Bytes = 4L * [long][Math]::Ceiling($utf8.GetByteCount($writeText) / 3.0)
            if ($utf8.GetByteCount($json) + $base64Bytes -gt 1048576) { throw 'ERR_REQUEST_TOO_LARGE: encoded JSON request exceeds 1 MiB.' }
            $body.data_base64=[Convert]::ToBase64String($utf8.GetBytes($writeText))
            $json = $body | ConvertTo-Json -Compress
        }
        if ($utf8.GetByteCount($json) -gt 1048576) { throw 'ERR_REQUEST_TOO_LARGE: encoded JSON request exceeds 1 MiB.' }
    }
    $base=$env:CANONICALFS_DAEMON_URL
    if ([string]::IsNullOrEmpty($base)) { $base='http://127.0.0.1:8765' }
    if (-not ('CanonicalPath.PowerShell.DaemonClient' -as [type])) {
        Add-Type -Path (Join-Path $PSScriptRoot '../powershell/CanonicalPath/DaemonClient.cs') -IgnoreWarnings
    }
    $timeout = 30000
    $cap = 25165824
    if ($env:CANONICALFS_TIMEOUT_MILLISECONDS) { $timeout = [int]$env:CANONICALFS_TIMEOUT_MILLISECONDS }
    if ($env:CANONICALFS_MAX_RESPONSE_BYTES) { $cap = [int]$env:CANONICALFS_MAX_RESPONSE_BYTES }
    $client = New-Object CanonicalPath.PowerShell.DaemonClient($base, $env:CANONICALFS_DAEMON_TOKEN, $timeout, $cap)
    $response = $client.Send($method, $endpoint, $json, ($endpoint -eq '/healthz'))
    $data = $response.Json | ConvertFrom-Json
    if ($data.error) { throw ($data.error.code + ': ' + $data.error.message) }
    if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { throw ('ERR_DAEMON: HTTP ' + [int]$response.StatusCode) }
    switch ($mode) {
        'json' { $data | ConvertTo-Json -Compress -Depth 8 }
        'stat' { $data.stat | ConvertTo-Json -Compress -Depth 8 }
        'text' { [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($data.data_base64))) }
    }
    exit 0
} catch {
    $failure = $_.Exception
    while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
    $codeProperty = $failure.PSObject.Properties['Code']
    if ($null -ne $codeProperty) { [Console]::Error.WriteLine($codeProperty.Value + ': ' + $failure.Message) }
    else { [Console]::Error.WriteLine($failure.Message) }
    exit 1
}
