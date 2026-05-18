# Python CanonicalPath Package

Status: supported experimental lexical target.

This package implements the lexical `canonicalpath` API for Python and consumes the shared JSON vectors used by the other language targets.

Scope:

- `canonicalpath` lexical API parity with shared vectors.
- No filesystem security guarantees in this package.
- No daemon HTTP client yet; security-sensitive filesystem operations must delegate to the Go daemon.

Local checks:

- `pnpm python:vectors`
- `pnpm python:alloc`

Public helpers include `normalize`, `relative`, `join`, `is_equal`, `to_win32`, `to_wsl`, `to_posix`, `sanitize_component`, `encode_component`, and `encode_git_ref`.
