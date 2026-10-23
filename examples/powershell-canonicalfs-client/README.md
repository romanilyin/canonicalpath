# PowerShell CanonicalFS Client Example

Use PowerShell 7 and the bounded managed HTTPS transport. Create a private per-launch bundle and start the daemon with the [bootstrap guide](../../docs/daemon-tls-bootstrap.md). In the client shell, set `$BootstrapDir` to that trusted private instance directory.

Register a project and read a file with the typed PowerShell module client:

```powershell
$ProjectId = "project-1"
Import-Module ./packages/powershell/CanonicalPath/CanonicalPath.psd1
$Connection = Get-Content -LiteralPath (Join-Path $BootstrapDir 'connection.json') -Raw | ConvertFrom-Json
$Client = New-CanonicalFSDaemonClient -Endpoint $Connection.endpoint -Token $Connection.token `
  -CertificateSha256 $Connection.certificate_sha256 -CACertificatePath (Join-Path $BootstrapDir 'ca.pem')

Get-CanonicalFSDaemonCapabilities -Client $Client
Open-CanonicalFSProject -Client $Client -ProjectId $ProjectId -HostRoot "C:\Users\Alice\Repo"
Read-CanonicalFSText -Client $Client -ProjectId $ProjectId -Path "README.md" -MaxBytes 1048576
```

For lower-level transport, use the same bounded client (30-second total deadline and 24 MiB decoded response cap):

```powershell
$Json = @{
  project_id = $ProjectId
  path = "README.md"
  max_bytes = 1048576
} | ConvertTo-Json -Compress
$Response = $Client.Send('POST', '/v1/fs/readFile', $Json, $false).Json | ConvertFrom-Json

[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Response.data_base64))
```

PowerShell client support is daemon transport/client support. The Go daemon remains the security boundary for filesystem access.
