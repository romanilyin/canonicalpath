# Threat Model

The full threat model is defined in `../Documentation/02_PROBLEM_MODEL_AND_THREAT_MODEL.md`.

## In Scope For MVP Tests

- Lexical traversal: `..`, duplicate separators, absolute path injection, and Windows drive-relative paths.
- Encoded separator traversal in URIs: `%2F` and `%5C` are rejected when URI separator rejection is enabled.
- Prefix sibling bypass: `/app` vs `/app-evil`, `c:/repo` vs `c:/repo-evil`.
- Symlink escape from project root in Go `canonicalfs`.
- Symlink-swap race attempts in Go `canonicalfs`.
- ZIP member traversal such as `../outside/pwned.txt`.
- Git branch directory collision when refs differ only by slash replacement.

## Out Of Scope For `canonicalpath`

- Filesystem existence checks.
- Symlink resolution.
- Permissions and ownership checks.
- TOCTOU protection.

`canonicalpath` is a deterministic identity/serialization layer only.

## TypeScript `canonicalfs` Limitation

TypeScript local file operations are best-effort only. Security-sensitive file tools should delegate real I/O to the Go daemon implementation.
