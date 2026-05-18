import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BestEffortCanonicalFSRoot, canonicalFSLimitations, fsErrorCode } from "../src/canonicalfs";

describe("canonicalfs TypeScript best-effort behavior", () => {
  it("reads, writes, stats, renames, and removes files under hostRoot", async () => {
    const hostRoot = await mkdtemp(path.join(os.tmpdir(), "canonicalfs-ts-"));
    const root = new BestEffortCanonicalFSRoot("project-1", hostRoot);

    await root.writeFile("safe/README.md", new TextEncoder().encode("ok"));

    await expect(readFile(path.join(hostRoot, "safe", "README.md"), "utf8")).resolves.toBe("ok");
    await expect(readText(root, "safe/README.md")).resolves.toBe("ok");
    await expect(root.stat("safe/README.md")).resolves.toMatchObject({ path: "safe/README.md", size: 2, isDirectory: false });

    await root.rename("safe/README.md", "safe/RENAMED.md");
    await expect(readFile(path.join(hostRoot, "safe", "RENAMED.md"), "utf8")).resolves.toBe("ok");
    await expect(root.readFile("safe/README.md")).rejects.toThrow();

    await root.remove("safe/RENAMED.md");
    await expect(root.readFile("safe/RENAMED.md")).rejects.toThrow();
  });

  it("cleans non-escaping dot segments for rename", async () => {
    const hostRoot = await mkdtemp(path.join(os.tmpdir(), "canonicalfs-ts-"));
    const root = new BestEffortCanonicalFSRoot("project-1", hostRoot);

    await root.writeFile("safe/file.txt", new TextEncoder().encode("ok"));
    await root.rename("safe/tmp/../file.txt", "safe/tmp/../renamed.txt");

    await expect(readText(root, "safe/renamed.txt")).resolves.toBe("ok");
    await expect(root.readFile("safe/file.txt")).rejects.toThrow();
  });

  it("cleans non-escaping dot segments", async () => {
    const hostRoot = await mkdtemp(path.join(os.tmpdir(), "canonicalfs-ts-"));
    const root = new BestEffortCanonicalFSRoot("project-1", hostRoot);

    await root.writeFile("safe/tmp/../README.md", new TextEncoder().encode("ok"));

    await expect(readText(root, "safe/README.md")).resolves.toBe("ok");
  });

  it("rejects lexical escapes and absolute paths", async () => {
    const hostRoot = await mkdtemp(path.join(os.tmpdir(), "canonicalfs-ts-"));
    const root = new BestEffortCanonicalFSRoot("project-1", hostRoot);

    await expectRejectCode(root.readFile("../outside/secret.txt"), "ERR_OUTSIDE_ROOT");
    await expectRejectCode(root.writeFile("/tmp/escape.txt", new Uint8Array()), "ERR_ABSOLUTE_PATH");
    await expectRejectCode(root.stat("safe\u0000name.txt"), "ERR_NUL_BYTE");
    await expectRejectCode(root.mkdirAll("safe\\nested"), "ERR_OUTSIDE_ROOT");
    await expectRejectCode(root.rename("safe/file.txt", "../outside/file.txt"), "ERR_OUTSIDE_ROOT");
    await expectRejectCode(root.rename("/tmp/escape.txt", "safe/file.txt"), "ERR_ABSOLUTE_PATH");
  });

  it("requires hostRoot for local best-effort operations", async () => {
    const root = new BestEffortCanonicalFSRoot("project-1");

    await expectRejectCode(root.readFile("README.md"), "ERR_OUTSIDE_ROOT");
    await expectRejectCode(root.rename("old.txt", "new.txt"), "ERR_OUTSIDE_ROOT");
    expect(canonicalFSLimitations).toContain("must not claim TOCTOU-proof security");
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

async function readText(root: BestEffortCanonicalFSRoot, rel: string): Promise<string> {
  return new TextDecoder().decode(await root.readFile(rel));
}
