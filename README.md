# CanonicalPath / CanonicalFS

[![xkcd Standards](https://imgs.xkcd.com/comics/standards.png)](https://xkcd.com/927/)

> Image: xkcd “Standards”.

Monorepo for cross-platform path identity and root-bound filesystem access.

This repository follows the plan in `Documentation/`:

- `CanonicalPath` is deterministic lexical identity and serialization.
- `CanonicalFS` is root-bound filesystem access for real I/O.
- `PathAliases` bridge one canonical project root to client-specific host paths.

## Current Status

Initial MVP implementation is present:

- Shared JSON test vectors and validation script.
- Go `canonicalpath` lexical identity implementation.
- JavaScript standalone/browser `canonicalpath` lexical implementation.
- Python experimental lexical `canonicalpath` implementation checked against shared vectors.
- Dart / Flutter experimental lexical `canonicalpath` implementation checked against shared vectors.
- C# / .NET experimental lexical `canonicalpath` implementation checked against shared vectors.
- Swift experimental lexical `canonicalpath` implementation checked against shared vectors.
- Kotlin experimental lexical `canonicalpath` implementation checked against shared vectors.
- C experimental lexical `canonicalpath` implementation checked against shared vectors.
- Rust experimental lexical `canonicalpath` implementation checked against shared vectors.
- C++ experimental lexical `canonicalpath` implementation checked against shared vectors.
- Haxe experimental lexical `canonicalpath` implementation checked against shared vectors.
- GDScript / Godot experimental lexical `canonicalpath` implementation checked against shared vectors.
- TypeScript `canonicalpath` lexical identity implementation.
- Go `canonicalfs` root-bound file access using Go `os.Root`.
- Go `canonicalfs` HTTP daemon for root-bound project file access with bearer capability auth, allowed-root registration, server-side caps, and HTTP timeouts.
- TypeScript `canonicalfs` best-effort layer plus RPC/HTTP client wrappers with explicit security limitations.
- Bash experimental transport wrapper for authenticated Go daemon HTTP calls.
- Windows CMD/BAT experimental transport wrapper for authenticated Go daemon HTTP calls.
- TypeScript Unity MCP gateway skeleton with fake bridge, read/status/log/path-validation tools, and guarded write command contracts.
- Unity bridge read-only built-ins for status, project info, recent logs, validated text reads, and path validation.
- PowerShell 5.1 and PowerShell 7 experimental lexical module plus typed HTTP client helpers for the Go daemon.
- Cross-language vector result comparison for Go, TypeScript, and JavaScript standalone.
- Early Unity bridge adapter/facade is present before Unity write commands: `ICanonicalPathService` + `PathGuard` for `Assets/...` / `Packages/...` payload validation.
- Active local target matrix for Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` with managed EditMode and Burst allocation lanes; Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, and GDScript/Godot have experimental lexical lanes.

Supported runtime surfaces are Go, Python lexical, Dart/Flutter lexical, C#/.NET lexical, Swift lexical, Kotlin lexical, C lexical, Rust lexical, C++ lexical, Haxe lexical, GDScript/Godot lexical, JavaScript standalone/browser, TypeScript, Bash transport wrapper, Windows CMD/BAT transport wrapper, PowerShell 5.1, and PowerShell 7. Bash, Windows CMD/BAT, PowerShell, Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, and GDScript/Godot support are lexical/client-only or transport-only and must still use the Go daemon as the filesystem security boundary for security-sensitive I/O.

Planned language targets and allocation-check gates are tracked in `spec/language-targets.json` and summarized in `docs/language-targets.md`. Planned package directories are skeleton/not implemented placeholders unless listed as supported or as an early bridge target.

Go `canonicalfs.Rename` is intentionally unsupported on Go 1.24 because `os.Root` does not expose a root-bound rename method there. Do not replace it with `filepath.Join(root, rel)` plus `os.Rename`.

## Public Package Identity

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- TypeScript/npm package name: `@romanilyin/canonicalpath`.
- Go module path: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package name: `com.romanilyin.canonicalpath`.
- License: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.

The repository remains private until the public release step. These identifiers are fixed now so downstream Unity MCP work can target the future public package instead of private or temporary coordinates.

## Initial Verification

After installing dependencies with `pnpm install`, run:

```bash
pnpm verify
```

Equivalent individual commands:

```bash
pnpm spec:validate
pnpm check:unity-mcp-contract
pnpm -C packages/ts typecheck
pnpm -C packages/ts test
pnpm js:standalone:typecheck
pnpm js:standalone:build
pnpm js:standalone:build:smoke
pnpm js:standalone:test
go test ./packages/go/...
pnpm vectors
pnpm python:vectors
pnpm dart:vectors
pnpm csharp:vectors
pnpm swift:vectors
pnpm kotlin:vectors
pnpm c:vectors
pnpm rust:vectors
pnpm cpp:vectors
pnpm haxe:vectors
pnpm gdscript:vectors
pnpm bash:smoke
pnpm cmd:smoke
pnpm unity:canonicalpath:vectors
pnpm unity:bridge:vectors
pnpm unity:mcp:path-scopes:vectors
pnpm unity:canonicalfs:transport:smoke
pnpm unity:burst:surface
pnpm unity:burst:probe
pnpm unity:editmode:matrix
pnpm ps:test
```

For Go race-sensitive filesystem tests, also run:

```bash
pnpm go:race
```

For active allocation smoke gates, run:

```bash
pnpm alloc
```

`pnpm alloc` also runs the Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, and GDScript/Godot lexical allocation smoke gates, Bash and Windows CMD/BAT wrapper memory smoke gates, PowerShell module memory smoke gate, PowerShell live daemon transport memory smoke gate, Unity managed CanonicalPath allocation smoke, the default-skipped optional Unity Burst allocation probe, and the active Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` Burst allocation matrix when the required local tools are available.

If the `pnpm` shim is not available, use `corepack pnpm` for the same commands.

## License

This project is licensed under **Stinger Royalty-Free EULA 1.0**.

- Authoritative version: Russian text in `LICENSE.ru.md`.
- English convenience text: `LICENSE.md`, provided for readability.
- SPDX identifier: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.
- Licensor: ROMAN ILYIN.
- Canonical repository: https://github.com/romanilyin/canonicalpath.

Free for personal, internal, open, and commercial End Products. Royalty-free. Attribution and the Canonical Repository notice must be preserved. Standalone sale, resale, paid redistribution, or standalone commercialization of this Asset or Derivative Assets is prohibited.

The Russian EULA is the primary and controlling version. If the Russian and English versions conflict, differ, or are interpreted differently, the Russian version controls.

See `LICENSE.md` for the English convenience text, `LICENSE.ru.md` for the authoritative Russian text, and `NOTICE.md` for project-specific notices.
