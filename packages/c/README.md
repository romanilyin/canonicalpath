# C Package

Status: experimental lexical `canonicalpath` implementation.

C support currently covers deterministic lexical identity and serialization only.

Use this package to share CanonicalPath identity with other runtimes. It does not implement `canonicalfs`, does not perform filesystem I/O, and is not an authoritative filesystem security boundary. Security-sensitive filesystem I/O must delegate to the Go daemon unless a native root-bound implementation is separately reviewed and documented.

Implemented scope:

- `normalize`, `relative`, `join`, `is_equal`, `to_win32`, `to_wsl`, `to_posix`, component sanitization, and Git ref encoding.
- Shared JSON vector smoke through `pnpm c:vectors`.
- Bounded allocation smoke through `pnpm c:alloc` using wrapped `malloc`/`calloc`/`realloc` counters.

Planned scope:

- Optional HTTP helpers for daemon-based `canonicalfs` operations.
- No filesystem security boundary is claimed locally.

API notes:

- Returned `canonicalpath_result.value` strings are heap-owned and must be released with `canonicalpath_result_free`.
- Length-aware `_n` entrypoints are provided so tests and callers can reject embedded NUL bytes explicitly.
