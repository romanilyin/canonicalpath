# CanonicalPath / CanonicalFS

**Deterministic path identity across runtimes. Root-bound filesystem access where real I/O begins.**

Every runtime has a path library. CanonicalPath is for the moment where a path leaves one runtime and enters another.

A Unity editor tool may pass a path to a TypeScript MCP gateway, a Go daemon, a PowerShell script, a browser UI, WSL, Windows, and back again. Each layer can interpret `..`, slashes, drive-relative paths, UNC paths, symlinks, device names, and missing files differently. That is how path bugs become security bugs, broken artifacts, and hard-to-debug agent behavior.

The key idea:

- `CanonicalPath` says what path identity the tool means.
- `CanonicalFS` decides whether real filesystem I/O may touch that path under a root.
- Non-Go runtimes share lexical identity and delegate security-sensitive I/O to the Go daemon.

## What this repository provides

| Layer | Purpose | Filesystem access | Security claim |
|---|---|---:|---|
| `CanonicalPath` | Deterministic lexical identity, comparison, serialization, aliases, and shared test vectors. | No | Stable identity contract, not an I/O boundary. |
| `CanonicalFS` | Root-bound filesystem access for real reads/writes. | Yes | Go implementation is the authoritative filesystem security boundary. |
| Go daemon | Capability-style HTTP/RPC boundary for non-Go clients. | Yes | Other languages delegate security-sensitive I/O to this daemon. |
| Client/runtime ports | Lexical helpers, wrappers, transports, Unity bridge adapters. | Usually no | Lexical/client-only unless explicitly documented otherwise. |

The split is intentional: **path identity is not file access**.

## Why not just use `path.normalize`, `realpath`, or safe-join code?

Use standard libraries for ordinary local path manipulation. Use CanonicalPath when a path must cross process, language, operating-system, editor, or agent boundaries without changing meaning.

CanonicalPath is designed for:

- agent tools and MCP servers that must validate scoped paths before touching a project;
- build systems and generators that reference files before they exist;
- Unity/editor pipelines that need scoped paths such as `Assets/...`, `Packages/...`, artifacts, caches, and temp sessions;
- Windows/WSL/macOS/Linux workflows where host paths and project-relative paths are not the same thing;
- archive extraction and file tools where untrusted filenames must not escape a root;
- shared test vectors so Go, TypeScript, JavaScript, Python, Dart, C#, Swift, Kotlin, C, Rust, C++, Haxe, GDScript, PowerShell, Unity, and wrappers stay aligned.

## Current language coverage

| Group | Current surface | Filesystem security boundary |
|---|---|---|
| Go | `canonicalpath`, authoritative `canonicalfs`, daemon | Yes: Go `CanonicalFS` / daemon |
| TypeScript | `canonicalpath`, best-effort `canonicalfs` helpers, RPC/HTTP clients | Delegates to Go daemon for adversarial I/O |
| JavaScript standalone/browser | lexical `canonicalpath` | No filesystem access |
| PowerShell 5.1 / 7 | lexical module, typed HTTP client helpers, daemon transport | Delegates to Go daemon |
| Bash / Windows CMD-BAT | daemon transport wrappers | Delegates to Go daemon |
| Unity C# | managed lexical helpers, PathGuard/scoped validation, daemon transport, Burst-oriented surface | Delegates to Go daemon |
| Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, GDScript/Godot | vector-checked lexical `canonicalpath` surfaces | Lexical/client-only until native root-bound FS or daemon transport is reviewed |

See `docs/language-coverage.md` and `docs/language-targets.md` for the detailed matrix.

## Security boundary rule

For security-sensitive filesystem operations, do not build paths with string concatenation, `Join`, `normalize`, or `realpath` and then open them later.

Use the root-bound filesystem layer:

- In Go, use `CanonicalFS` directly.
- In TypeScript, Unity, C#, Python, PowerShell, Bash, CMD/BAT, or other runtimes, validate and serialize with the local CanonicalPath surface, then delegate real I/O to the Go daemon unless that runtime has a separately reviewed root-bound implementation.

## Problems this is meant to prevent

- Path traversal through `..`, absolute paths, encoded separators, or mixed separators.
- Windows-specific surprises: drive-relative paths like `C:foo`, UNC paths, reserved device names, alternate data streams, trailing dots/spaces, and NUL bytes.
- Symlink and reparse-point escape from a trusted project root.
- Time-of-check/time-of-use bugs from validating a path string and opening it later.
- Zip Slip style archive writes outside the destination directory.
- Agent/MCP tools writing into the wrong project, cache, artifact, package, or temp root.
- Broken identity when one runtime stores a path and another runtime interprets it differently.

## Package identity and release

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- TypeScript/npm package: `@romanilyin/canonicalpath`.
- JavaScript standalone npm package: `@romanilyin/canonicalpath-standalone`.
- Go module: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package: `com.romanilyin.canonicalpath`.
- Unity npmjs scoped-registry release candidate: `com.romanilyin.canonicalpath@2026.5.24-1`.
- Release version: `2026.5.18-2`.
- License: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.

The full source release plan is tracked in `docs/release-2026.5.18-2.md`; Unity registry publication is tracked in `docs/release-unity-2026.5.24-1.md`. The Go module tag is `packages/go/v0.2026.5-18.2`; see `docs/release-process.md` for the release tag policy.

## Status notes

- Planned language targets and allocation-check gates are tracked in `spec/language-targets.json` and summarized in `docs/language-targets.md`.
- Planned package directories are skeleton/not implemented placeholders unless listed as supported or as an early bridge target.
- Go `canonicalfs.Rename` is intentionally unsupported on Go 1.24 because `os.Root` does not expose a root-bound rename method there. Do not replace it with `filepath.Join(root, rel)` plus `os.Rename`.

## Quick verification

After installing dependencies, run:

```bash
pnpm install
pnpm verify
```

For Go race-sensitive filesystem tests, also run:

```bash
pnpm go:race
```

For active allocation and memory smoke gates, run:

```bash
pnpm alloc
```

If the `pnpm` shim is not available, use `corepack pnpm` for the same commands. Detailed verification commands live in `docs/verification.md`.

## When not to use this

CanonicalPath is not meant to replace normal path utilities for simple, trusted, single-language applications.

You probably do not need it if:

- paths never cross a language/process/OS boundary;
- filenames are fully trusted and intentionally allowed to point anywhere;
- you only need local display formatting;
- your OS sandbox/container already handles the security boundary and you do not need cross-runtime identity.

## Philosophy

This is not an attempt to invent a universal filesystem standard. It is a practical contract for codebases where path strings are already crossing too many boundaries.

[![xkcd Standards](https://imgs.xkcd.com/comics/standards.png)](https://xkcd.com/927/)

Image: xkcd “Standards”. The point is taken seriously: CanonicalPath should be used as a narrow contract at tool boundaries, not as a reason to rewrite every path helper in every program.

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
