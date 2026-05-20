# Language and runtime coverage

This page is the public, reader-friendly summary. The machine-readable source of truth remains `spec/language-targets.json`; detailed validation and allocation gates stay in `docs/language-targets.md`.

## Status vocabulary

Use these terms consistently:

| Term | Meaning |
|---|---|
| Primary | Main implementation surface for the project. |
| Supported lexical | Path identity functions exist and are checked by shared vectors. |
| Experimental lexical | Useful and vector-checked, but should not be treated as a hardened public API without review. |
| Transport/client | Calls the Go daemon or prepares requests; does not implement direct secure filesystem access. |
| Early bridge | Exists to support an integration surface such as Unity/MCP, but is still being hardened. |
| Authoritative FS boundary | May perform security-sensitive filesystem I/O under a root. Today this is Go CanonicalFS / daemon. |
| Delegates to Go | May validate/serialize paths locally, but real security-sensitive filesystem I/O must go through the Go daemon. |
| Lexical only | No filesystem security claim. |

## Current coverage matrix

| Runtime / language | CanonicalPath lexical identity | CanonicalFS / real I/O | Daemon/client transport | Vectors/tests | Allocation/memory gate | Security level |
|---|---:|---:|---:|---:|---:|---|
| Go | yes | yes | daemon | yes | yes | Authoritative FS boundary |
| TypeScript / Node.js | yes | helper/client only | yes | yes | yes | Delegates to Go |
| JavaScript standalone/browser | yes | no | no | yes | yes | Lexical only |
| PowerShell module | yes | no | typed HTTP client helpers | yes | yes | Delegates to Go |
| PowerShell 5.1 | transport/client focus | no | yes | smoke | yes | Delegates to Go |
| PowerShell 7 | transport/client focus | no | yes | smoke | yes | Delegates to Go |
| Bash wrapper | no lexical API; wrapper only | no | yes | smoke | yes | Delegates to Go |
| Windows CMD/BAT wrapper | no lexical API; wrapper only | no | yes | smoke | yes | Delegates to Go |
| Unity C# managed | yes | no | yes | yes | yes | Delegates to Go |
| Unity C# Burst surface | yes / low-level surface | no | no | smoke/probe | yes | Lexical only |
| Python | yes | no | planned | yes | yes | Lexical only |
| Dart / Flutter | yes | no | planned | yes | yes | Lexical only |
| C# / .NET | yes | no | planned | yes | yes | Lexical only |
| Swift | yes | no | planned | yes | yes | Lexical only |
| Kotlin | yes | no | planned | yes | yes | Lexical only |
| C | yes | no | planned | yes | yes | Lexical only |
| Rust | yes | no | planned | yes | yes | Lexical only |
| C++ | yes | no | planned | yes | yes | Lexical only |
| Haxe | yes | no | planned | yes | yes | Lexical only |
| GDScript / Godot | yes | no | planned | yes | yes | Lexical only |

## Unity coverage

Current Unity lanes are intended for editor/bridge integration and allocation-sensitive lexical work, not for standalone secure filesystem access.

| Unity lane | Surface | Security note |
|---|---|---|
| Unity 2022.3 managed | CanonicalPath managed helpers, daemon transport, PathGuard/scoped validation | Delegates real I/O to Go daemon |
| Unity 6000.1 managed | Same as above | Delegates real I/O to Go daemon |
| Unity 6000.2 managed | Same as above | Delegates real I/O to Go daemon |
| Unity 6000.3 managed | Same as above | Delegates real I/O to Go daemon |
| Unity 6000.4 managed | Same as above | Delegates real I/O to Go daemon |
| Unity Burst surfaces | No-string/unsafe-buffer lexical helpers and allocation probes | Must not claim secure filesystem access |

## Scope model for agents and Unity/MCP

Use explicit scopes instead of raw host paths.

Recommended public list:

| Scope | Intended meaning |
|---|---|
| `unity_asset` | Project-relative Unity asset paths, normally under `Assets/...`. |
| `unity_package` | Paths under `Packages/...` where package semantics are expected. |
| `package_manifest` | Package manifest/config paths that need stricter policy. |
| `knowledge` | Agent or project knowledge files controlled by the gateway. |
| `artifact` | Generated outputs and tool artifacts. |
| `gateway_cache` | Gateway-owned cache. |
| `temp_session` | Short-lived session temp files. |

Agents should not invent new scopes in docs. If a new scope is needed, add it to the spec/test vectors first.

## Recommended `spec/language-targets.json` additions

The current `status` field is not enough for user-facing docs because “supported” can mean lexical support, transport support, or authoritative I/O. Add explicit maturity and security fields before using this vocabulary in generated docs.

Example:

```json
{
  "id": "typescript",
  "language": "TypeScript",
  "status": "supported",
  "maturity": "primary-client",
  "securityLevel": "delegates-to-go-daemon",
  "surfaces": ["canonicalpath", "canonicalfs-helper", "rpc-client", "http-client"]
}
```

Suggested `securityLevel` enum:

- `authoritative-fs-boundary`
- `delegates-to-go-daemon`
- `lexical-only`
- `transport-only`
- `planned`

Suggested `maturity` enum:

- `primary`
- `supported`
- `experimental-vector-checked`
- `early-bridge`
- `transport-wrapper`
- `planned-skeleton`

## Documentation rule

Whenever a language is listed, include both what it can do and what it must not claim.

Bad:

> Python is supported.

Better:

> Python has a vector-checked lexical CanonicalPath surface. It does not provide a filesystem security boundary; security-sensitive I/O must delegate to the Go daemon or a separately reviewed native root-bound design.
