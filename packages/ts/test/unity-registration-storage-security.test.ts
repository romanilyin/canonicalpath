import { describe, expect, it } from "vitest";
import { normalize, type NormalizeOptions } from "../src/canonicalpath/index.js";
import { CanonicalPathBroker, FakeUnityBridge, createUnityMCPTools, fakeUnityScopedFileKey } from "../src/unity-gateway/index.js";

const alias = (hostRoot: string) => ({ clientType: "gateway", clientId: "local", environmentId: "test", hostRoot });

describe("native alias grammar binding", () => {
  it("uses POSIX grammar for omitted project and alias options", () => {
    const broker = new CanonicalPathBroker();
    const project = broker.registerProject({ projectId: "p", projectRoot: "/repo/a\\b", hostRoot: "/repo/a\\b" });
    expect(project.canonicalProjectPath).toBe("/repo/a\\b");
    const entry = broker.getPathAlias("p", {});
    expect(entry.hostKind).toBe("posix");
    expect(entry.normalizeOptions?.sourceHost).toBe("posix");
    expect(normalize(entry.hostRoot, entry.normalizeOptions)).toBe(project.canonicalProjectPath);
    expect(broker.resolveHostRoot("p")).toBe("/repo/a\\b");
  });

  it("does not bind a slash identity to a distinct literal-backslash native root", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "/repo/a/b" });
    for (const options of [{}, { hostKind: "posix" as const }, { normalizeOptions: { sourceHost: "posix" as const } }]) {
      expect(() => broker.registerPathAlias("p", { ...alias("/repo/a\\b"), ...options })).toThrow("does not match");
    }
    expect(broker.listPathAliases("p")).toEqual([]);
    expect(broker.resolveHostRoot("p")).toBeUndefined();
  });

  it("requires explicit grammar for non-POSIX project identity", () => {
    const broker = new CanonicalPathBroker();
    expect(() => broker.registerProject({ projectId: "p", projectRoot: "C:/repo" })).toThrow();
    expect(broker.listProjects()).toHaveLength(0);
    broker.registerProject({ projectId: "p", projectRoot: "c:/repo", normalizeOptions: { sourceHost: "canonical" } });
    expect(broker.getProject("p").canonicalProjectPath).toBe("c:/repo");
  });

  it("derives a native grammar from hostKind alone or sourceHost alone", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "c:/repo", normalizeOptions: { sourceHost: "canonical" } });
    const byKind = broker.registerPathAlias("p", { ...alias("C:\\repo"), hostKind: "win32" });
    const bySource = broker.registerPathAlias("p", { ...alias("C:\\repo"), clientId: "source", normalizeOptions: { sourceHost: "win32" } });
    for (const entry of [byKind, bySource]) {
      expect(entry.hostKind).toBe("win32");
      expect(entry.normalizeOptions?.sourceHost).toBe("win32");
      expect(normalize(entry.hostRoot, entry.normalizeOptions)).toBe("c:/repo");
    }
  });

  it("rejects contradictory native kind and source grammar before retaining an alias", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "/repo" });
    for (const [hostKind, sourceHost] of [["posix", "win32"], ["win32", "posix"], ["posix", "wsl"], ["wsl", "posix"]] as const) {
      expect(() => broker.registerPathAlias("p", { ...alias("/repo"), hostKind, normalizeOptions: { sourceHost } })).toThrow("hostKind");
    }
    expect(broker.listPathAliases("p")).toEqual([]);
  });

  it("does not inherit canonical or URI transport grammar for a native alias", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "/repo", normalizeOptions: { sourceHost: "canonical" } });
    expect(broker.registerPathAlias("p", alias("/repo")).normalizeOptions?.sourceHost).toBe("posix");
    for (const sourceHost of ["canonical", "vscode-file-uri", "dev-container", "ssh-remote"] as const) {
      expect(() => broker.registerPathAlias("p", { ...alias("/repo"), clientId: sourceHost, normalizeOptions: { sourceHost } })).toThrow("native");
    }
  });

  it("checks native separators without treating POSIX backslashes as dot separators", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "/repo/a\\..\\b" });
    expect(broker.registerPathAlias("p", alias("/repo/a\\..\\b")).hostRoot).toBe("/repo/a\\..\\b");
    for (const hostRoot of ["C:\\repo", "\\\\server\\share", "//repo/share"]) {
      expect(() => broker.registerPathAlias("p", { ...alias(hostRoot), clientId: hostRoot, hostKind: "posix" })).toThrow("absolute native");
    }
    expect(() => broker.registerPathAlias("p", { ...alias("/repo"), hostKind: "win32" })).toThrow("absolute native");
  });

  it("rejects trimming that would change a retained native root", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "/repo" });
    expect(() => broker.registerPathAlias("p", { ...alias("/repo "), normalizeOptions: { sourceHost: "posix", trimOuterWhitespace: true } })).toThrow("trim");
    expect(broker.listPathAliases("p")).toEqual([]);
  });

  it("preserves explicitly configured WSL aliases across project grammars", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "c:/repo", normalizeOptions: { sourceHost: "canonical" } });
    const entry = broker.registerPathAlias("p", { ...alias("/drives/c/repo"), hostKind: "wsl", normalizeOptions: { wsl: { enabled: true, mountRoot: "/drives" } } });
    expect(entry.normalizeOptions?.sourceHost).toBe("wsl");
    expect(normalize(entry.hostRoot, entry.normalizeOptions)).toBe("c:/repo");
    expect(broker.resolveHostRoot("p")).toBe("/drives/c/repo");
    expect(() => broker.registerPathAlias("p", { ...alias("/mnt/c/repo"), clientId: "unconfigured", hostKind: "wsl" })).toThrow("WSL");
  });

  it("detaches input options, aliases, and returned records from registry authority", () => {
    const broker = new CanonicalPathBroker();
    const options: NormalizeOptions = { sourceHost: "wsl", wsl: { enabled: true, mountRoot: "/drives" } };
    const project = broker.registerProject({ projectId: "p", projectRoot: "c:/repo", normalizeOptions: { sourceHost: "canonical" } });
    const entry = broker.registerPathAlias("p", { ...alias("/drives/c/repo"), hostKind: "wsl", normalizeOptions: options });
    options.wsl!.mountRoot = "/attacker";
    entry.hostRoot = "/attacker";
    entry.normalizeOptions!.wsl!.mountRoot = "/attacker";
    project.hostRoot = "/attacker";
    project.pathAliases.push({ ...entry });
    const listed = broker.listProjects()[0]!;
    listed.canonicalProjectPath = normalize("/attacker", { sourceHost: "posix" });
    listed.pathAliases[0]!.hostRoot = "/attacker";
    const fetched = broker.getPathAlias("p", {});
    expect(fetched.hostRoot).toBe("/drives/c/repo");
    expect(fetched.normalizeOptions?.wsl?.mountRoot).toBe("/drives");
    expect(broker.resolveHostRoot("p")).toBe("/drives/c/repo");
    expect(broker.getProject("p").canonicalProjectPath).toBe("c:/repo");
  });
});

