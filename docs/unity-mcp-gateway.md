# Unity MCP Gateway Skeleton

This is the gateway implementation layer for Unity-first bridge work. It stabilizes the TypeScript gateway, MCP-facing tool contracts, and fake bridge backend before a real Unity Editor transport replaces the fake bridge.

## Scope

- Package export: `@romanilyin/canonicalpath/unity-gateway`.
- `CanonicalPathService`: CanonicalPath adapter for Unity project roots and `Assets/...` / `Packages/...` paths.
- `CanonicalPathBroker`: project registry that maps `project_id` to canonical project identity plus client/environment-specific path aliases for host roots.
- `FakeUnityBridge`: deterministic fake backend for tests and local gateway development without Unity Editor.
- `UnityMCPToolRegistry`: MCP-shaped tool descriptors and `callTool` dispatcher for read/status/log/path-validation tools.

Downstream Unity MCP gateways should depend on the public CanonicalPath packages for this contract once they are available, rather than carrying long-lived private forks or scattered path adapters.

## Exposed MCP Tool Names

- `unity.status`
- `unity.projectInfo`
- `unity.readLog`
- `unity.read`
- `unity.validatePath`
- `unity.knowledge.read`
- `unity.knowledge.write`
- `unity.knowledge.list`
- `unity.knowledge.glob`
- `unity.artifact.read`
- `unity.artifact.write`
- `unity.artifact.list`
- `unity.artifact.glob`
- `unity.assets.refresh`
- `unity.scene.save`
- `unity.asset.import`
- `unity.prefab.create`
- `unity.module.create`

Write tools are exposed only through guarded dispatch. Fake bridge write tools record/dry-run only. Unity-side `UnityBridgeBuiltins` validates every path with `PathGuard`; inside the Unity Editor it can execute `assets.refresh`, `asset.import`, and `scene.save`. Prefab/module commands are command contracts with validation only until a bridge-specific implementation is added.

The Unity package exposes matching `UnityBridgeBuiltins` methods for status, project info, recent logs, validated text reads, path validation, and guarded write dispatch.

Unity managed code is a validation and transport layer only. `PathGuard`, `ScopedPathGuard`, and `CanonicalFSDaemonHttpClient` do not create an independent filesystem security boundary; security-sensitive filesystem I/O must still go through the Go `CanonicalFS` daemon.

## Path Rules

`unity.validatePath`, `unity.read`, guarded write tools, and `CanonicalPathService.normalizeUnityAssetPath` reject:

- empty paths where invalid;
- NUL;
- absolute paths;
- Windows drive-relative paths;
- any `..` traversal component;
- payload paths outside `Assets/...` or `Packages/...`.

Generated filenames are sanitized with the Windows-safe component policy because Unity projects often move across Windows and non-Windows hosts.

Knowledge and artifact tools use `ScopedPathGuard` semantics rather than raw `Assets/...` payload paths. They enforce bounded `max_chars` / `max_entries` caps in the gateway layer and return artifact references as `{ scope: "artifact", path }`, never host absolute paths. The fake bridge admits at most 10,000 scoped entries and 8,388,608 UTF-16 code units for the complete composite keys plus contents, shared across all projects and scopes. Each value is also capped at 1,048,576 code units. Constructor seeds use the same validation and quotas as writes; overwrites subtract the previous value, and rejected updates leave the store unchanged. These are retained-data limits rather than an exact Node heap-byte budget. The fake bridge stores these files in memory only; a real bridge must delegate security-sensitive filesystem I/O to the Go daemon scoped endpoints.

## Path Aliases

Project identity and filesystem I/O roots are separate. `canonicalProjectPath` is the stable identity; `pathAliases` keep client-specific host roots for Unity Editor, Gateway, Go daemon, WSL, and other clients.

Aliases are keyed by project plus `clientType`, `clientId`, and `environmentId`, not by `clientType` alone. This allows two gateways or editor instances on the same host kind to resolve the same canonical project to different raw host paths without overwriting each other.

