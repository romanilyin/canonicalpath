# Authenticated daemon bootstrap

All daemon listeners, including loopback, require HTTPS with server authentication. A random bearer authorizes filesystem operations; it does not establish the identity of the process listening on a port. Every client must validate the TLS chain and hostname and match an expected certificate or public-key pin **before sending Authorization**. HTTP endpoints, missing pins, invalid certificates and redirects fail closed.

## Per-launch credentials

Run `canonicalfs-bootstrap` once for each daemon instance, under the account that will own the daemon. It creates an independent 256-bit bearer and ECDSA P-256 CA/server key pair with a 24-hour certificate lifetime. Restart with a new bundle before expiry; distribute the new trust settings through the same private local channel. Do not reuse the old token or adopt a pin returned by an unknown endpoint.

The output directory must be new and have an already private, trusted parent. The bootstrap command refuses existing output paths, links, untrusted parents and unsupported ownership platforms. It does not change existing ACLs or install a certificate into the machine trust store. Unix files are created owner-only; Windows files receive a protected DACL at creation, before secret bytes are written. The local filesystem/volume root is a trusted operating-system prerequisite; subsequent directory components are opened and checked through pinned handles.

A Unix example, using a new mode-0700 parent inside a trusted home directory:

```bash
bootstrap_parent=$(mktemp -d "$HOME/.canonicalfs-bootstrap.XXXXXXXX")
bootstrap_dir="$bootstrap_parent/instance"
go run ./packages/go/cmd/canonicalfs-bootstrap \
  -out-dir "$bootstrap_dir" -host 127.0.0.1 -listen 127.0.0.1:8765

go run ./packages/go/cmd/canonicalfs-daemon \
  -listen 127.0.0.1:8765 -allow-root /home/alice/repo \
  -token-file "$bootstrap_dir/token" \
  -tls-cert "$bootstrap_dir/certificate.pem" -tls-key "$bootstrap_dir/key.pem"
```

On Windows, first provision an empty parent directory with a protected DACL granting access only to the service/current user, SYSTEM and Administrators. Use a local trusted user/service directory, not a shared project or writable shared ancestor. Run the following in PowerShell 7, replacing the pre-provisioned parent and allowed root:

```powershell
$BootstrapDir = Join-Path $PrivateParent ('instance-' + [Guid]::NewGuid().ToString('N'))
go run ./packages/go/cmd/canonicalfs-bootstrap `
  -out-dir $BootstrapDir -host 127.0.0.1 -listen 127.0.0.1:8765
if ($LASTEXITCODE -ne 0) { throw 'Private bootstrap failed' }
go run ./packages/go/cmd/canonicalfs-daemon `
  -listen 127.0.0.1:8765 -allow-root 'C:\Users\Alice\Repo' `
  -token-file (Join-Path $BootstrapDir 'token') `
  -tls-cert (Join-Path $BootstrapDir 'certificate.pem') `
  -tls-key (Join-Path $BootstrapDir 'key.pem')
```

The bundle contains `ca.pem`, `certificate.pem` (leaf plus CA chain), `key.pem`, `token`, and `connection.json`. The JSON is written last as the completion marker; never use an incomplete bundle. Its `version: 1`, `endpoint`, `token`, `ca_certificate_pem`, `certificate_sha256` and `public_key_pin` fields describe exactly this instance. `certificate_sha256` is the SHA-256 of leaf DER; `public_key_pin` is curl's `sha256//<base64 SHA-256 of SPKI>` form. These two pins are different representations and are not interchangeable.

Keep the entire bundle private. Read it from the configured local path; do not log it, commit it, send it as command arguments or retrieve it through the daemon's network endpoint. Token/private-key access grants authority over the allowed roots. A compromised process running as the same account or an administrator is outside this local credential protection boundary. Remove retired bundles only after stopping their daemon and clients; automatic recursive rollback/deletion is deliberately absent.

## Allowed-root acquisition

`-allow-root` and `ServerOptions.AllowedRoots` are trusted operator configuration. Configure them in the daemon's host path syntax, for example `/mnt/c/Work/Repo` for a WSL daemon or `C:\Work\Repo` for a native Windows daemon. The initial directory open establishes the filesystem object to which authority is bound; the configuration path and its ancestors must be trusted at that point.

