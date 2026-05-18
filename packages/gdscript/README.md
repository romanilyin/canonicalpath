# GDScript / Godot Package

Status: supported experimental lexical `canonicalpath` script checked against shared JSON vectors.

GDScript package for CanonicalPath lexical identity and serialization.

Current scope:

- Lexical `canonicalpath` API aligned to shared vectors (`normalize`, `relative`, `join`, equality, serialization, component sanitization, and Git ref encoding).
- Result-returning methods expose exact error codes because GDScript does not have normal exceptions.
- No filesystem security boundary in this script package.

Planned scope:

- Optional daemon HTTP transport integration points.

Local checks:

```bash
pnpm gdscript:vectors
pnpm gdscript:alloc
```
