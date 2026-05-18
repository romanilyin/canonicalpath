# Swift Package

Status: supported experimental lexical `canonicalpath` package checked against shared JSON vectors.

Swift package for CanonicalPath lexical identity and serialization.

Current scope:

- `canonicalpath` lexical API for shared vector parity (`normalize`, `relative`, `join`, equality, serialization, component sanitization, and Git ref encoding).
- No local filesystem security boundary is claimed.

Planned scope:

- Optional daemon HTTP helper for filesystem operations. The current `CanonicalPathHttpClient.swift` file remains a placeholder and is not a supported transport API yet.

Local checks:

```bash
pnpm swift:vectors
pnpm swift:alloc
```
