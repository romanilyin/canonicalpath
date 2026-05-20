# Rust Package

Status: experimental lexical `canonicalpath` implementation.

Rust support currently covers deterministic lexical identity and serialization only.

Use this package to share CanonicalPath identity with other runtimes. It does not implement `canonicalfs`, does not perform filesystem I/O, and is not an authoritative filesystem security boundary. Security-sensitive filesystem I/O must delegate to the Go daemon unless a native root-bound implementation is separately reviewed and documented.

Implemented scope:

- `normalize`, `relative`, `join`, `is_equal`, `to_win32`, `to_wsl`, `to_posix`, component sanitization, and Git ref encoding.
- Shared JSON vector smoke through `pnpm rust:vectors`.
- Bounded allocation smoke through `pnpm rust:alloc` using a global allocator counter.

Planned scope:

- Daemon HTTP client for `canonicalfs` operations.
- No Rust security claim for local filesystem access until a platform-specific root-bound implementation is designed and tested.

Allocation gate plan:

- `pnpm rust:alloc` counts global allocator calls for fixed-input lexical hot loops.
- Keep the allocation-check command tracked in `spec/language-targets.json`.
