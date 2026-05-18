import { describe, expect, it } from "vitest";
import { isEqual, join, normalize, relative, toWin32, toWSL } from "../src/canonicalpath";

describe("JavaScript standalone allocation smoke", () => {
  it("keeps repeated lexical helper loops bounded", () => {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    let sink = "";

    for (let index = 0; index < 50_000; index += 1) {
      const root = normalize("/repo/src/..");
      const target = normalize("/repo/src/file.txt");
      const windows = normalize("C:\\Repo\\src\\..\\README.md");
      const rel = relative(root, target);
      sink = `${join(root, rel)}|${toWin32(windows)}|${toWSL(windows)}|${isEqual("/repo/./src", "/repo/src")}`;
    }

    globalThis.gc?.();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(32 * 1024 * 1024);
    expect(sink.length).toBeGreaterThan(0);
  });
});
