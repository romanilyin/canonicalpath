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
            $body.data_base64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($textProperty.Value))
        }
        default { throw 'Unsupported transport operation.' }
    }
    if ($method -eq 'POST') { $body.project_id=Require-Field $requestData 'project_id' }
    $base=$env:CANONICALFS_DAEMON_URL
    if ([string]::IsNullOrEmpty($base)) { $base='http://127.0.0.1:8765' }
    $url = New-Object Uri($base.TrimEnd('/') + $endpoint)
    if ($url.Scheme -notin @('http','https') -or $url.UserInfo -or $url.Query -or $url.Fragment) { throw 'Invalid daemon URL.' }
    $http=[Net.HttpWebRequest]::Create($url)
    $http.Method=$method; $http.Accept='application/json'; $http.AllowAutoRedirect=$false
    $http.Timeout=30000; $http.ReadWriteTimeout=30000
    if ($endpoint -ne '/healthz') {
        if ([string]::IsNullOrEmpty($env:CANONICALFS_DAEMON_TOKEN)) { throw 'CANONICALFS_DAEMON_TOKEN is required for this operation.' }
        $http.Headers['Authorization']='Bearer ' + $env:CANONICALFS_DAEMON_TOKEN
    }
    if ($method -eq 'POST') {
        $bytes=[Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
        $http.ContentType='application/json'; $http.ContentLength=$bytes.Length
        $stream=$http.GetRequestStream()
        try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    }
    try { $response=$http.GetResponse() }
    catch [Net.WebException] { $response=$_.Exception.Response; if ($null -eq $response) { throw 'Daemon request failed.' } }
    try {
        $output=New-Object IO.MemoryStream
        $stream=$response.GetResponseStream()
        $buffer=New-Object byte[] 8192
        try {
            while (($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {
                if ($output.Length + $count -gt 25165824) { throw 'Daemon response exceeds 24 MiB.' }
                $output.Write($buffer,0,$count)
            }
            $data=[Text.Encoding]::UTF8.GetString($output.ToArray()) | ConvertFrom-Json
        } finally { $stream.Dispose(); $output.Dispose() }
        if ($data.error) { throw ($data.error.code + ': ' + $data.error.message) }
        if ([int]$response.StatusCode -ge 400) { throw ('ERR_DAEMON: HTTP ' + [int]$response.StatusCode) }
        switch ($mode) {
            'json' { $data | ConvertTo-Json -Compress -Depth 8 }
            'stat' { $data.stat | ConvertTo-Json -Compress -Depth 8 }
            'text' { [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($data.data_base64))) }
        }
    } finally { $response.Dispose() }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
