# PowerShell CanonicalFS Client Example

PowerShell 5.1 and PowerShell 7 can call the Go canonicalfs daemon over the same JSON HTTP transport.

Start the daemon:

```powershell
$env:CANONICALFS_DAEMON_TOKEN = "dev-token"
go run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:8765 -allow-root "C:\Users\Alice\Repo"
```

Register a project and read a file with the typed PowerShell module client:

```powershell
$ProjectId = "project-1"
$Client = New-CanonicalFSDaemonClient -Endpoint "http://127.0.0.1:8765" -Token "dev-token"

Get-CanonicalFSDaemonCapabilities -Client $Client
Open-CanonicalFSProject -Client $Client -ProjectId $ProjectId -HostRoot "C:\Users\Alice\Repo"
Read-CanonicalFSText -Client $Client -ProjectId $ProjectId -Path "README.md" -MaxBytes 1048576
```

Raw transport remains straightforward when needed:

```powershell
$Endpoint = "http://127.0.0.1:8765"
$Headers = @{ Authorization = "Bearer dev-token" }

$Response = Invoke-RestMethod -Method Post -Uri "$Endpoint/v1/fs/readFile" -Headers $Headers -ContentType "application/json" -Body (@{
  project_id = $ProjectId
  path = "README.md"
  max_bytes = 1048576
} | ConvertTo-Json)

[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Response.data_base64))
```

PowerShell client support is daemon transport/client support. The Go daemon remains the security boundary for filesystem access.
