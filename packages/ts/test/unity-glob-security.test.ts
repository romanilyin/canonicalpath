import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CanonicalPathBroker, FakeUnityBridge, createUnityMCPTools, fakeUnityScopedFileKey } from "../src/unity-gateway";

const projectId = "glob-security";

function bridgeWith(paths: string[], scope: "knowledge" | "artifact" = "knowledge"): FakeUnityBridge {
  const broker = new CanonicalPathBroker();
  broker.registerProject({ projectId, projectRoot: "/repo/Game", normalizeOptions: { sourceHost: "posix", targetProfile: "posix" } });
  return new FakeUnityBridge(broker, {
    scopedFiles: Object.fromEntries(paths.map((entry) => [fakeUnityScopedFileKey(projectId, scope, entry), "text"])),
  });
}

async function matches(bridge: FakeUnityBridge, glob: string): Promise<string[]> {
  return (await bridge.globScoped(projectId, "knowledge", glob, 1000)).entries.map((entry) => entry.path);
}

describe("bounded Unity scoped glob matching", () => {
  it("preserves slash, single-unit wildcard, literal metacharacter and numeric ordering semantics", async () => {
    const bridge = bridgeWith([
      "notes/item10.md", "notes/sub/item1.md", "notes/item2.md", "notes/item1.md",
      "notes/sub/deep/item1.md", "notes/item20.txt", "notes/a+b(1)[x]{y}^$.md",
    ]);
    expect(await matches(bridge, "notes/item*.md")).toEqual(["notes/item1.md", "notes/item2.md", "notes/item10.md"]);
    expect(await matches(bridge, "notes/item?.md")).toEqual(["notes/item1.md", "notes/item2.md"]);
    expect(await matches(bridge, "notes/**/item1.md")).toEqual(["notes/sub/deep/item1.md", "notes/sub/item1.md"]);
    expect(await matches(bridge, "notes/**item1.md")).toEqual(["notes/item1.md", "notes/sub/deep/item1.md", "notes/sub/item1.md"]);
    expect(await matches(bridge, "notes/a+b(1)[x]{y}^$.*")).toEqual(["notes/a+b(1)[x]{y}^$.md"]);
    expect(await matches(bridge, "notes/ITEM*.md")).toEqual([]);
  });

  it("preserves exact Unicode identity and the existing UTF-16 and line-terminator wildcard rules", async () => {
    const bridge = bridgeWith([
      "unicode/café.md", "unicode/cafe\u0301.md", "unicode/😀.md",
      "lines/a\nb.md", "lines/a\r/b.md", "lines/a\u2028b.md", "lines/a\u2029b.md",
    ]);
    expect(await matches(bridge, "unicode/café.*")).toEqual(["unicode/café.md"]);
    expect(await matches(bridge, "unicode/cafe\u0301.*")).toEqual(["unicode/cafe\u0301.md"]);
    expect(await matches(bridge, "unicode/?.md")).toEqual([]);
    expect(await matches(bridge, "unicode/??.md")).toEqual(["unicode/😀.md"]);
    expect(await matches(bridge, "lines/**.md")).toEqual([]);
    expect(await matches(bridge, "lines/****.md")).toEqual([]);
    expect(await matches(bridge, "lines/***.md")).toEqual(await matches(bridge, "lines/*.md"));
    expect(await matches(bridge, "lines/*****.md")).toEqual(await matches(bridge, "lines/*.md"));
    expect(await matches(bridge, "lines/a?b.md")).toEqual(await matches(bridge, "lines/*.md"));
  });

  it("preserves the strict end anchor for final line terminators, including CRLF", async () => {
    // The former RegExp had no m flag: $ cannot skip a final line terminator.
    // A single-star or question-mark token must consume each trailing unit.
    const candidates = ["", "\n", "\r", "\u2028", "\u2029", "\r\n", "\n\n"].map((suffix) => `notes/ab${suffix}`);
    const bridge = bridgeWith(candidates);
    const cases: [string, string[]][] = [
      ["notes/a*b", ["notes/ab"]],
      ["notes/ab?", candidates.slice(1, 5)],
      ["notes/ab??", candidates.slice(5)],
      ["notes/ab*", candidates],
      ["notes/ab**", ["notes/ab"]],
      ["notes/ab***", candidates],
    ];
    for (const [glob, expected] of cases) {
      const expression = shortReferenceGlob(glob);
      expect(candidates.filter((candidate) => expression.test(candidate)), glob).toEqual(expected);
      expect(new Set(await matches(bridge, glob)), glob).toEqual(new Set(expected));
    }
  });

  it("agrees with the previous grammar on small exhaustive inputs without evaluating adversarial regexes", async () => {
    // The reference is deliberately bounded to short patterns and paths. Only
    // the production matcher sees long attack patterns, in the child test below.
    const fragments = ["a", "b", "*", "**", "?", "/"];
    const candidates = ["a", "b", "aa", "ab", "ba", "bb", "aaa", "a/b", "b/a", "a/ba", "a/b/a", "a\nb", "a\r", "a\u2028b", "a\u2029b", "😀", "a😀"];
    const bridge = bridgeWith(candidates.map((value) => `cases/${value}`));
    for (const first of fragments) {
      for (const second of fragments) {
        for (const third of fragments) {
          const tail = first + second + third;
          if (tail.startsWith("/") || tail.endsWith("/") || tail.includes("//") || !/[?*]/.test(tail)) continue;
          const glob = `cases/${tail}`;
          const expression = shortReferenceGlob(glob);
          const expected = candidates.map((value) => `cases/${value}`).filter((value) => expression.test(value));
          const actual = await matches(bridge, glob);
          expect(new Set(actual), glob).toEqual(new Set(expected));
        }
      }
    }
  });

  it("retains sorted response caps and exact truncated flags", async () => {
    const bridge = bridgeWith(["notes/item10.md", "notes/item2.md", "notes/item1.md", "elsewhere.md"]);
    const first = await bridge.globScoped(projectId, "knowledge", "notes/*.md", 1);
    expect(first.entries.map((entry) => entry.path)).toEqual(["notes/item1.md"]);
    expect(first.truncated).toBe(true);
    const all = await bridge.globScoped(projectId, "knowledge", "notes/*.md", 3);
    expect(all.entries.map((entry) => entry.path)).toEqual(["notes/item1.md", "notes/item2.md", "notes/item10.md"]);
    expect(all.truncated).toBe(false);
    const list = await bridge.listScoped(projectId, "knowledge", "notes", 2);
    expect(list.entries.map((entry) => entry.path)).toEqual(["notes/item1.md", "notes/item2.md"]);
    expect(list.truncated).toBe(true);
  });

  it("keeps artifact refs and scope validation at the MCP entrypoint", async () => {
    const bridge = bridgeWith(["screenshots/frame10.png", "screenshots/frame2.png", "job-artifacts/run/summary.json"], "artifact");
    const tools = createUnityMCPTools(bridge);
    const result = await tools.callTool("unity.artifact.glob", { project_id: projectId, glob: "screenshots/frame*.png", max_entries: 1 });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      scope: "artifact", truncated: true,
      entries: [{ path: "screenshots/frame2.png", artifactRef: { scope: "artifact", path: "screenshots/frame2.png" } }],
    });
    for (const glob of ["../*", "screenshots/../*", "/screenshots/*", "screenshots%2f*", "Assets/*"]) {
      expect((await tools.callTool("unity.artifact.glob", { project_id: projectId, glob })).isError, glob).toBe(true);
    }
  });

  it("bounds the whole store at admission, including entries from other projects", async () => {
    const broker = new CanonicalPathBroker();
    broker.registerProject({ projectId, projectRoot: "/repo/Game", normalizeOptions: { sourceHost: "posix", targetProfile: "posix" } });
    broker.registerProject({ projectId: "other-project", projectRoot: "/other" });
    const seeds = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [fakeUnityScopedFileKey("other-project", "knowledge", `item${i}.md`), ""]));
    const withinLimit = new FakeUnityBridge(broker, { scopedFiles: seeds });
    expect((await withinLimit.globScoped(projectId, "knowledge", "*.md", 1)).entries).toEqual([]);

    seeds[fakeUnityScopedFileKey(projectId, "knowledge", "visible.md")] = "";
    expect(() => new FakeUnityBridge(broker, { scopedFiles: seeds })).toThrow("entry limit");
    const overLimit = createUnityMCPTools(withinLimit);
    const rejectedWrite = await overLimit.callTool("unity.knowledge.write", { project_id: projectId, path: "visible.md", text: "x" });
    expect(rejectedWrite.isError).toBe(true);
    expect(rejectedWrite.structuredContent).toMatchObject({ error: "ERR_INVALID_PATH", message: expect.stringContaining("entry limit") });
    // A rejected write does not poison subsequent query access.
    for (const name of ["unity.knowledge.glob", "unity.knowledge.list"]) {
      const result = await overLimit.callTool(name, { project_id: projectId, glob: "*.md", max_entries: 1 });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ entries: [], truncated: false });
    }
  });

  it("uses an aggregate match budget and fails instead of returning a partial capped result", async () => {
    const component = "a".repeat(255);
    const glob = `notes/${"a*".repeat(124)}aa/${"a*".repeat(127)}!`;
    expect(glob.length).toBe(512);
    const paths = [
      `notes/${component}/${"a".repeat(254)}!`,
      ...Array.from({ length: 32 }, (_, i) => `notes/${component}/${"a".repeat(245)}${String(i).padStart(10, "0")}`),
    ];
    const result = await createUnityMCPTools(bridgeWith(paths)).callTool("unity.knowledge.glob", {
      project_id: projectId, glob, max_entries: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "ERR_INVALID_PATH", message: expect.stringContaining("work limit") });
    expect(result.structuredContent).not.toHaveProperty("entries");
  });

  it("finishes adversarial policy-bound MCP globs within a separately enforced process deadline", () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "canonicalpath-glob-security-"));
    try {
      // Build the current production source into an isolated directory. This
      // test runs before the package build and must never reuse stale dist JS.
      writeFileSync(path.join(temporary, "package.json"), '{"type":"module"}\n');
      const compiler = path.join(path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");
      const config = fileURLToPath(new URL("../tsconfig.build.json", import.meta.url));
      const build = spawnSync(process.execPath, [compiler, "-p", config, "--outDir", temporary, "--declaration", "false", "--declarationMap", "false", "--sourceMap", "false"], {
        encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL", windowsHide: true,
      });
      expect(build.error, `${build.stdout}\n${build.stderr}`).toBeUndefined();
      expect(build.signal, `${build.stdout}\n${build.stderr}`).toBeNull();
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
      const fixture = fileURLToPath(new URL("./fixtures/unity-glob-adversarial.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [fixture, pathToFileURL(path.join(temporary, "unity-gateway/index.js")).href], {
        encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", windowsHide: true,
      });
      expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
      expect(result.signal, `${result.stdout}\n${result.stderr}`).toBeNull();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ completed: true, cases: 7 });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 20_000);
});

function shortReferenceGlob(glob: string): RegExp {
  assert.ok(glob.length <= 12, "the reference regex must stay tiny");
  let expression = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      expression += ".*";
      i++;
    } else if (ch === "*") {
      expression += "[^/]*";
    } else if (ch === "?") {
      expression += "[^/]";
    } else {
      expression += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}
