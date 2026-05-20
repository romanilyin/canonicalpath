# @romanilyin/canonicalpath

Shared CanonicalPath identity and daemon client helpers for cross-runtime tools.

Use this package when a path leaves TypeScript and must stay aligned with Go, Unity, PowerShell, browser UI, WSL/Windows, or agent/MCP tool payloads. It provides lexical identity plus client-side integration helpers; it is not the final filesystem security boundary.

- Root export: `@romanilyin/canonicalpath` for lexical CanonicalPath identity.
- Subpath exports: `@romanilyin/canonicalpath/canonicalpath`, `@romanilyin/canonicalpath/canonicalfs`, and `@romanilyin/canonicalpath/unity-gateway`.
- License: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.
- Canonical repository: `https://github.com/romanilyin/canonicalpath`.

Security-sensitive filesystem I/O must delegate to the Go `canonicalfs` daemon unless a separately reviewed native root-bound implementation is used.
