import { describe, expect, it } from "vitest";
import { parseFileUri } from "../src/canonicalpath/index.js";
describe("direct URI parsing", () => {
  for (const uri of ["file:///repo/a%00b", "file://server%00/share/a", "vscode-file://app%00/repo/a"]) {
    it(`rejects decoded NUL in ${uri}`, () => {
      expect(() => parseFileUri(uri, { uri: { allowFileUri: true, allowVSCodeFileUri: true } })).toThrow(/ERR_NUL_BYTE/);
    });
  }
});
