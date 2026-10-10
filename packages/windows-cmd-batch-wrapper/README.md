# Windows CMD/BAT Wrapper

Status: supported experimental transport wrapper.

This package provides a thin Windows `.cmd` CLI over the Go `canonicalfs` daemon HTTP API.

Use it when CMD/BAT automation needs to call CanonicalFS through the Go daemon. It does not perform local filesystem security checks and is not an independent filesystem security boundary. Security-sensitive filesystem operations must still be authorized and executed by the Go daemon.

## Requirements

- `cmd.exe`
- `powershell.exe`
- A running `canonicalfs-daemon`

## Usage

Set daemon connection details first:

```cmd
set CANONICALFS_DAEMON_URL=http://127.0.0.1:8765
set CANONICALFS_DAEMON_TOKEN=<capability-token>
```

Create a UTF-8 JSON request file (for example, `request.json` containing `{"op":"health"}`), then redirect it to the fixed wrapper:

```cmd
packages\windows-cmd-batch-wrapper\canonicalfs.cmd < request.json
```

The wrapper accepts at most 1 MiB of UTF-8 JSON. Generate files with a JSON serializer; request values must never be assembled into a CMD command, `CALL`, `SET`, or `echo` expression. Positional arguments are no longer processed as of `2026.10.10-1`.

| Operation | JSON request fields |
| --- | --- |
| `health`, `caps` | `op` |
| `open-project` | `op`, `project_id`, `host_root` |
| `close-project` | `op`, `project_id` |
| `mkdir-all`, `remove`, `stat` | `op`, `project_id`, `path` |
| `rename` | `op`, `project_id`, `path`, `target` |
| `read-text` | `op`, `project_id`, `path`, optional `max_bytes` |
| `write-text` | `op`, `project_id`, `path`, `text` |

For example:

```json
{"op":"write-text","project_id":"my-project","path":"safe/file.txt","text":"hello from cmd"}
```

`canonicalpath.cmd` accepts the same JSON stdin interface. Both shims call the same fixed `canonicalfs.ps1` script. PowerShell callers can invoke that script directly with named parameters and variables:

```powershell
& ./packages/windows-cmd-batch-wrapper/canonicalfs.ps1 -Operation write-text -ProjectId my-project -Path safe/file.txt -Text $text
```

Requests have 30-second HTTP timeouts, reject redirects, and bound responses to 24 MiB. The bearer token is read from the environment and never forwarded in process arguments.

## Checks

```bash
pnpm cmd:smoke
pnpm cmd:alloc
```
