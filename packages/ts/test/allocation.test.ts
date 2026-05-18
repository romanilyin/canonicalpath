import { describe, expect, it } from "vitest";
import { isEqual, join, normalize, relative, toWin32, toWSL } from "../src/canonicalpath";

describe("canonicalpath allocation smoke", () => {
  it("keeps repeated lexical helper loops bounded", () => {
    forceGC();
    const before = process.memoryUsage().heapUsed;
    let sink = "";

    for (let index = 0; index < 50_000; index += 1) {
      const root = normalize("/repo/src/..");
      const target = normalize("/repo/src/file.txt");
      const windows = normalize("C:\\Repo\\src\\..\\README.md");
      const rel = relative(root, target);
      sink = join(root, rel);
      sink = `${sink}|${toWin32(windows)}|${toWSL(windows)}|${isEqual("/repo/./src", "/repo/src")}`;
    }

    forceGC();
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(32 * 1024 * 1024);
    expect(sink.length).toBeGreaterThan(0);
  });
});

function forceGC(): void {
  // Available when Node is launched with --expose-gc; optional for local and CI runs.
  globalThis.gc?.();
  globalThis.gc?.();
}