Server construction performs lexical cleanup, opens the configured directory, and retains that first root handle. It obtains the directory identity through `Root.Stat(".")`. The configured alias and its symlink-resolved name are then opened temporarily and checked against that identity using handle-backed metadata. These temporary handles only validate alias metadata and are closed; they never replace the retained authority. This also avoids a Windows identity comparison that might defer its file-ID lookup until a mutable pathname is reopened.

If an alias disappears, resolves to a different object, or cannot be verified, construction fails and closes its acquired handles. Failure while opening a later allowed root also closes earlier roots. Invalid token, limit and registration-policy options are rejected before root acquisition. After successful construction, registration and filesystem operations continue through retained roots; renaming or replacing the original directory pathname does not redirect the daemon to the replacement. Duplicate normalized allowed-root aliases do not acquire duplicate handles.

The daemon requires a [supported Go filesystem platform](api-compatibility.md#go-filesystem-platform-compatibility). Unsupported targets, including `js/wasm`, `plan9` and `wasip1`, return `ErrUnsupportedOperation` before filesystem access. The module language floor is Go `1.25.0`; the workspace toolchain recommendation and current verification pins are Go `1.26.10`.

## Client configuration

| Client | Required trust | Optional private CA |
|---|---|---|
| TypeScript `CanonicalFSHTTPClient` | `tls.certificateSha256` | `tls.caCertificatePem` |
| Unity `CanonicalFSDaemonHttpClient` | `new CanonicalFSTlsOptions(certificateSha256, caPem)` | Second constructor argument of the TLS options |
| PowerShell `New-CanonicalFSDaemonClient` | `-CertificateSha256` or `CANONICALFS_TLS_CERTIFICATE_SHA256` | `-CACertificatePath` or `CANONICALFS_TLS_CA_FILE` |
| Windows CMD/BAT | `CANONICALFS_TLS_CERTIFICATE_SHA256` | `CANONICALFS_TLS_CA_FILE` |
| Bash | `CANONICALFS_TLS_PUBLIC_KEY_PIN` | `CANONICALFS_TLS_CA_FILE` |

The endpoint is HTTPS. Wrapper endpoint/token settings remain `CANONICALFS_DAEMON_URL` and `CANONICALFS_DAEMON_TOKEN`. Supply only the environment a particular child needs; Bash removes the bearer from helper environments after capture. A production launcher should read the private connection bundle itself and launch only the intended client/daemon processes. Do not inherit the bearer into unrelated commands.

If a private CA is omitted, the normal platform CA store is used **in addition to** the required pin and hostname check. Custom instance trust avoids a global CA installation. Short-lived private bootstrap certificates have no remote revocation service; rotate/revoke their bearer and stop the old instance when retiring them. Externally provisioned certificates must follow the deployment's separate lifecycle policy.

TypeScript uses its authenticated Node HTTPS implementation; the former arbitrary `fetch` option is rejected. Unity's optional injected `HttpMessageHandler` is trusted application code for test doubles or separately reviewed transports and owns transport behavior. Use the default Unity handler for the authenticated production path. No client should disable chain validation, hostname validation, or pin matching to recover from a configuration error.

## Compatibility and checks

This is a breaking transport change: plaintext URLs and constructors without trusted pins now fail. Health checks also use TLS even though `/healthz` does not require a bearer. The daemon accepts `-tls-cert` and `-tls-key` for every listen address and retains the 32-character minimum bearer requirement. Existing response caps and whole-request deadlines remain enforced.

Run `pnpm security:regressions`, the TypeScript transport tests and the live daemon smoke gates. The authentication fixtures check that plaintext, missing/wrong pins, wrong hostnames and untrusted CAs result in zero Authorization deliveries. Bootstrap tests check certificate/key/pin consistency, per-launch rotation, exclusive creation, private ownership/permissions and Windows ACL behavior. A platform-specific SKIP is not a passing runtime check.

Allowed-root regressions deterministically replace a root, an ancestor or a symlink alias between the initial acquisition and alias binding. They also check that successful construction retains the exact original handle, failed construction closes handles, and existing registrations remain attached after pathname changes. Run the Go RPC tests on native Windows and a supported Unix target; the Linux cleanup regression checks open descriptors through `/proc/self/fd`. `pnpm go:unsupported-platforms` executes the `js/wasm` denial tests and is part of `pnpm verify`. See the [2026-10-24 verification record](security-review-2026-10-24.md#verification-status) for executed results and pending checks.
