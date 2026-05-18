import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorCode } from "../src/canonicalpath";
import type { CanonicalPath } from "../src/canonicalpath";
import { CanonicalPathBroker, CanonicalPathService, FakeUnityBridge, createUnityMCPTools, fakeUnityFileKey, fakeUnityScopedFileKey, unityMCPToolNames } from "../src/unity-gateway";
import type { UnityMcpPathScope } from "../src/unity-gateway";

interface UnityBridgeVectorFile {
  cases: UnityBridgeVectorCase[];
}

interface UnityBridgeVectorCase {
  id: string;
  operation: "normalize-unity-path" | "from-unity-asset-path" | "to-unity-asset-path" | "make-safe-file-name";
  raw?: string;
  root?: string;
  target?: string;
  maxLength?: number;
  expected?: string;
  error?: string;
}

interface UnityMcpPathScopeVectorFile {
  cases: UnityMcpPathScopeVectorCase[];
}

interface UnityMcpPathScopeVectorCase {
  id: string;
  scope: UnityMcpPathScope;
  raw: string;
  expectedProjectRelative?: string;
  expectedCacheRelative?: string;
  error?: string;
}

const unityBridgeVectors = JSON.parse(readFileSync(new URL("../../../spec/testdata/unity_bridge_vectors.json", import.meta.url), "utf8")) as UnityBridgeVectorFile;
const unityMcpPathScopeVectors = JSON.parse(readFileSync(new URL("../../../spec/testdata/unity_mcp_path_scope_vectors.json", import.meta.url), "utf8")) as UnityMcpPathScopeVectorFile;

describe("Unity gateway path service", () => {
  it("matches shared Unity bridge vectors", () => {
    const paths = new CanonicalPathService();

    for (const testCase of unityBridgeVectors.cases) {
      if (testCase.error) {
        try {
          runUnityBridgeVector(paths, testCase);
        } catch (error) {
          expect(errorCode(error), testCase.id).toBe(testCase.error);
          continue;
        }
        throw new Error(`${testCase.id}: expected ${testCase.error}`);
      }

      expect(runUnityBridgeVector(paths, testCase), testCase.id).toBe(testCase.expected);
    }
  });

  it("converts Unity asset paths through canonical project roots", () => {
    const paths = new CanonicalPathService();
    const root = paths.normalizeProjectRoot("C:\\Work\\Game", { sourceHost: "win32", targetProfile: "win32-drive" });

    expect(paths.fromUnityAssetPath(root, "Assets\\Scripts/Player.cs")).toBe("c:/Work/Game/Assets/Scripts/Player.cs");
    expect(paths.toUnityAssetPath(root, "c:/Work/Game/Packages/com.example/package.json" as CanonicalPath)).toBe("Packages/com.example/package.json");
  });

  it("matches shared Unity MCP scoped path vectors", () => {
    const paths = new CanonicalPathService();

    for (const testCase of unityMcpPathScopeVectors.cases) {
      if (testCase.error) {
        expectRejectCode(() => paths.normalizeScopedPath(testCase.scope, testCase.raw), testCase.error);
        continue;
      }

      const actual = paths.normalizeScopedPath(testCase.scope, testCase.raw);
      if (testCase.expectedProjectRelative !== undefined) {
        expect(actual, testCase.id).toEqual({ scope: testCase.scope, kind: "project", path: testCase.expectedProjectRelative });
        expect(paths.toScopedCanonicalPath("/repo/Game" as CanonicalPath, testCase.scope, testCase.raw), testCase.id).toBe(`/repo/Game/${testCase.expectedProjectRelative}`);
      } else {
        expect(actual, testCase.id).toEqual({ scope: testCase.scope, kind: "cache", path: testCase.expectedCacheRelative });
        expectRejectCode(() => paths.toScopedCanonicalPath("/repo/Game" as CanonicalPath, testCase.scope, testCase.raw), "ERR_INVALID_PATH");
      }
    }
  });

  it("validates bounded scoped glob patterns", () => {
    const paths = new CanonicalPathService();

    expect(paths.normalizeScopedGlobPattern("knowledge", "notes/**/*.md")).toBe("notes/**/*.md");
    expect(paths.normalizeScopedGlobPattern("artifact", "job-artifacts/run-1/*.json")).toBe("job-artifacts/run-1/*.json");
    expect(paths.normalizeScopedGlobPattern("artifact", "screenshots/request-?.png")).toBe("screenshots/request-?.png");

    expectRejectCode(() => paths.normalizeScopedGlobPattern("knowledge", "Assets/**/*.md"), "ERR_OUTSIDE_ROOT");
    expectRejectCode(() => paths.normalizeScopedGlobPattern("artifact", "job-artifacts-evil/*.json"), "ERR_OUTSIDE_ROOT");
    expectRejectCode(() => paths.normalizeScopedGlobPattern("knowledge", "notes/../*.md"), "ERR_OUTSIDE_ROOT");
    expectRejectCode(() => paths.normalizeScopedGlobPattern("knowledge", "notes/readme.md"), "ERR_INVALID_PATH");
  });

  it("rejects Unity payload paths before write commands exist", () => {
    const paths = new CanonicalPathService();

    expectRejectCode(() => paths.normalizeUnityAssetPath("../Assets/Escape.cs"), "ERR_OUTSIDE_ROOT");
    expectRejectCode(() => paths.normalizeUnityAssetPath("/tmp/Escape.cs"), "ERR_ABSOLUTE_PATH");
    expectRejectCode(() => paths.normalizeUnityAssetPath("ProjectSettings/TagManager.asset"), "ERR_INVALID_PATH");
    expectRejectCode(() => paths.normalizeUnityAssetPath("Assets/Bad\0Name.cs"), "ERR_NUL_BYTE");
    expectRejectCode(() => paths.makeSafeFileName("file.txt", 0), "ERR_INVALID_COMPONENT");
  });
});

