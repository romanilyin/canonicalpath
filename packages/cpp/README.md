# C++ Package

Status: experimental lexical `canonicalpath` implementation.

C++ support currently covers deterministic lexical identity and serialization only. It does not implement `canonicalfs`, does not perform filesystem I/O, and is not a security boundary.

Implemented scope:

- `normalize`, `relative`, `join`, `is_equal`, `to_win32`, `to_wsl`, `to_posix`, component sanitization, and Git ref encoding.
- Shared JSON vector smoke through `pnpm cpp:vectors`.
- Bounded allocation smoke through `pnpm cpp:alloc` using a global `operator new` counter.

Planned scope:

- Daemon HTTP client for `canonicalfs` operations.
- No C++ security claim for local filesystem access until platform root-bound primitives are implemented and tested.

Allocation gate plan:

- `pnpm cpp:alloc` counts `operator new` calls for fixed-input lexical hot loops.
- Keep the allocation-check command tracked in `spec/language-targets.json`.
