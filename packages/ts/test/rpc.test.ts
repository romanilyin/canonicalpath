import { describe, expect, it } from "vitest";
import { CanonicalFSRPCRoot, fsErrorCode } from "../src/canonicalfs";
import type { CanonicalFSClient, FileStat } from "../src/canonicalfs";
import type { CanonicalRelativePath } from "../src/canonicalpath";

describe("canonicalfs TypeScript RPC wrapper", () => {
  it("validates relative paths before delegating to the client", async () => {
    const calls: unknown[] = [];
    const client: CanonicalFSClient = {
      async readFile(projectId, rel) {
        calls.push({ operation: "readFile", projectId, rel });
        return new TextEncoder().encode(`${projectId}:${rel}`);
      },
      async writeFile(projectId, rel, data) {
        calls.push({ operation: "writeFile", projectId, rel, data: Array.from(data) });
      },
      async stat(projectId, rel): Promise<FileStat> {
        calls.push({ operation: "stat", projectId, rel });
        return { path: rel, size: 2, isDirectory: false };
      },
      async mkdirAll(projectId, rel) {
        calls.push({ operation: "mkdirAll", projectId, rel });
      },
      async remove(projectId, rel) {
        calls.push({ operation: "remove", projectId, rel });
      },
      async rename(projectId, oldRel, newRel) {
        calls.push({ operation: "rename", projectId, oldRel, newRel });
      },
    };
    const root = new CanonicalFSRPCRoot("project-1", client);

    await root.mkdirAll("safe/new/../dir");
    await root.writeFile("safe/tmp/../file.txt", new Uint8Array([111, 107]));
    await expect(root.readFile("safe/file.txt")).resolves.toEqual(new TextEncoder().encode("project-1:safe/file.txt"));
    await expect(root.stat("safe/file.txt")).resolves.toEqual({ path: "safe/file.txt" as CanonicalRelativePath, size: 2, isDirectory: false });
    await root.rename("safe/file.txt", "safe/renamed.txt");
    await root.remove("safe/renamed.txt");

    expect(calls).toEqual([
      { operation: "mkdirAll", projectId: "project-1", rel: "safe/dir" },
      { operation: "writeFile", projectId: "project-1", rel: "safe/file.txt", data: [111, 107] },
      { operation: "readFile", projectId: "project-1", rel: "safe/file.txt" },
      { operation: "stat", projectId: "project-1", rel: "safe/file.txt" },
      { operation: "rename", projectId: "project-1", oldRel: "safe/file.txt", newRel: "safe/renamed.txt" },
      { operation: "remove", projectId: "project-1", rel: "safe/renamed.txt" },
    ]);
  });

  it("rejects invalid paths without calling the client", async () => {
    const calls: unknown[] = [];
    const client: CanonicalFSClient = {
      async readFile(projectId, rel) {
        calls.push({ operation: "readFile", projectId, rel });
        return new Uint8Array();
      },
      async writeFile(projectId, rel) {
        calls.push({ operation: "writeFile", projectId, rel });
      },
      async stat(projectId, rel): Promise<FileStat> {
        calls.push({ operation: "stat", projectId, rel });
        return { path: rel, size: 0, isDirectory: false };
      },
      async mkdirAll(projectId, rel) {
        calls.push({ operation: "mkdirAll", projectId, rel });
      },
      async remove(projectId, rel) {
        calls.push({ operation: "remove", projectId, rel });
      },
      async rename(projectId, oldRel, newRel) {
        calls.push({ operation: "rename", projectId, oldRel, newRel });
      },
    };
    const root = new CanonicalFSRPCRoot("project-1", client);

    await expectRejectCode(root.readFile("../outside/secret.txt"), "ERR_OUTSIDE_ROOT");
    await expectRejectCode(root.writeFile("/tmp/escape.txt", new Uint8Array()), "ERR_ABSOLUTE_PATH");
    await expectRejectCode(root.stat("safe\u0000name.txt"), "ERR_NUL_BYTE");
    await expectRejectCode(root.mkdirAll("../outside/new-dir"), "ERR_OUTSIDE_ROOT");
    await expectRejectCode(root.remove("/tmp/escape.txt"), "ERR_ABSOLUTE_PATH");
    await expectRejectCode(root.rename("safe/file.txt", "../outside/file.txt"), "ERR_OUTSIDE_ROOT");
    expect(calls).toEqual([]);
  });
});

async function expectRejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(fsErrorCode(error)).toBe(code);
    return;
  }
  throw new Error(`expected rejection ${code}`);
}
