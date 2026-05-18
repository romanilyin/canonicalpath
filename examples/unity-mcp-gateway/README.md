# Unity MCP Gateway Example

This example shows how to start gateway development before a real Unity Editor bridge exists.

```ts
import { CanonicalPathBroker, FakeUnityBridge, createUnityMCPTools } from "@romanilyin/canonicalpath/unity-gateway";

const broker = new CanonicalPathBroker();
broker.registerProject({
  projectId: "project-1",
  projectRoot: "/repo/Game",
  normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
});

const bridge = new FakeUnityBridge(broker, { projectName: "Game", unityVersion: "6000.4" });
bridge.appendLog("info", "fake bridge ready");

const tools = createUnityMCPTools(bridge);

await tools.callTool("unity.status", { project_id: "project-1" });
await tools.callTool("unity.validatePath", {
  project_id: "project-1",
  unity_path: "Assets/Scripts/App.cs",
});
await tools.callTool("unity.read", {
  project_id: "project-1",
  unity_path: "Assets/Scripts/App.cs",
  max_chars: 4096,
});
await tools.callTool("unity.asset.import", {
  project_id: "project-1",
  unity_path: "Assets/Scripts/App.cs",
  dry_run: true,
});
```

The fake bridge records write commands without mutating a project. The real Unity bridge must keep every write command behind `PathGuard`.
