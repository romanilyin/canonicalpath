import { describe, expect, it } from "vitest";
import { encodeGitRef, normalize, sanitizeComponent, toWSL } from "../src/canonicalpath/index.js";
import { secureDaemonEndpoint } from "../src/canonicalfs/tls.js";
import { CanonicalPathService } from "../src/unity-gateway/path-service.js";

describe("large interior runs in boundary trimming", () => {
  const size = 200_000;

  it("normalizes large interior separator runs consistently in both WSL directions", () => {
    const mountRoot = "/mount" + "/".repeat(size) + "x";
    const options = { mountRoot: mountRoot + "///" };
    expect(toWSL(normalize("c:/repo"), options)).toBe("/mount/x/c/repo");
    expect(normalize(mountRoot + "/c/repo", { wsl: { ...options, enabled: true }, targetProfile: "win32-drive" })).toBe("c:/repo");
  });

  it("preserves interior spaces and hyphens in names", () => {
    const name = "a" + " ".repeat(size) + "z";
    expect(sanitizeComponent(" __" + name + "-.. ", "portable")).toBe(name);
    const ref = "a" + "-".repeat(size) + "z";
    expect(encodeGitRef("-" + ref + "-")).toMatch(/^v2-a--[0-9a-f]{64}$/);
    expect(new CanonicalPathService().makeSafeFileName(name, name.length)).toBe(name);
  });

  it("trims only trailing separators from authenticated HTTPS endpoints", () => {
    const endpoint = "https://example.test/a" + "/".repeat(size) + "z";
    expect(secureDaemonEndpoint(endpoint + "///")).toBe(endpoint);
  });
});
