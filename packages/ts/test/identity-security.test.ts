import { describe, expect, it } from "vitest";
import { encodeGitRef, normalize } from "../src/canonicalpath/index.js";
import { CanonicalPathBroker, CanonicalPathService } from "../src/unity-gateway/index.js";

const normalizeOptions = { sourceHost: "wsl" as const, wsl: { enabled: true, mountRoot: "/mnt" } };
const alias = (hostRoot: string) => ({ clientType: "gateway", clientId: "wsl", environmentId: "test", hostRoot, normalizeOptions });

describe("WSL identity and native aliases", () => {
  it("resolves parent segments before choosing the drive", () => {
    expect(normalize("/mnt/c/../d/repo", normalizeOptions)).toBe("d:/repo");
    expect(normalize("/mnt/c/d/repo", normalizeOptions)).toBe("c:/d/repo");
    expect(normalize("/mnt/c/../../repo", normalizeOptions)).toBe("/repo");
  });

  for (const hostRoot of ["/mnt/c/../d/repo", "/mnt/d/./repo", "/mnt/d/src/../repo"]) {
    it(`rejects dot segments through every registration path: ${hostRoot}`, () => {
      const broker = new CanonicalPathBroker();
      expect(() => broker.registerProject({ projectId: "p", projectRoot: "d:/repo", hostRoot, normalizeOptions })).toThrow("without dot segments");
      expect(broker.listProjects()).toHaveLength(0);
      expect(() => broker.registerProject({ projectId: "p", projectRoot: "d:/repo", aliases: [alias(hostRoot)] })).toThrow("without dot segments");
      expect(broker.listProjects()).toHaveLength(0);
      broker.registerProject({ projectId: "p", projectRoot: "d:/repo" });
      expect(() => broker.registerPathAlias("p", alias(hostRoot))).toThrow("without dot segments");
      expect(broker.listPathAliases("p")).toHaveLength(0);
      expect(broker.resolveHostRoot("p")).toBeUndefined();
    });
  }

  it("rejects the old colliding identity and preserves verified native roots", () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "old", projectRoot: "c:/d/repo" });
    expect(() => broker.registerPathAlias("old", alias("/mnt/d/repo"))).toThrow("does not match");
    broker.registerProject({ projectId: "p", projectRoot: "d:/repo", hostRoot: "/mnt/d/repo", normalizeOptions });
    broker.registerPathAlias("p", { ...alias("D:\\repo"), clientId: "win", normalizeOptions: { sourceHost: "win32" } });
    expect(broker.resolveHostRoot("p")).toBe("/mnt/d/repo");
    expect(broker.resolveHostRoot("p", { clientId: "win" })).toBe("D:\\repo");
  });

  it("requires absolute project roots and native host paths", () => {
    const paths = new CanonicalPathService();
    for (const root of ["repo", "repo/sub", "."]) expect(() => paths.normalizeProjectRoot(root)).toThrow("must be absolute");
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId: "p", projectRoot: "/repo" });
    for (const hostRoot of ["repo", "file:///repo"]) expect(() => broker.registerPathAlias("p", alias(hostRoot))).toThrow("absolute native path");
  });
});

describe("GitRef directory identity v2", () => {
  it("bounds the slug while hashing the complete raw input", () => {
    const prefix = "a".repeat(240);
    const first = encodeGitRef(prefix + "/one");
    const second = encodeGitRef(prefix + "/two");
    expect(first).toHaveLength(149);
    expect(first).toMatch(/^v2-a{80}--[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it("preserves raw Unicode and whitespace identity", () => {
    expect(encodeGitRef("café")).not.toBe(encodeGitRef("cafe\u0301"));
    expect(encodeGitRef("feature/auth")).not.toBe(encodeGitRef(" feature/auth "));
    expect(encodeGitRef("feature/auth")).not.toBe(encodeGitRef("feature-auth"));
    expect(encodeGitRef("CON.txt")).toMatch(/^v2-CON\.txt--[0-9a-f]{64}$/);
  });
});
