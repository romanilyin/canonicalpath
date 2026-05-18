import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fsErrorCode, validateRelativePath } from "../src/canonicalfs";

interface FixtureManifest {
  version: number;
  fixtures: Fixture[];
}

interface Fixture {
  id: string;
  operation: string;
  path: string;
  target?: string;
  expect: "allow" | "reject";
  error?: string;
}

const lexicalErrors = new Set(["ERR_ABSOLUTE_PATH", "ERR_DRIVE_RELATIVE_PATH", "ERR_NUL_BYTE", "ERR_OUTSIDE_ROOT"]);
const manifestPath = fileURLToPath(new URL("../../../spec/testdata/fs_fixtures_manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FixtureManifest;

describe("canonicalfs lexical fixture validation", () => {
  for (const fixture of manifest.fixtures) {
    if (fixture.expect === "allow") {
      it(`${fixture.id} allows lexical path`, () => {
        expect(validateRelativePath(fixture.path)).toBe(fixture.path);
      });
      continue;
    }

    if (fixture.error && lexicalErrors.has(fixture.error)) {
      it(`${fixture.id} rejects lexical path`, () => {
        expectFixtureReject(fixture);
      });
    }
  }
});

function expectFixtureReject(fixture: Fixture): void {
  try {
    validateRelativePath(fixture.path);
    if (fixture.operation === "rename" && fixture.target) validateRelativePath(fixture.target);
  } catch (error) {
    expect(fsErrorCode(error)).toBe(fixture.error);
    return;
  }
  throw new Error(`expected ${fixture.id} to reject with ${fixture.error}`);
}
