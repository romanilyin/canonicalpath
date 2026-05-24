# Verification

The default local verification gate is:

```bash
pnpm verify
```

If the `pnpm` shim is not available, use `corepack pnpm` for the same commands.

## Setup

Install dependencies first:

```bash
pnpm install
```

## Equivalent individual checks

`pnpm verify` expands to the current monorepo checks. Use individual commands when isolating a failure:

```bash
pnpm spec:validate
pnpm check:error-taxonomy
node scripts/check-unity-mcp-contract.mjs
pnpm -C packages/ts typecheck
pnpm -C packages/ts test
pnpm ts:build
pnpm ts:package:smoke
pnpm ts:pack:dry-run
pnpm js:standalone:typecheck
pnpm js:standalone:build
pnpm js:standalone:build:smoke
pnpm js:standalone:test
pnpm unity:pack:dry-run
go test ./packages/go/...
pnpm scoped-daemon:smoke
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

## Race-sensitive filesystem tests

For Go race-sensitive filesystem tests, also run:

```bash
pnpm go:race
```

## Allocation and memory gates

For active allocation smoke gates, run:

```bash
pnpm alloc
```

`pnpm alloc` also runs the Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, and GDScript/Godot lexical allocation smoke gates, Bash and Windows CMD/BAT wrapper memory smoke gates, PowerShell module memory smoke gate, PowerShell live daemon transport memory smoke gate, Unity managed CanonicalPath allocation smoke, the default-skipped optional Unity Burst allocation probe, and the active Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` Burst allocation matrix when the required local tools are available.
