# GDScript / Godot Package

Status: supported experimental lexical `canonicalpath` script checked against shared JSON vectors.

GDScript package for CanonicalPath lexical identity and serialization.

Use this package to store, compare, or transmit path identity across Godot and external tools. It is not an authoritative filesystem security boundary; security-sensitive filesystem I/O must delegate to the Go daemon or to an engine-native root-bound design that is separately reviewed and documented.

Current scope:

- Lexical `canonicalpath` API aligned to shared vectors (`normalize`, `relative`, `join`, equality, serialization, component sanitization, and Git ref encoding).
- Result-returning methods expose exact error codes because GDScript does not have normal exceptions.
- As of `2026.10.10-3`, `normalize`, `relative`, and `join` return the same tagged `Dictionary` as their `_result` aliases. Check `result.ok` before reading `result.value`; errors have `result.error` and no `value`. They no longer silently return an empty string.
- No filesystem security boundary in this script package.

Planned scope:

- Optional daemon HTTP transport integration points.

Local checks:

```bash
pnpm gdscript:vectors
pnpm gdscript:alloc
```
