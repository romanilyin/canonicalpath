import { describe, expect, it } from "vitest";
import { encodeGitRef, normalize, sanitizeComponent, toWSL } from "../src/canonicalpath/index.js";
import { CanonicalFSHTTPClient } from "../src/canonicalfs/http.js";
import { CanonicalPathService } from "../src/unity-gateway/path-service.js";

describe("large interior runs in boundary trimming", () => {
  const size = 200_000;

  it("preserves interior separators in WSL mount roots", () => {
    const mountRoot = "/mount" + "/".repeat(size) + "x";
    const options = { mountRoot: mountRoot + "///" };
    expect(toWSL(normalize("c:/repo"), options)).toBe(mountRoot + "/c/repo");
    expect(normalize(mountRoot + "/c/repo", { wsl: { ...options, enabled: true }, targetProfile: "win32-drive" })).toBe("c:/repo");
  });

  it("preserves interior spaces and hyphens in names", () => {
    const name = "a" + " ".repeat(size) + "z";
    expect(sanitizeComponent(" __" + name + "-.. ", "portable")).toBe(name);
    const ref = "a" + "-".repeat(size) + "z";
    expect(encodeGitRef("-" + ref + "-").startsWith(ref + "--")).toBe(true);
    expect(new CanonicalPathService().makeSafeFileName(name, name.length)).toBe(name);
  });

  it("trims only trailing separators from HTTP endpoints", async () => {
    const endpoint = "https://example.test/a" + "/".repeat(size) + "z";
    let requested = "";
    const client = new CanonicalFSHTTPClient(endpoint + "///", {
      capabilityToken: "test-token",
      fetch: async (input) => { requested = input; return new Response("{}"); },
    });
    await client.closeProject("p");
    expect(requested).toBe(endpoint + "/v1/projects/close");
  });
});
