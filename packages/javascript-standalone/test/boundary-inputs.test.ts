import { expect, it } from "vitest";
import { encodeGitRef, normalize, sanitizeComponent, toWSL } from "../src/canonicalpath.js";

it("handles large interior slash, space and hyphen runs without changing identity", () => {
  const mountRoot = "/mount" + "/".repeat(200_000) + "x";
  const options = { mountRoot: mountRoot + "///" };
  expect(toWSL(normalize("c:/repo"), options)).toBe(mountRoot + "/c/repo");
  expect(normalize(mountRoot + "/c/repo", { wsl: { ...options, enabled: true }, targetProfile: "win32-drive" })).toBe("c:/repo");
  const name = "a" + " ".repeat(200_000) + "z";
  expect(sanitizeComponent(" __" + name + "-.. ", "portable")).toBe(name);
  const ref = "a" + "-".repeat(200_000) + "z";
  expect(encodeGitRef("-" + ref + "-").startsWith(ref + "--")).toBe(true);
});
