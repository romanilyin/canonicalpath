import { expect, it } from "vitest";
import { encodeGitRef, normalize, sanitizeComponent, toWSL } from "../src/canonicalpath.js";

it("normalizes mount separators while preserving interior component spaces and hyphens", () => {
  const mountRoot = "/mount" + "/".repeat(200_000) + "x";
  const options = { mountRoot: mountRoot + "///" };
  expect(toWSL(normalize("c:/repo"), options)).toBe("/mount/x/c/repo");
  expect(normalize(mountRoot + "/c/repo", { wsl: { ...options, enabled: true }, targetProfile: "win32-drive" })).toBe("c:/repo");
  const name = "a" + " ".repeat(200_000) + "z";
  expect(sanitizeComponent(" __" + name + "-.. ", "portable")).toBe(name);
  const ref = "a" + "-".repeat(200_000) + "z";
  expect(encodeGitRef("-" + ref + "-")).toMatch(/^v2-a--[0-9a-f]{64}$/);
});
