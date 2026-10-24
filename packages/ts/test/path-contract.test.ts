import { describe, expect, it } from "vitest";
import { isEqual, join, normalize, normalizeRelative, relative, toPOSIX, toWSL, toWin32 } from "../src/canonicalpath";
import type { CanonicalRelativePath, NormalizeOptions } from "../src/canonicalpath";

const native: NormalizeOptions = { sourceHost: "posix", targetProfile: "posix" };
const canonical: NormalizeOptions = { sourceHost: "canonical" };

describe("canonical operation consistency", () => {
  it("preserves native POSIX identity through normalization, serialization and composition", () => {
    const components = ["a\\b", "C:foo", "C:", "café", "cafe\u0301", "file:", "%25", "😀", "\uFFFD", "CON"];
    const root = normalize("/repo", native);
    for (const first of components) {
      for (const second of components) {
        const raw = `/repo/${first}/${second}`;
        const target = normalize(raw, native);
        expect(target).toBe(raw);
        expect(normalize(target, native)).toBe(target);
        expect(normalize(target, canonical)).toBe(target);
        expect(toPOSIX(target)).toBe(raw);
        expect(join(root, relative(root, target))).toBe(target);
      }
    }
    expect(isEqual("/repo/a\\b", "/repo/a/b", native)).toBe(false);
    expect(isEqual("/C:/repo", "c:/repo", canonical)).toBe(false);
    expect(isEqual("./c:/repo", "c:/repo", canonical)).toBe(false);
  });

  it("keeps marked relative input stable without applying host interpretation again", () => {
    for (const raw of ["C:foo", "C:/repo", "x/../C:foo", "a\\b", "file://repo/a", "./C:/repo"]) {
      const first = normalize(raw, native);
      expect(normalize(first, native)).toBe(first);
      expect(normalize(first, canonical)).toBe(first);
      expect(toPOSIX(first)).toBe(first);
    }
  });

  it("round trips complete Windows roots and drive-like relative components", () => {
    for (const rootRaw of ["c:/", "c:/repo", "//server/share", "//?/c:/", "//?/UNC/server/share"]) {
      const root = normalize(rootRaw, canonical);
      for (const suffix of ["child/file", "./C:foo", "./C:/nested"]) {
        const target = join(root, suffix as CanonicalRelativePath);
        expect(join(root, relative(root, target))).toBe(target);
        expect(normalize(toWin32(target), { sourceHost: "win32", windows: { preserveExtendedLength: rootRaw.startsWith("//?/") } })).toBe(target);
      }
    }
  });

  it("uses the same mount grammar in both directions", () => {
    for (const mountRoot of ["", "/", "/mnt/", "/foo/../mnt//", "/mnt\\vol", "/C:/drives", "/café", "/cafe\u0301"]) {
      for (const raw of ["c:/", "d:/repo/file"]) {
        const path = normalize(raw, canonical);
        const host = toWSL(path, { mountRoot });
        expect(normalize(host, { sourceHost: "wsl", wsl: { enabled: true, mountRoot } })).toBe(path);
      }
    }
  });

  it("retains strict raw-relative validation at filesystem-facing boundaries", () => {
    for (const raw of ["a\\b", "../escape", "/absolute", "c:/absolute", "C:foo", "bad\0path"]) {
      expect(() => normalizeRelative(raw)).toThrow();
    }
    const posix = normalize("/repo", native);
    const windows = normalize("c:/repo", canonical);
    expect(join(posix, "a\\b" as CanonicalRelativePath)).toBe("/repo/a\\b");
    expect(() => join(windows, "a\\b" as CanonicalRelativePath)).toThrow();
  });
});
