# Security Policy

`canonicalfs` is the security-sensitive package in this repository. Do not treat `canonicalpath` lexical normalization as a filesystem sandbox.

## Current Guarantees

- Go `canonicalfs` uses Go `os.Root` for root-bound filesystem access.
- File operations validate relative paths before I/O and reject absolute paths, NUL, and lexical `..` escapes.
- ZIP extraction opens output files through `canonicalfs.Root` and rejects archive member paths that escape the destination.
- Symlink escape and symlink-swap race attempts are covered by Go filesystem tests.

## Non-Guarantees

- `canonicalpath` only provides deterministic lexical identity and serialization.
- TypeScript `canonicalfs` is best-effort/RPC-helper code and is not TOCTOU-proof.
- PowerShell 5.1 and PowerShell 7 lexical/client support goes through the Go daemon for security-sensitive filesystem I/O and is not a separate filesystem security layer.
- Go `canonicalfs.Rename` is unsupported on Go versions before `1.26`; do not replace it with string joining plus `os.Rename`.

Report suspected traversal, symlink escape, archive extraction, or path identity bugs privately until a disclosure process is published.
