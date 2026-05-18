# Unity Package Plan

Status: early managed CanonicalPath runtime plus bridge facade scaffold. `CanonicalPath`, `CanonicalPathBurst`, `CanonicalFSDaemonHttpClient`, `ICanonicalPathService`, `CanonicalPathValue`, `PathGuard`, and `ScopedPathGuard` are present for lexical identity, Burst-compatible unsafe buffer helper shape, daemon transport, bridge payload validation, and Unity MCP scope validation; the Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` EditMode and Burst allocation matrix is active locally. Full Unity package hardening remains planned. The TypeScript gateway skeleton lives in `@romanilyin/canonicalpath/unity-gateway`.

CanonicalPath behavior is tracked in shared vectors at `spec/testdata/*.json` and consumed by the local C# smoke gate via `pnpm unity:canonicalpath:vectors`. Bridge payload behavior is tracked in shared vectors at `spec/testdata/unity_bridge_vectors.json`; the TypeScript gateway and local C# smoke gate consume these vectors today. Unity MCP scope behavior is tracked in `spec/testdata/unity_mcp_path_scope_vectors.json` and consumed by TypeScript, Go, and local C# smoke gates through `pnpm unity:mcp:path-scopes:vectors`. `pnpm unity:burst:surface` checks the no-string unsafe buffer helper shape under dotnet. `pnpm unity:burst:probe` is a default-skipped optional compiler probe; set `UNITY_BURST_PROBE=1` to run it against an installed Unity Editor and `com.unity.burst`. `pnpm unity:burst:alloc` is a default-skipped optional allocation probe; set `UNITY_BURST_ALLOC_PROBE=1` to compile a Burst function pointer, warm it up, and assert zero managed allocations around the Burst workload. `pnpm unity:editmode:matrix` runs the active local versioned EditMode lanes, and `pnpm unity:burst:alloc:matrix` runs the active local versioned Burst allocation lanes.

Unity local matrix coverage is active for these editor/runtime lanes:

- Unity `2022.3` managed C# local EditMode coverage.
- Unity `2022.3` Burst-compatible C# local allocation coverage.
- Unity `6000.1` managed C# local EditMode coverage.
- Unity `6000.1` Burst-compatible C# local allocation coverage.
- Unity `6000.2` managed C# local EditMode coverage.
- Unity `6000.2` Burst-compatible C# local allocation coverage.
- Unity `6000.3` managed C# local EditMode coverage.
- Unity `6000.3` Burst-compatible C# local allocation coverage.
- Unity `6000.4` managed C# local EditMode coverage.
- Unity `6000.4` Burst-compatible C# local allocation coverage.

Local package use:

- Add `packages/unity/package.json` through Unity Package Manager's local package flow, or use a manifest `file:` dependency pointing at `packages/unity`.
- The package does not declare `com.unity.burst` as a default dependency; Burst probes create temporary projects that include `com.unity.burst` explicitly.
- Treat this package as an early bridge/runtime package, not as the final full Unity package target.

Implemented early bridge scope:

- Minimal `ICanonicalPathService` facade inside the Unity bridge, not a standalone large library project.
- `CanonicalPathValue` value wrapper for normalized bridge paths.
- Managed lexical `CanonicalPath` API covered by shared canonicalpath vectors.
- `PathGuard` for agent payload validation before any Unity write command.
- `ScopedPathGuard` for lexical Unity MCP scopes; this is not a filesystem security boundary.
- Unity asset path conversion for `Assets/...` and `Packages/...` only.
- Generated filename sanitization for bridge-created assets and modules.
- `UnityBridgeBuiltins` for status, project info, recent logs, validated text reads, and path validation.
- Guarded write dispatch for `assets.refresh`, `scene.save`, `asset.import`, and prefab/module command contracts.
- Shared Unity bridge vectors for payload paths and generated filenames.
- Shared Unity MCP scoped path vectors for TypeScript, Go, and local C# smoke gates.
- Local managed C# vector smoke via `pnpm unity:canonicalpath:vectors` when `dotnet` is available.
- Local C# vector smoke via `pnpm unity:bridge:vectors` when `dotnet` is available.
- Local managed C# allocation smoke via `pnpm unity:canonicalpath:alloc` when `dotnet` is available.
- Local managed daemon transport smoke via `pnpm unity:canonicalfs:transport:smoke` when `dotnet` and Go are available; daemon client calls expose `CancellationToken` overloads so Unity tools can bound editor-side waits.
- Local Burst-compatible unsafe buffer surface smoke via `pnpm unity:burst:surface` when `dotnet` is available.
- Optional Unity Burst compiler probe via `UNITY_BURST_PROBE=1 pnpm unity:burst:probe` when Unity Editor and `com.unity.burst` are available.
- Optional Unity Burst allocation probe via `UNITY_BURST_ALLOC_PROBE=1 pnpm unity:burst:alloc` when Unity Editor and `com.unity.burst` are available.
- Active Unity Burst allocation matrix via `pnpm unity:burst:alloc:matrix` for local `2022.3`, `6000.1`, `6000.2`, `6000.3`, and `6000.4` editors.
- Unity EditMode matrix via `pnpm unity:editmode:matrix` when Unity Editor is available through `UNITY_EDITOR`, `UNITY_EXE`, or the Unity Hub install path.

Facade:

```csharp
public interface ICanonicalPathService
{
    CanonicalPathValue Normalize(string input);
    CanonicalPathValue NormalizeProjectRoot(string input);
    CanonicalPathValue FromUnityAssetPath(CanonicalPathValue projectRoot, string unityPath);
    string ToUnityAssetPath(CanonicalPathValue projectRoot, CanonicalPathValue fullPath);
    void AssertInsideProject(CanonicalPathValue projectRoot, CanonicalPathValue candidate);
    string MakeSafeFileName(string input, int maxLength);
}
```

`PathGuard` must:

- Reject null / empty where invalid.
- Reject NUL.
- Normalize separators.
- Reject absolute paths from agent payloads.
- Allow only `Assets/...` and `Packages/...` Unity paths.
- Reject `../` traversal.
- Assert candidate paths stay inside the Unity project root.
- Sanitize generated filenames.

`UnityBridgeBuiltins` validates every write command with `PathGuard`. Inside the Unity Editor it can execute `assets.refresh`, `asset.import`, and `scene.save`; prefab/module creation remains a validated command contract until a bridge-specific implementation is added.

Full package scope:

- Broader Unity Editor UX wiring for managed `canonicalpath` and daemon transport.
- Broader Burst-compatible lexical helpers and real Burst compiler tests.
- Unity Editor UX wiring for managed daemon transport.

Security boundary:

- Unity code is client-side identity/transport code only.
- Early `PathGuard` is bridge payload validation, not a TOCTOU-proof filesystem security boundary.
- `ScopedPathGuard` is lexical scope validation only; it does not inspect symlinks, reparse points, races, or host filesystem behavior.
- Security-sensitive filesystem access must delegate to the Go daemon or a separately reviewed native root-bound implementation.
- Cancellation tokens only bound client waits; they do not change daemon-side root-bound authorization or filesystem semantics.

Allocation gate plan:

- Managed lanes use Unity EditMode tests to assert behavior and bounded GC allocations for hot lexical loops.
- Before Unity Editor lanes are available, `pnpm unity:canonicalpath:alloc` provides a local dotnet managed allocation smoke for the lexical API.
- `pnpm unity:burst:surface` verifies the current no-string unsafe buffer helper shape with zero managed allocations under dotnet.
- `UNITY_BURST_PROBE=1 pnpm unity:burst:probe` compiles and invokes a small Burst function pointer over that helper shape when Unity Editor and `com.unity.burst` are available.
- `UNITY_BURST_ALLOC_PROBE=1 pnpm unity:burst:alloc` compiles and invokes a Burst function pointer after warmup, then asserts zero managed allocations around the Burst workload.
- `pnpm unity:burst:alloc:matrix` runs active local Unity `2022.3`, `6000.1`, `6000.2`, `6000.3`, and `6000.4` Burst allocation lanes and skips missing editors.
- Individual versioned lanes are available as `pnpm unity:burst:alloc:2022.3`, `pnpm unity:burst:alloc:6000.1`, `pnpm unity:burst:alloc:6000.2`, `pnpm unity:burst:alloc:6000.3`, and `pnpm unity:burst:alloc:6000.4`.
- Keep every Unity lane tracked in `spec/language-targets.json`.
