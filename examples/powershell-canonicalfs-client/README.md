# PowerShell CanonicalFS Client Example

PowerShell 5.1 and PowerShell 7 can call the Go canonicalfs daemon over the same JSON HTTP transport.

Start the daemon:

```powershell
$TokenBytes = New-Object byte[] 32
$TokenRng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $TokenRng.GetBytes($TokenBytes) } finally { $TokenRng.Dispose() }
$env:CANONICALFS_DAEMON_TOKEN = [Convert]::ToBase64String($TokenBytes)
go run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:8765 -allow-root "C:\Users\Alice\Repo"
```

Register a project and read a file with the typed PowerShell module client:

```powershell
$ProjectId = "project-1"
Import-Module ./packages/powershell/CanonicalPath/CanonicalPath.psd1
$Client = New-CanonicalFSDaemonClient -Endpoint "http://127.0.0.1:8765" -Token $env:CANONICALFS_DAEMON_TOKEN

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