Project registration defaults an omitted `normalizeOptions.sourceHost` to explicit native `posix` grammar. It preserves literal backslashes and does not infer a Windows drive from native POSIX component data. Register a saved canonical Windows/UNC identity with `sourceHost: "canonical"`, or select `win32` explicitly for native Windows input.

Each native alias selects exactly one of `posix`, `win32`, or `wsl`. An explicit `hostKind` and an explicit `normalizeOptions.sourceHost` must match. Either one can supply the kind when the other is omitted. If both are omitted, a native project grammar is inherited; a canonical/URI project grammar instead defaults the alias to `posix`. Explicit alias options replace project options. Project options are inherited only when the alias uses the same native grammar, so choosing a different `hostKind` cannot accidentally inherit unrelated normalization settings.

Canonical and URI input modes describe identity/transport and are not native alias kinds. A project using either mode must supply native aliases explicitly instead of using the implicit `hostRoot` shortcut. WSL aliases require `wsl.enabled: true` and use the configured mount rules; use `posix` for an unmapped native WSL path. Alias normalization rejects `trimOuterWhitespace: true`, because trimming the compared identity while retaining the original native string could select a different path. Native absolute-path and dot-component checks use the chosen separator grammar; a literal POSIX backslash is not a separator.

Every alias `hostRoot` is normalized with these effective `normalizeOptions` and must resolve back to the registered `canonicalProjectPath`. The stored `hostKind` and returned normalization metadata describe that same grammar. Input options are copied, and project/alias lookup APIs return detached snapshots; mutating an input or returned object does not update the registry. These lexical checks do not replace the daemon's real filesystem root registration.

This changes registrations that relied on omitted cross-host parsing, contradictory metadata, or live mutable registry objects. Supply explicit identity and native alias grammars when updating those callers. For example, a Windows Unity Editor alias can use `C:\Work\Game` while a WSL gateway alias for the same project uses `/mnt/c/Work/Game`; both map to `c:/Work/Game` identity, but daemon or editor I/O uses the selected alias host root.

## Example

```ts
import { CanonicalPathBroker, FakeUnityBridge, createUnityMCPTools } from "@romanilyin/canonicalpath/unity-gateway";

const broker = new CanonicalPathBroker();
broker.registerProject({
  projectId: "project-1",
  projectRoot: "/home/alice/Game",
  normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
  hostRoot: "/home/alice/Game",
});

const bridge = new FakeUnityBridge(broker, { projectName: "Game", unityVersion: "6000.4" });
const tools = createUnityMCPTools(bridge);

const validation = await tools.callTool("unity.validatePath", {
  project_id: "project-1",
  unity_path: "Assets/Scripts/App.cs",
});

const read = await tools.callTool("unity.read", {
  project_id: "project-1",
  unity_path: "Assets/Scripts/App.cs",
  max_chars: 4096,
});

const importDryRun = await tools.callTool("unity.asset.import", {
  project_id: "project-1",
  unity_path: "Assets/Scripts/App.cs",
  dry_run: true,
});

console.log(validation.structuredContent);
console.log(read.structuredContent);
console.log(importDryRun.structuredContent);
```

## Next Step

Replace `FakeUnityBridge` with a real Unity bridge adapter that calls `UnityBridgeBuiltins`. Keep prefab/module creation implementation separate from the generic dispatcher and keep all writes behind `PathGuard`.

`UnityBridgeBuiltins.ReadText` and `ReadTextAsync` require a `CanonicalFSDaemonHttpClient` passed to the constructor after the optional path service. The trusted host registers the project with the daemon first. Reads use `unity_asset` scoped I/O, reject ADS syntax, and fail closed without a daemon. `maxChars` is capped at 1,048,576; the daemon reads at most 4 MiB before decoding and rejects larger files. The HTTP client also caps encoded response bytes at 24 MiB. Lexical canonical paths remain response metadata.
