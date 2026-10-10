# Bash Wrapper

Status: supported experimental transport wrapper.

Thin Bash transport wrapper for the Go daemon HTTP API.

Use this wrapper when shell automation needs to call CanonicalFS through the Go daemon. It is transport glue only; Bash does not become an independent filesystem security boundary.

Scope:

- Provide shell entry points for common CanonicalFS calls.
- Keep logic minimal: argument parsing + HTTP request forwarding.
- No filesystem security logic; Go daemon remains the boundary.
- Requires Bash, `curl`, and `python3` for bounded transport and JSON/base64 handling. Install `canonicalfs_transport.py` alongside `canonicalfs.sh`.

Local checks:

- `pnpm bash:smoke`
- `pnpm bash:alloc`

Usage:

```bash
CANONICALFS_DAEMON_URL=http://127.0.0.1:8765 \
CANONICALFS_DAEMON_TOKEN=token \
bash ./packages/bash-wrapper/canonicalfs.sh read-text project-1 safe/file.txt 1024
```

Supported commands: `health`, `caps`, `open-project`, `close-project`, `mkdir-all`, `write-text`, `read-text`, `stat`, `remove`, and `rename`.

The local hard ceilings are 24 MiB of decoded response bytes and 30 seconds for the entire network request, including connection and body transfer. `CANONICALFS_MAX_RESPONSE_BYTES` and `CANONICALFS_TIMEOUT_SECONDS` may lower these limits but cannot raise or disable them. Fixed-length, chunked, compressed and error responses use the same byte boundary before JSON parsing. Redirects are rejected and response files are removed on errors or signals.
