import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeGitRef, errorCode } from "../src/canonicalpath";
const vectors = JSON.parse(readFileSync(new URL("../../../spec/testdata/git-ref-utf16-vectors.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; rawUtf16: number[]; expected?: string; error?: string }>;
};
for (const vector of vectors.cases) {
  it(vector.id, () => {
    const raw = String.fromCharCode(...vector.rawUtf16);
    if (vector.error) {
      try { encodeGitRef(raw); } catch (error) { expect(errorCode(error)).toBe(vector.error); return; }
      throw new Error("expected rejection of malformed input");
    }
    expect(encodeGitRef(raw)).toBe(vector.expected);
  });
}
