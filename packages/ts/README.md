# @romanilyin/canonicalpath

Shared CanonicalPath identity and daemon client helpers for cross-runtime tools.

Use this package when a path leaves TypeScript and must stay aligned with Go, Unity, PowerShell, browser UI, WSL/Windows, or agent/MCP tool payloads. It provides lexical identity plus client-side integration helpers; it is not the final filesystem security boundary.

- Root export: `@romanilyin/canonicalpath` for lexical CanonicalPath identity.
- Subpath exports: `@romanilyin/canonicalpath/canonicalpath`, `@romanilyin/canonicalpath/canonicalfs`, and `@romanilyin/canonicalpath/unity-gateway`.
- License: `MIT`.
- Canonical repository: `https://github.com/romanilyin/canonicalpath`.

Security-sensitive filesystem I/O must delegate to the Go `canonicalfs` daemon unless a separately reviewed native root-bound implementation is used.

`CanonicalFSHTTPClient` enforces local hard ceilings of 24 MiB of decoded response bytes and a 30-second overall network deadline, including error bodies. Constructor options `maxResponseBytes` and `timeoutMs` can lower these limits. The authenticated Node HTTPS transport requires `tls.certificateSha256` and an HTTPS endpoint; `tls.caCertificatePem` supplies an optional private CA. Chain, hostname and pin checks complete before Authorization is transmitted. Arbitrary custom `fetch` implementations are rejected. Responses are streamed before JSON parsing and redirects are rejected.

The bearer is stored in an ECMAScript private field and is absent from object enumeration, spreading, JSON serialization and Node inspection. JSON and default Node diagnostics expose only the client type. Keep constructor options and the private bootstrap bundle out of logs. If an older client instance entered logs or telemetry, rotate the daemon token and remove exposed copies.

`encodeGitRef` returns `v2-<slug>--<full SHA-256>` with an ASCII slug of at most 80 characters and a maximum output of 149 ASCII bytes. It hashes the exact raw UTF-8 input and rejects unpaired UTF-16 surrogates with `ERR_INVALID_COMPONENT`. All directory identities change from v1; see [migration guidance](../../Documentation/IDENTITY_V2_MIGRATION.md).

See [per-launch TLS bootstrap](../../docs/daemon-tls-bootstrap.md) for server and client migration.

## License

`@romanilyin/canonicalpath` is licensed under the MIT License.

The Unity package `com.romanilyin.canonicalpath` is licensed separately under
Stinger Royalty-Free EULA 1.0.
