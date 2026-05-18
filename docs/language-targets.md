# Language Targets

`spec/language-targets.json` is the source of truth for supported and planned language/runtime surfaces.

`canonicalfs` means an actual filesystem security layer. `http-client` means transport to the Go daemon and does not imply a separate root-bound implementation in that language.

## Current Support

- Go: supported for `canonicalpath`, authoritative `canonicalfs`, and daemon transport.
- Python: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm python:vectors`; no filesystem operations or daemon transport yet.
- Dart / Flutter: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm dart:vectors`; no filesystem operations or daemon transport yet.
- C# / .NET: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm csharp:vectors`; no filesystem operations or daemon transport yet.
- Swift: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm swift:vectors`; no filesystem operations or daemon transport yet.
- Kotlin: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm kotlin:vectors`; no filesystem operations or daemon transport yet.
- C: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm c:vectors`; no filesystem operations or daemon transport yet.
- Rust: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm rust:vectors`; no filesystem operations or daemon transport yet.
- C++: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm cpp:vectors`; no filesystem operations or daemon transport yet.
- Haxe: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm haxe:vectors`; no filesystem operations or daemon transport yet.
- GDScript / Godot: supported experimental lexical `canonicalpath` surface, checked against shared vectors with `pnpm gdscript:vectors`; no filesystem operations or daemon transport yet.
- JavaScript standalone/browser: supported experimental lexical `canonicalpath` surface, with no filesystem operations.
- TypeScript: supported for `canonicalpath`, best-effort/RPC-helper `canonicalfs`, and HTTP client transport.
- Bash wrapper: supported experimental CLI transport wrapper for authenticated Go daemon HTTP calls; no filesystem security boundary claims.
- Windows CMD/BAT wrapper: supported experimental CLI transport wrapper for authenticated Go daemon HTTP calls via `curl.exe` and `powershell.exe`; no filesystem security boundary claims.
- PowerShell 5.1: supported through the experimental lexical module and typed JSON HTTP client transport to the Go daemon.
- PowerShell 7: supported through the experimental lexical module and typed JSON HTTP client transport to the Go daemon.
- PowerShell module 5.1 + 7: experimental lexical `CanonicalPath` surface and typed daemon HTTP client helpers exist and are checked by shared-vector and daemon smoke tests locally and by a manual Windows workflow job.

## Early Bridge Targets

- Unity managed/Bridge adapter: managed lexical `CanonicalPath` smoke consumes shared vectors, managed daemon transport smoke delegates root-bound I/O to the Go daemon, and the minimal `ICanonicalPathService` + `PathGuard` facade validates bridge payloads for `Assets/...` and `Packages/...` only, without claiming filesystem security. `ScopedPathGuard` now provides lexical Unity MCP scope validation for `unity_asset`, `knowledge`, `package_manifest`, `artifact`, `gateway_cache`, and `temp_session`; filesystem access still must delegate to the Go daemon. Shared bridge vectors live in `spec/testdata/unity_bridge_vectors.json`; Unity MCP scoped vectors live in `spec/testdata/unity_mcp_path_scope_vectors.json` and run through TypeScript, Go, and local C# smoke gates via `pnpm unity:mcp:path-scopes:vectors`. `pnpm unity:editmode:matrix` runs package EditMode tests for local Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` installs, `UNITY_BURST_PROBE=1 pnpm unity:burst:probe` optionally checks Burst compiler compatibility, `UNITY_BURST_ALLOC_PROBE=1 pnpm unity:burst:alloc` optionally checks zero managed allocations around a warmed-up Burst workload, and `pnpm unity:burst:alloc:matrix` is the active local Unity Burst allocation matrix.

## Planned Packages

Unless a target appears under Current Support or Early Bridge Targets, package directories for planned targets are skeleton/not implemented placeholders. Their README files describe intended scope only and must not be treated as supported package APIs.

- Dart / Flutter daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- Python daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- C# / .NET daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- Swift daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- Bash wrapper daemon transport extensions remain planned beyond the current thin `canonicalfs.sh` command set.
- Windows CMD/BAT wrapper daemon transport extensions remain planned beyond the current thin `canonicalfs.cmd` command set.
- Rust daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- C daemon HTTP/client or ABI transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- C++ daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- Unity: early package coverage is active for 2022.3/6000.1/6000.2/6000.3/6000.4 through managed vector parity smoke, versioned local Unity EditMode harness, Burst-compatible unsafe buffer surface smoke, optional Burst compiler/allocation probes, and the active local Unity Burst allocation matrix; full production Unity package hardening remains planned.
- Kotlin daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native root-bound design.
- Haxe daemon HTTP transport remains planned; filesystem security must delegate to Go or a separately reviewed native/root-bound design.
- GDScript / Godot daemon HTTP transport remains planned; filesystem security must delegate to Go or engine-native abstractions reviewed separately.

## Allocation Checks

Allocation gates are not active for every language yet. The plan is tracked per target in `spec/language-targets.json` and validated by `pnpm spec:validate` so new targets cannot be added without an allocation-check plan.

Go, TypeScript, JavaScript standalone, Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, GDScript/Godot, the Bash wrapper, the Windows CMD/BAT wrapper, the PowerShell module, and the early Unity managed runtime have active lexical helper or transport allocation/memory smoke gates via `pnpm go:alloc`, `pnpm ts:alloc`, `pnpm js:standalone:alloc`, `pnpm python:alloc`, `pnpm dart:alloc`, `pnpm csharp:alloc`, `pnpm swift:alloc`, `pnpm kotlin:alloc`, `pnpm c:alloc`, `pnpm rust:alloc`, `pnpm cpp:alloc`, `pnpm haxe:alloc`, `pnpm gdscript:alloc`, `pnpm bash:alloc`, `pnpm cmd:alloc`, `pnpm ps:alloc`, and `pnpm unity:canonicalpath:alloc`. PowerShell 5.1 and PowerShell 7 also have active live daemon transport memory smoke gates via `pnpm ps:transport:alloc`. Unity managed EditMode behavior/allocation coverage is active through `pnpm unity:editmode:matrix` when the local Unity Editors are installed. `pnpm unity:burst:surface` is an active no-string unsafe buffer surface smoke for future Burst helpers, `UNITY_BURST_PROBE=1 pnpm unity:burst:probe` is an optional compiler probe, `UNITY_BURST_ALLOC_PROBE=1 pnpm unity:burst:alloc` is an optional compiler allocation probe, and `pnpm unity:burst:alloc:matrix` is the active local Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` Burst allocation gate.

The intended rule is stricter for hot lexical identity paths than for transport clients: `normalize`, `relative`, `join`, and serialization helpers should have zero or explicitly bounded steady-state allocations where the runtime makes that measurable. HTTP/PowerShell transport checks should track bounded process memory growth rather than zero allocation.
