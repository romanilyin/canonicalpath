# Python CanonicalPath Package

Status: supported experimental lexical target.

This package gives Python code the same lexical CanonicalPath identity contract used by the other language targets.

Use it to store, compare, or transmit path identity across tools. It is not an authoritative filesystem security boundary; security-sensitive filesystem operations must delegate to the Go daemon unless a separately reviewed native root-bound implementation is added.

Scope:

- `canonicalpath` lexical API parity with shared vectors.
- No filesystem security guarantees in this package.
- No daemon HTTP client yet.

Local checks:

- `pnpm python:vectors`
- `pnpm python:alloc`

Public helpers include `normalize`, `relative`, `join`, `is_equal`, `to_win32`, `to_wsl`, `to_posix`, `sanitize_component`, `encode_component`, and `encode_git_ref`.
