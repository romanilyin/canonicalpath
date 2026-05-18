# Haxe Package

Status: supported experimental lexical `canonicalpath` package checked against shared JSON vectors.

Haxe package for CanonicalPath lexical identity and serialization.

Current scope:

- `canonicalpath` lexical API from shared vectors (`normalize`, `relative`, `join`, equality, serialization, component sanitization, and Git ref encoding).
- No filesystem security boundary in this package.

Planned scope:

- Optional daemon HTTP transport helper for filesystem operations. The current `CanonicalPathHttpClient.hx` file remains a placeholder and is not a supported transport API yet.

Local checks:

```bash
pnpm haxe:vectors
pnpm haxe:alloc
```
