# CanonicalPath / CanonicalFS 2026.5.18-2

First public release candidate for the CanonicalPath / CanonicalFS monorepo.

## What Is Included

- Cross-platform lexical `CanonicalPath` implementations and shared JSON vectors.
- Go `canonicalpath`, `canonicalfs`, and `canonicalfsrpc` packages.
- Go `canonicalfs` daemon with bearer capability auth, allowed roots, scoped endpoints, server-side caps, and HTTP timeouts.
- npm package `@romanilyin/canonicalpath` with CanonicalPath, best-effort CanonicalFS client helpers, and Unity MCP gateway helpers.
- npm package `@romanilyin/canonicalpath-standalone` for browser-safe lexical CanonicalPath use.
- Unity Git UPM package `com.romanilyin.canonicalpath` under `packages/unity`.
- Experimental lexical/client-only targets for Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, GDScript/Godot, Bash, Windows CMD/BAT, and PowerShell.

## Coordinates

- Source tag: `2026.5.18-2`.
- Go module tag: `packages/go/v0.2026.5-18.2`.
- Go module path: `github.com/romanilyin/canonicalpath/packages/go`.
- npm: `@romanilyin/canonicalpath@2026.5.18-2`.
- npm standalone: `@romanilyin/canonicalpath-standalone@2026.5.18-2`.
- Unity Git UPM: `https://github.com/romanilyin/canonicalpath.git?path=/packages/unity#2026.5.18-2`.

## Security Boundary

`CanonicalPath` is deterministic lexical identity and serialization. It does not touch the filesystem and is not a sandbox boundary.

Go `CanonicalFS` is the root-bound filesystem access layer for security-sensitive I/O. TypeScript, PowerShell, Bash, Windows CMD/BAT, and Unity helpers must delegate security-sensitive filesystem operations to the Go daemon or another explicitly reviewed root-bound implementation.

## Known Limitations

- TypeScript `canonicalfs` is best-effort/client helper code and is not TOCTOU-proof.
- Go `canonicalfs.Rename` depends on Go root-bound rename support and must not be replaced with string joining plus `os.Rename`.
- Unity package distribution for `2026.5.18-2` is Git UPM by repository tag; npmjs scoped-registry publication is tracked separately as `com.romanilyin.canonicalpath@2026.5.24-1`.
- Several language targets are experimental lexical/client-only surfaces and are covered by shared vectors, not full production package guarantees.

## Verification

Release preparation expects these local gates before opening the repository and publishing packages:

```bash
pnpm check:changelog
pnpm verify
pnpm go:race
pnpm ts:pack:dry-run
pnpm js:standalone:pack:dry-run
pnpm audit --audit-level moderate
git diff --check
```

Run Go vulnerability scanning from `packages/go`:

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
"$(go env GOPATH)/bin/govulncheck" ./...
```