function scopedBroker(projectId = "p"): CanonicalPathBroker {
  const broker = new CanonicalPathBroker();
  broker.registerProject({ projectId, projectRoot: "/repo" });
  return broker;
}

describe("aggregate fake scoped storage limits", () => {
  it("rejects the first over-budget MCP write and retains original data", async () => {
    const bridge = new FakeUnityBridge(scopedBroker());
    const tools = createUnityMCPTools(bridge);
    const text = "x".repeat(1_048_576);
    for (let index = 0; index < 7; index++) {
      expect((await tools.callTool("unity.knowledge.write", { project_id: "p", path: "entry" + index + ".md", text, max_chars: text.length })).isError).not.toBe(true);
    }
    const result = await tools.callTool("unity.artifact.write", { project_id: "p", path: "job-artifacts/full.txt", text, max_chars: text.length });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "ERR_INVALID_PATH", message: expect.stringContaining("storage") });
    expect((await bridge.readScopedText("p", "artifact", "job-artifacts/full.txt")).text).toBe("");
    expect((await bridge.readScopedText("p", "knowledge", "entry0.md", text.length)).text).toBe(text);
    expect((await bridge.listScoped("p", "knowledge", undefined, 1000)).entries).toHaveLength(7);
  });

  it("counts keys and subtracts replaced values before an atomic quota decision", async () => {
    const key = (i: number) => fakeUnityScopedFileKey("p", "knowledge", "entry" + i + ".md");
    const text = "x".repeat(1_048_576);
    const seeds = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [key(i), text]));
    const lastKey = key(7);
    const occupied = Object.entries(seeds).reduce((sum, [entryKey, value]) => sum + entryKey.length + value.length, 0);
    const remaining = 8_388_608 - occupied - lastKey.length;
    seeds[lastKey] = "z".repeat(remaining);
    const bridge = new FakeUnityBridge(scopedBroker(), { scopedFiles: seeds });
    await expect(bridge.writeScopedText("p", "knowledge", "entry7.md", seeds[lastKey]! + "x")).rejects.toThrow("storage");
    expect((await bridge.readScopedText("p", "knowledge", "entry7.md", 1_048_576)).text).toBe(seeds[lastKey]);
    await expect(bridge.writeScopedText("p", "knowledge", "new-empty-key.md", "")).rejects.toThrow("storage");
    await bridge.writeScopedText("p", "knowledge", "entry0.md", "");
    await bridge.writeScopedText("p", "knowledge", "entry7.md", seeds[lastKey]! + "x");
    await bridge.writeScopedText("p", "knowledge", "new-empty-key.md", "");
    expect((await bridge.listScoped("p", "knowledge", undefined, 1000)).entries).toHaveLength(9);
  });

  it("caps distinct entries during writes, with replacement allowed at capacity", async () => {
    const seeds = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [fakeUnityScopedFileKey("p", "knowledge", "item" + i + ".md"), ""]));
    const bridge = new FakeUnityBridge(scopedBroker(), { scopedFiles: seeds });
    await expect(bridge.writeScopedText("p", "knowledge", "overflow.md", "")).rejects.toThrow("entry");
    await bridge.writeScopedText("p", "knowledge", "item0.md", "updated");
    expect((await bridge.readScopedText("p", "knowledge", "item0.md")).text).toBe("updated");
    expect((await bridge.readScopedText("p", "knowledge", "overflow.md")).text).toBe("");
    const list = await bridge.listScoped("p", "knowledge", undefined, 1000);
    expect(list.entries).toHaveLength(1000);
    expect(list.truncated).toBe(true);
  });

  it("applies quotas and normal input validation to constructor seeds", () => {
    const broker = scopedBroker();
    const overEntries = Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [fakeUnityScopedFileKey("p", "knowledge", "item" + i + ".md"), ""]));
    expect(() => new FakeUnityBridge(broker, { scopedFiles: overEntries })).toThrow("entry");
    const overTotal = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [fakeUnityScopedFileKey("p", "knowledge", "large" + i + ".md"), "x".repeat(1_048_576)]));
    expect(() => new FakeUnityBridge(broker, { scopedFiles: overTotal })).toThrow("storage");
    expect(() => new FakeUnityBridge(broker, { scopedFiles: { [fakeUnityScopedFileKey("p", "knowledge", "large.md")]: "x".repeat(1_048_577) } })).toThrow("write limit");
    for (const key of ["malformed", fakeUnityScopedFileKey("unknown", "knowledge", "file.md"), fakeUnityScopedFileKey("p", "knowledge", "../escape"), "p\0invalid\0file.md"]) {
      expect(() => new FakeUnityBridge(broker, { scopedFiles: { [key]: "text" } })).toThrow();
    }
  });

  it("shares capacity across projects/scopes and detaches the supplied seed state", async () => {
    const broker = scopedBroker();
    broker.registerProject({ projectId: "q", projectRoot: "/other" });
    const key = fakeUnityScopedFileKey("p", "knowledge", "original.md");
    const options = { scopedFiles: { [key]: "original" } };
    const bridge = new FakeUnityBridge(broker, options);
    options.scopedFiles[key] = "changed";
    expect((await bridge.readScopedText("p", "knowledge", "original.md")).text).toBe("original");
    const text = "x".repeat(1_048_576);
    for (let i = 0; i < 7; i++) await bridge.writeScopedText(i % 2 === 0 ? "p" : "q", i % 2 === 0 ? "knowledge" : "artifact", i % 2 === 0 ? "entry" + i + ".md" : "job-artifacts/entry" + i + ".md", text);
    await expect(bridge.writeScopedText("q", "artifact", "screenshots/full.png", text)).rejects.toThrow("storage");
  });
});
