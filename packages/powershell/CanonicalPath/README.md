# CanonicalPath PowerShell Module

Experimental lexical CanonicalPath module for Windows PowerShell 5.1 and PowerShell 7, with typed CanonicalFS daemon HTTP client helpers.

The lexical helpers only implement deterministic path identity and serialization. The CanonicalFS functions are JSON HTTP client wrappers for the Go daemon. This module does not implement local filesystem security; security-sensitive filesystem I/O must stay delegated to the Go CanonicalFS daemon.

## Daemon Client

```powershell
$Client = New-CanonicalFSDaemonClient -Endpoint 'http://127.0.0.1:8765' -Token 'dev-token'
Get-CanonicalFSDaemonHealth -Client $Client
Get-CanonicalFSDaemonCapabilities -Client $Client
Open-CanonicalFSProject -Client $Client -ProjectId 'project-1' -HostRoot 'C:\Users\Alice\Repo'
Read-CanonicalFSText -Client $Client -ProjectId 'project-1' -Path 'README.md' -MaxBytes 1048576
```

Supported daemon operations are health, capabilities, project open/close, read/write file or UTF-8 text, stat, mkdirAll, remove, and rename. All non-health calls send `Authorization: Bearer <token>`.

## Test

```powershell
./test/CanonicalPath.Tests.ps1 -RepoRoot ../../..
./test/CanonicalFSDaemonClient.Smoke.ps1 -RepoRoot ../../..
```

From the repository root, `pnpm ps:test` runs the local PowerShell smoke suite with the first available shell. On Windows, `pnpm ps:test -- --all-available` runs the same suite with Windows PowerShell 5.1 (`powershell.exe`) and PowerShell 7 (`pwsh`) when both are available; the manual `ci` workflow uses this mode on `windows-latest`.

`pnpm ps:alloc` runs a bounded private-bytes smoke check for repeated lexical helper loops and daemon client object construction. On Windows, `pnpm ps:alloc -- --all-available` runs the gate with both available PowerShell editions.

`pnpm ps:transport:alloc` starts the Go daemon with a temporary allowlisted root and runs a bounded private-bytes smoke check over repeated live daemon HTTP calls. On Windows, `pnpm ps:transport:alloc -- --all-available` runs the gate with both available PowerShell editions.

The vector tests consume shared JSON vectors from `spec/testdata/*_cases.json`. The daemon smoke test starts the Go daemon with a temporary allowlisted root and verifies the PowerShell client transport. Filesystem security-sensitive I/O remains enforced by the Go daemon, not by this module.
