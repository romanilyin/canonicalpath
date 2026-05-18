import { describe, expect, it } from "vitest";
import { errorCode, isEqual } from "../src/canonicalpath";

describe("canonicalpath equality", () => {
  it("normalizes both inputs before comparing", () => {
    expect(isEqual("/home//alice/./repo", "/home/alice/repo", { sourceHost: "posix", targetProfile: "posix" })).toBe(true);
  });

  it("does not treat prefix siblings as equal", () => {
    expect(isEqual("c:/repo", "c:/repo-evil", { sourceHost: "win32", targetProfile: "win32-drive" })).toBe(false);
  });

  it("propagates normalize errors", () => {
    try {
      isEqual("", "/tmp/repo", { sourceHost: "posix", targetProfile: "posix" });
    } catch (error) {
      expect(errorCode(error)).toBe("ERR_EMPTY_PATH");
      return;
    }
    throw new Error("expected ERR_EMPTY_PATH");
  });
});
