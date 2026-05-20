# Windows CMD/BAT Wrapper

Status: supported experimental transport wrapper.

This package provides a thin Windows `.cmd` CLI over the Go `canonicalfs` daemon HTTP API.

Use it when CMD/BAT automation needs to call CanonicalFS through the Go daemon. It does not perform local filesystem security checks and is not an independent filesystem security boundary. Security-sensitive filesystem operations must still be authorized and executed by the Go daemon.

## Requirements

- `cmd.exe`
- `curl.exe`
- `powershell.exe`
- A running `canonicalfs-daemon`

## Usage

Set daemon connection details first:

```cmd
set CANONICALFS_DAEMON_URL=http://127.0.0.1:8765
set CANONICALFS_DAEMON_TOKEN=<capability-token>
```

Then call the wrapper:

```cmd
packages\windows-cmd-batch-wrapper\canonicalfs.cmd health
packages\windows-cmd-batch-wrapper\canonicalfs.cmd caps
packages\windows-cmd-batch-wrapper\canonicalfs.cmd open-project my-project C:\Work\Project
packages\windows-cmd-batch-wrapper\canonicalfs.cmd mkdir-all my-project safe
packages\windows-cmd-batch-wrapper\canonicalfs.cmd write-text my-project safe\file.txt "hello from cmd"
packages\windows-cmd-batch-wrapper\canonicalfs.cmd read-text my-project safe\file.txt 128
packages\windows-cmd-batch-wrapper\canonicalfs.cmd stat my-project safe\file.txt
packages\windows-cmd-batch-wrapper\canonicalfs.cmd remove my-project safe\file.txt
packages\windows-cmd-batch-wrapper\canonicalfs.cmd close-project my-project
```

`canonicalpath.cmd` is a compatibility forwarder to `canonicalfs.cmd` for the current transport wrapper surface.

## Checks

```bash
pnpm cmd:smoke
pnpm cmd:alloc
```
