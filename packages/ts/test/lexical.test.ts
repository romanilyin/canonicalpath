import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { encodeComponent, encodeGitRef, errorCode, isEqual, join, normalize, relative, sanitizeComponent, toPOSIX, toWSL, toWin32 } from "../src/canonicalpath";
import type { CanonicalPath, CanonicalRelativePath, NormalizeOptions } from "../src/canonicalpath";

interface VectorFile {
  version: number;
  cases: VectorCase[];
}

interface VectorCase {
  id: string;
  operation: string;
  raw?: string;
  root?: string;
  target?: string;
  relative?: string;
  profile?: "portable" | "win32" | "posix";
  expected?: string;
  error?: string;
  options?: NormalizeOptions;
}

const testdataDir = fileURLToPath(new URL("../../../spec/testdata", import.meta.url));

describe("canonicalpath shared vectors", () => {
  for (const fileName of readdirSync(testdataDir).filter((name) => name.endsWith("_cases.json"))) {
    const vectors = JSON.parse(readFileSync(path.join(testdataDir, fileName), "utf8")) as VectorFile;

    describe(fileName, () => {
      for (const testCase of vectors.cases) {
        it(testCase.id, () => {
          assertVectorResult(testCase, () => runVector(testCase));
        });
      }
    });
  }
});

function runVector(testCase: VectorCase): string {
  switch (testCase.operation) {
    case "normalize":
      return normalize(required(testCase.raw, testCase, "raw"), testCase.options ?? {});
    case "relative":
      return relative(required(testCase.root, testCase, "root") as CanonicalPath, required(testCase.target, testCase, "target") as CanonicalPath);
    case "join":
      return join(required(testCase.root, testCase, "root") as CanonicalPath, required(testCase.relative, testCase, "relative") as CanonicalRelativePath);
    case "is-equal":
      return String(isEqual(required(testCase.root, testCase, "root"), required(testCase.target, testCase, "target"), testCase.options ?? {}));
    case "to-win32":
      return toWin32(required(testCase.raw, testCase, "raw") as CanonicalPath);
    case "to-wsl":
      return toWSL(required(testCase.raw, testCase, "raw") as CanonicalPath, testCase.options?.wsl);
    case "to-posix":
      return toPOSIX(required(testCase.raw, testCase, "raw") as CanonicalPath);
    case "sanitize-component":
      return sanitizeComponent(required(testCase.raw, testCase, "raw"), requiredProfile(testCase));
    case "encode-component":
      return encodeComponent(required(testCase.raw, testCase, "raw"), requiredProfile(testCase));
    case "encode-git-ref":
      return encodeGitRef(required(testCase.raw, testCase, "raw"));
    default:
      throw new Error(`unsupported vector operation ${testCase.operation}`);
  }
}

function assertVectorResult(testCase: VectorCase, run: () => string): void;
function assertVectorResult(testCase: VectorCase, actual: string): void;
function assertVectorResult(testCase: VectorCase, actualOrRun: string | (() => string)): void {
  if (testCase.error) {
    expect(() => (typeof actualOrRun === "function" ? actualOrRun() : actualOrRun)).toThrow();
    try {
      if (typeof actualOrRun === "function") actualOrRun();
    } catch (error) {
      expect(errorCode(error)).toBe(testCase.error);
      return;
    }
    throw new Error(`expected error ${testCase.error}`);
  }

  const actual = typeof actualOrRun === "function" ? actualOrRun() : actualOrRun;
  expect(actual).toBe(testCase.expected);
}

function required(value: string | undefined, testCase: VectorCase, field: string): string {
  if (value === undefined) throw new Error(`${testCase.id}: ${field} is required`);
  return value;
}

function requiredProfile(testCase: VectorCase): "portable" | "win32" | "posix" {
  if (testCase.profile === undefined) throw new Error(`${testCase.id}: profile is required`);
  return testCase.profile;
}