describe("CanonicalPathBroker", () => {
  it("registers projects and dry-runs Unity path validation", () => {
    const broker = new CanonicalPathBroker();
    const project = broker.registerProject({
      projectId: "project-1",
      projectRoot: "/home/alice/Game",
      normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
      hostRoot: "/home/alice/Game",
    });

    expect(project.canonicalProjectPath).toBe("/home/alice/Game");
    expect(broker.fromUnityAssetPath("project-1", "Assets/Scenes/Main.unity")).toBe("/home/alice/Game/Assets/Scenes/Main.unity");
    expect(broker.validateUnityAssetPath("project-1", "Packages/com.example/package.json", { generatedFileName: "CON.txt" })).toMatchObject({
      ok: true,
      projectId: "project-1",
      unityPath: "Packages/com.example/package.json",
      canonicalPath: "/home/alice/Game/Packages/com.example/package.json",
      safeFileName: "CON-.txt",
    });
  });

  it("keeps Windows Unity Editor and WSL gateway aliases separate", () => {
    const broker = new CanonicalPathBroker();
    const project = broker.registerProject({
      projectId: "game-win-wsl",
      projectRoot: "C:\\Work\\Game",
      normalizeOptions: { sourceHost: "win32", targetProfile: "win32-drive" },
      aliases: [
        {
          clientType: "unity-editor",
          clientId: "unity-6000",
          environmentId: "windows-editor",
          hostKind: "win32",
          hostRoot: "C:\\Work\\Game",
          normalizeOptions: { sourceHost: "win32", targetProfile: "win32-drive" },
        },
        {
          clientType: "gateway",
          clientId: "gateway-wsl",
          environmentId: "ubuntu-24.04",
          hostKind: "wsl",
          hostRoot: "/mnt/c/Work/Game",
          normalizeOptions: { sourceHost: "wsl", targetProfile: "win32-drive", wsl: { enabled: true, mountRoot: "/mnt" } },
        },
      ],
    });

    expect(project.canonicalProjectPath).toBe("c:/Work/Game");
    expect(broker.resolveHostRoot("game-win-wsl", { clientType: "unity-editor", clientId: "unity-6000", environmentId: "windows-editor" })).toBe("C:\\Work\\Game");
    expect(broker.resolveHostRoot("game-win-wsl", { clientType: "gateway", clientId: "gateway-wsl", environmentId: "ubuntu-24.04" })).toBe("/mnt/c/Work/Game");
  });

  it("keys aliases by project, client id, and environment instead of client type only", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({
      projectId: "game-windows",
      projectRoot: "C:\\Work\\Game",
      normalizeOptions: { sourceHost: "win32", targetProfile: "win32-drive" },
      aliases: [
        {
          clientType: "gateway",
          clientId: "gateway-a",
          environmentId: "windows-terminal",
          hostKind: "win32",
          hostRoot: "C:\\Work\\Game",
          normalizeOptions: { sourceHost: "win32", targetProfile: "win32-drive" },
        },
        {
          clientType: "gateway",
          clientId: "gateway-b",
          environmentId: "windows-service",
          hostKind: "win32",
          hostRoot: "C:\\Work\\Game",
          normalizeOptions: { sourceHost: "win32", targetProfile: "win32-drive" },
        },
      ],
    });

    expect(broker.listPathAliases("game-windows")).toHaveLength(2);
    expect(() => broker.getPathAlias("game-windows", { clientType: "gateway" })).toThrow("ambiguous path alias");
    expect(broker.getPathAlias("game-windows", { clientType: "gateway", clientId: "gateway-b", environmentId: "windows-service" }).clientId).toBe("gateway-b");
  });

  it("supports POSIX/macOS aliases and rejects identity mismatches", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({
      projectId: "game-macos",
      projectRoot: "/Users/alice/Game",
      normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
      aliases: [
        {
          clientType: "unity-editor",
          clientId: "unity-macos",
          environmentId: "macos-editor",
          hostKind: "posix",
          hostRoot: "/Users/alice/Game",
          normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
        },
        {
          clientType: "go-daemon",
          clientId: "daemon-local",
          environmentId: "macos-shell",
          hostKind: "posix",
          hostRoot: "/Users/alice/Game",
          normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
        },
      ],
    });

    expect(broker.resolveHostRoot("game-macos", { clientType: "go-daemon", clientId: "daemon-local", environmentId: "macos-shell" })).toBe("/Users/alice/Game");
    expect(() =>
      broker.registerPathAlias("game-macos", {
        clientType: "gateway",
        clientId: "bad",
        environmentId: "macos-shell",
        hostKind: "posix",
        hostRoot: "/Users/alice/Game-Evil",
        normalizeOptions: { sourceHost: "posix", targetProfile: "posix" },
      }),
    ).toThrow("hostRoot does not match canonical project identity");
  });
});

