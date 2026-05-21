# Dart / Flutter CanonicalPath

Status: supported experimental lexical `canonicalpath` package.

This package gives Dart and Flutter code the same deterministic lexical CanonicalPath identity contract used by the other language targets.

Use it to store, compare, or transmit path identity across tools. It does not perform filesystem I/O and is not an authoritative filesystem security boundary. Security-sensitive filesystem operations must delegate to the Go `canonicalfs` daemon or to a separately reviewed root-bound implementation.

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
