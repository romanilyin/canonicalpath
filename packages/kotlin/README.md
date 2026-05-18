# Kotlin Package

Status: supported experimental lexical `canonicalpath` package checked against shared JSON vectors.

Kotlin package for CanonicalPath lexical identity and serialization.

Current scope:

- `canonicalpath` lexical API from shared vectors (`normalize`, `relative`, `join`, equality, serialization, component sanitization, and Git ref encoding).
- No filesystem security boundary is claimed in this package.

Planned scope:

- Optional daemon HTTP transport helpers. The current `CanonicalPathHttpClient.kt` file remains a placeholder and is not a supported transport API yet.

Local note:

- Local checks use `kotlinc` directly to avoid Gradle/network dependency in the monorepo verification path.

Local checks:

```bash
pnpm kotlin:vectors
pnpm kotlin:alloc
```