describe("Unity MCP fake bridge tools", () => {
  it("exposes read/status/log/validation/write tools through PathGuard", async () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "project-1", projectRoot: "/repo/Game", normalizeOptions: { sourceHost: "posix", targetProfile: "posix" } });
    const bridge = new FakeUnityBridge(broker, {
      projectName: "Game",
      unityVersion: "6000.0",
      files: { [fakeUnityFileKey("project-1", "Assets/Scripts/App.cs")]: "class App {}" },
      scopedFiles: {
        [fakeUnityScopedFileKey("project-1", "knowledge", "agent.md")]: "knowledge notes",
        [fakeUnityScopedFileKey("project-1", "knowledge", "notes/todo.md")]: "todo",
        [fakeUnityScopedFileKey("project-1", "artifact", "job-artifacts/run-1/summary.json")]: "{\"ok\":true}",
        [fakeUnityScopedFileKey("project-1", "artifact", "screenshots/request-1.png")]: "png-data",
      },
    });
    bridge.appendLog("info", "fake bridge ready", "2026-05-12T00:00:00.000Z");

    const tools = createUnityMCPTools(bridge);
    expect(tools.listTools().map((tool) => tool.name)).toEqual([...unityMCPToolNames]);
    expect(tools.listTools().some((tool) => tool.name === "asset.import" || tool.name === "scene.save")).toBe(false);

    const status = await tools.callTool("unity.status", { project_id: "project-1" });
    expect(status.structuredContent).toMatchObject({ state: "ready", projectId: "project-1", projectName: "Game" });

    const projectInfo = await tools.callTool("unity.projectInfo", { project_id: "project-1" });
    expect(projectInfo.structuredContent).toMatchObject({ projectId: "project-1", canonicalProjectPath: "/repo/Game", unityVersion: "6000.0" });

    const log = await tools.callTool("unity.readLog", { project_id: "project-1", max_entries: 1 });
    expect(log.structuredContent).toEqual([{ level: "info", message: "fake bridge ready", timestamp: "2026-05-12T00:00:00.000Z" }]);

    const read = await tools.callTool("unity.read", { project_id: "project-1", unity_path: "Assets/Scripts/App.cs", max_chars: 5 });
    expect(read.structuredContent).toMatchObject({ unityPath: "Assets/Scripts/App.cs", text: "class", truncated: true });

    const validation = await tools.callTool("unity.validatePath", { project_id: "project-1", unity_path: "Assets/Scripts/App.cs" });
    expect(validation.structuredContent).toMatchObject({ ok: true, canonicalPath: "/repo/Game/Assets/Scripts/App.cs" });

    const knowledgeRead = await tools.callTool("unity.knowledge.read", { project_id: "project-1", path: "agent.md", max_chars: 9 });
    expect(knowledgeRead.structuredContent).toMatchObject({ scope: "knowledge", path: "agent.md", projectRelativePath: "Assets/UnityMcpKnowledge/agent.md", text: "knowledge", truncated: true });

    const knowledgeWrite = await tools.callTool("unity.knowledge.write", { project_id: "project-1", path: "notes/new.md", text: "new note", max_chars: 16 });
    expect(knowledgeWrite.structuredContent).toMatchObject({ ok: true, scope: "knowledge", path: "notes/new.md", chars: 8 });

    const knowledgeList = await tools.callTool("unity.knowledge.list", { project_id: "project-1", path_prefix: "notes", max_entries: 2 });
    expect(knowledgeList.structuredContent).toMatchObject({ scope: "knowledge", pathPrefix: "notes", truncated: false });
    expect((knowledgeList.structuredContent as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path)).toEqual(["notes/new.md", "notes/todo.md"]);

    const knowledgeGlob = await tools.callTool("unity.knowledge.glob", { project_id: "project-1", glob: "notes/*.md", max_entries: 1 });
    expect(knowledgeGlob.structuredContent).toMatchObject({ scope: "knowledge", glob: "notes/*.md", truncated: true });
    expect((knowledgeGlob.structuredContent as { entries: Array<{ path: string }> }).entries).toHaveLength(1);

    const artifactRead = await tools.callTool("unity.artifact.read", { project_id: "project-1", path: "job-artifacts/run-1/summary.json", max_chars: 64 });
    expect(artifactRead.structuredContent).toMatchObject({
      scope: "artifact",
      path: "job-artifacts/run-1/summary.json",
      projectRelativePath: "Library/SGGUnityMcp/job-artifacts/run-1/summary.json",
      artifactRef: { scope: "artifact", path: "job-artifacts/run-1/summary.json" },
    });

    const artifactWrite = await tools.callTool("unity.artifact.write", { project_id: "project-1", path: "screenshots/request-2.png", text: "png2", max_chars: 16 });
    expect(artifactWrite.structuredContent).toMatchObject({ ok: true, artifactRef: { scope: "artifact", path: "screenshots/request-2.png" }, chars: 4 });

    const artifactGlob = await tools.callTool("unity.artifact.glob", { project_id: "project-1", glob: "screenshots/request-?.png", max_entries: 10 });
    expect((artifactGlob.structuredContent as { entries: Array<{ artifactRef?: { path: string }; projectRelativePath: string }> }).entries).toEqual([
      { scope: "artifact", path: "screenshots/request-1.png", projectRelativePath: "Library/SGGUnityMcp/screenshots/request-1.png", kind: "file", chars: 8, artifactRef: { scope: "artifact", path: "screenshots/request-1.png" } },
      { scope: "artifact", path: "screenshots/request-2.png", projectRelativePath: "Library/SGGUnityMcp/screenshots/request-2.png", kind: "file", chars: 4, artifactRef: { scope: "artifact", path: "screenshots/request-2.png" } },
    ]);

    const oversizedWrite = await tools.callTool("unity.knowledge.write", { project_id: "project-1", path: "too-large.md", text: "too large", max_chars: 3 });
    expect(oversizedWrite.isError).toBe(true);
    expect(oversizedWrite.structuredContent).toMatchObject({ error: "ERR_INVALID_PATH" });

    const artifactRejected = await tools.callTool("unity.artifact.read", { project_id: "project-1", path: "Library/SGGUnityMcp/job-artifacts/run-1/summary.json" });
    expect(artifactRejected.isError).toBe(true);
    expect(artifactRejected.structuredContent).toMatchObject({ error: "ERR_OUTSIDE_ROOT" });

    const write = await tools.callTool("unity.asset.import", { project_id: "project-1", unity_path: "Assets/Scripts/App.cs", dry_run: false });
    expect(write.structuredContent).toMatchObject({ ok: true, command: "asset.import", performed: false, detail: "fake bridge recorded command only" });

    const refresh = await tools.callTool("unity.assets.refresh", { project_id: "project-1" });
    expect(refresh.structuredContent).toMatchObject({ ok: true, command: "assets.refresh", dryRun: true, detail: "fake bridge dry-run only" });

    const generated = await tools.callTool("unity.prefab.create", {
      project_id: "project-1",
      unity_path: "Assets/Prefabs/Player.prefab",
      generated_file_name: "AUX",
    });
    expect(generated.structuredContent).toMatchObject({ ok: true, command: "prefab.create", unityPath: "Assets/Prefabs/Player.prefab", safeFileName: "AUX-" });

    const writeRejected = await tools.callTool("unity.scene.save", { project_id: "project-1", unity_path: "../ProjectSettings/Tags.asset" });
    expect(writeRejected.isError).toBe(true);
    expect(writeRejected.structuredContent).toMatchObject({ error: "ERR_OUTSIDE_ROOT" });

    const siblingRejected = await tools.callTool("unity.module.create", { project_id: "project-1", unity_path: "AssetsEvil/Module.cs" });
    expect(siblingRejected.isError).toBe(true);
    expect(siblingRejected.structuredContent).toMatchObject({ error: "ERR_INVALID_PATH" });

    const rejected = await tools.callTool("unity.validatePath", { project_id: "project-1", unity_path: "Assets/../ProjectSettings/Tags.asset" });
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent).toMatchObject({ error: "ERR_OUTSIDE_ROOT" });
  });
});

function expectRejectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(errorCode(error)).toBe(code);
    return;
  }
  throw new Error(`expected rejection ${code}`);
}

function runUnityBridgeVector(paths: CanonicalPathService, testCase: UnityBridgeVectorCase): string {
  switch (testCase.operation) {
    case "normalize-unity-path":
      return paths.normalizeUnityAssetPath(required(testCase.raw, testCase, "raw"));
    case "from-unity-asset-path":
      return paths.fromUnityAssetPath(required(testCase.root, testCase, "root") as CanonicalPath, required(testCase.raw, testCase, "raw"));
    case "to-unity-asset-path":
      return paths.toUnityAssetPath(required(testCase.root, testCase, "root") as CanonicalPath, required(testCase.target, testCase, "target") as CanonicalPath);
    case "make-safe-file-name":
      return paths.makeSafeFileName(required(testCase.raw, testCase, "raw"), testCase.maxLength ?? 128);
    default:
      throw new Error(`${testCase.id}: unsupported Unity bridge operation`);
  }
}

function required(value: string | undefined, testCase: UnityBridgeVectorCase, field: string): string {
  if (value === undefined) throw new Error(`${testCase.id}: ${field} is required`);
  return value;
}
