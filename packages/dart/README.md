# Dart / Flutter CanonicalPath

Status: supported experimental lexical `canonicalpath` package.

This package implements deterministic lexical CanonicalPath helpers for Dart and Flutter consumers. It does not perform filesystem I/O and is not a filesystem security boundary.

Security-sensitive filesystem operations must delegate to the Go `canonicalfs` daemon or to a separately reviewed root-bound implementation.

## Scope

- `canonicalpath` lexical identity helpers from shared vectors.
- No local filesystem access.
- No daemon HTTP transport yet; `lib/http_client.dart` remains a planned placeholder.

## Checks

The repository runner can use a Windows Dart SDK when Dart is installed on Windows but not in WSL:

```bash
pnpm dart:vectors
pnpm dart:alloc
```
