# @romanilyin/canonicalpath

Shared CanonicalPath identity and daemon client helpers for cross-runtime tools.

Use this package when a path leaves TypeScript and must stay aligned with Go, Unity, PowerShell, browser UI, WSL/Windows, or agent/MCP tool payloads. It provides lexical identity plus client-side integration helpers; it is not the final filesystem security boundary.

- Root export: `@romanilyin/canonicalpath` for lexical CanonicalPath identity.
- Subpath exports: `@romanilyin/canonicalpath/canonicalpath`, `@romanilyin/canonicalpath/canonicalfs`, and `@romanilyin/canonicalpath/unity-gateway`.
- License: `MIT`.
- Canonical repository: `https://github.com/romanilyin/canonicalpath`.

Security-sensitive filesystem I/O must delegate to the Go `canonicalfs` daemon unless a separately reviewed native root-bound implementation is used.

`CanonicalFSHTTPClient` enforces local hard ceilings of 24 MiB of decoded response bytes and a 30-second overall network deadline, including error bodies. Constructor options `maxResponseBytes` and `timeoutMs` can lower these limits. Custom `fetch` implementations receive an AbortSignal and must honor cancellation to stop their own network work; the client independently enforces completion deadlines. Responses are streamed before JSON parsing and redirects are rejected.

`encodeGitRef` rejects unpaired UTF-16 surrogates with `ERR_INVALID_COMPONENT`; valid Unicode keeps its existing encoding.

## License

`@romanilyin/canonicalpath` is licensed under the MIT License.

The Unity package `com.romanilyin.canonicalpath` is licensed separately under
Stinger Royalty-Free EULA 1.0.
