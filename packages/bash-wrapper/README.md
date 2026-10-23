# Bash Wrapper

Status: supported experimental transport wrapper.

Thin Bash transport wrapper for the Go daemon HTTPS API.

Use this wrapper when shell automation needs to call CanonicalFS through the Go daemon. It is transport glue only; Bash does not become an independent filesystem security boundary.

Scope:

- Provide shell entry points for common CanonicalFS calls.
- Keep logic minimal: argument parsing + HTTPS request forwarding.
- No filesystem security logic; Go daemon remains the boundary.
- Requires Bash, `curl`, and `python3` for bounded transport and JSON/base64 handling. Install `canonicalfs_transport.py` alongside `canonicalfs.sh`.

Local checks:

- `pnpm bash:smoke`
- `pnpm bash:alloc`

Usage:

```bash
# Existing private output from the trusted per-launch bootstrap.
bootstrap_dir="$HOME/.local/share/canonicalfs/launch-001"
export CANONICALFS_DAEMON_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["endpoint"])' "$bootstrap_dir/connection.json")"
export CANONICALFS_TLS_PUBLIC_KEY_PIN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["public_key_pin"])' "$bootstrap_dir/connection.json")"
export CANONICALFS_TLS_CA_FILE="$bootstrap_dir/ca.pem"
export CANONICALFS_DAEMON_TOKEN="$(< "$bootstrap_dir/token")"
bash ./packages/bash-wrapper/canonicalfs.sh read-text project-1 safe/file.txt 1024
```

HTTPS is mandatory, including `127.0.0.1` and `localhost`. The wrapper requires
`CANONICALFS_TLS_PUBLIC_KEY_PIN` in curl's `sha256//<base64 SHA-256 SPKI>` format.
This is `public_key_pin` from `connection.json`, not `certificate_sha256` used
by the PowerShell/CMD/Unity clients. `CANONICALFS_TLS_CA_FILE` identifies the
trusted CA PEM for a private bootstrap; if omitted, the platform CA store is
used alongside the mandatory pin. Certificate hostname, validity and chain
checks remain enabled. HTTP, missing pins and mismatched server identities fail.
The transport disables user curl configuration, proxies and redirects.

Provision trust through a private local bootstrap or the trusted launcher.
Never fetch the expected pin or CA from the daemon endpoint. The Go
`canonicalfs-bootstrap` command creates fresh credentials in a new directory
under a pre-existing private parent on a trusted OS filesystem/volume. Run it
for each daemon launch and update all connection settings together; generated
certificates expire after 24 hours. Keep `connection.json` and `token` private.
See the repository [release/process guide](../../docs/release-process.md) for
bootstrap provisioning and daemon TLS startup.

Supported commands: `health`, `caps`, `open-project`, `close-project`, `mkdir-all`, `write-text`, `read-text`, `stat`, `remove`, and `rename`.

`write-text` takes only the project ID and destination path as arguments; UTF-8
content is read from stdin. Migrate the former third text argument to a file or
pipe, for example:

```bash
bash ./packages/bash-wrapper/canonicalfs.sh write-text project-1 safe/file.txt < ./message.txt
```

Empty stdin, NUL characters and trailing newlines are preserved. Invalid UTF-8
is rejected. Both raw input and the complete encoded JSON request have a 1 MiB
ceiling, so the usable text limit is smaller after base64 and JSON overhead.
The former positional text argument is rejected. Keep sensitive content out of
the command that invokes the wrapper as well; file redirection avoids shell
history and command-line exposure.

Text content and its base64 form never become helper/curl arguments or
environment variables. POST bodies use mode-0600 files inside a mode-0700
temporary directory and curl receives only the file path. The request and
response files are removed after success, errors and handled signals. The
bearer is passed to curl through its config stdin and removed from helper
environments. These measures do not isolate data from the same OS account or
privileged processes that can inspect memory or private files.

`node --test scripts/bash-payload-security.test.mjs` verifies payload transport,
private-file permissions/cleanup and process arguments/environments with a
synthetic curl executable. It makes no network requests; TLS checks belong to
the transport tests and smoke checks.

The local hard ceilings are 24 MiB of decoded response bytes and 30 seconds for the entire network request, including connection and body transfer. `CANONICALFS_MAX_RESPONSE_BYTES` and `CANONICALFS_TIMEOUT_SECONDS` may lower these limits but cannot raise or disable them. Fixed-length, chunked, compressed and error responses use the same byte boundary before JSON parsing. Redirects are rejected and response files are removed on errors or signals.
