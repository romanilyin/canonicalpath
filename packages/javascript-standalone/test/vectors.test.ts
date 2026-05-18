import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  encodeComponent,
  encodeGitRef,
  errorCode,
  isEqual,
  join,
  normalize,
  relative,
  sanitizeComponent,
  toPOSIX,
  toWSL,
  toWin32,
} from "../src/canonicalpath";
import type { CanonicalPath, CanonicalRelativePath, NormalizeOptions } from "../src/canonicalpath";

interface VectorFile {
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
  options?: NormalizeOptions;
  expected?: string;
  error?: string;
}

interface VectorResult {
  file: string;
  id: string;
  operation: string;
  status: "ok" | "error";
  value?: string;
  error?: string;
}

const testdataDir = fileURLToPath(new URL("../../../spec/testdata", import.meta.url));
const outFile = process.env.VECTOR_RESULTS_OUT;

describe("JavaScript standalone CanonicalPath shared vectors", () => {
  for (const fileName of readdirSync(testdataDir).filter((name) => name.endsWith("_cases.json")).sort()) {
    const vectors = JSON.parse(readFileSync(path.join(testdataDir, fileName), "utf8")) as VectorFile;
    for (const testCase of vectors.cases) {
      it(`${fileName} ${testCase.id}`, () => {
        if (testCase.error) {
          expect(() => runVector(testCase)).toThrow();
          try {
            runVector(testCase);
          } catch (error) {
            expect(errorCode(error)).toBe(testCase.error);
          }
          return;
        }
        expect(runVector(testCase)).toBe(testCase.expected);
      });
    }
  }

  const writeResults = outFile ? it : it.skip;
  writeResults("writes shared-vector results for cross-language comparison", () => {
    if (!outFile) return;
    const resolvedOutFile = path.resolve(outFile);
    mkdirSync(path.dirname(resolvedOutFile), { recursive: true });
    writeFileSync(resolvedOutFile, `${JSON.stringify({ version: 1, results: collectResults() }, null, 2)}\n`);
  });
});

function collectResults(): VectorResult[] {
  const results: VectorResult[] = [];
  const fileNames = readdirSync(testdataDir)
    .filter((name) => name.endsWith("_cases.json"))
    .sort();

  for (const fileName of fileNames) {
    const vectors = JSON.parse(readFileSync(path.join(testdataDir, fileName), "utf8")) as VectorFile;
    for (const testCase of vectors.cases) {
      const entry: VectorResult = { file: fileName, id: testCase.id, operation: testCase.operation, status: "ok" };
      try {
        entry.value = runVector(testCase);
      } catch (error) {
        entry.status = "error";
        entry.error = errorCode(error);
      }
      results.push(entry);
    }
  }
  return results;
}

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

function required(value: string | undefined, testCase: VectorCase, field: string): string {
  if (value === undefined) throw new Error(`${testCase.id}: ${field} is required`);
  return value;
}

function requiredProfile(testCase: VectorCase): "portable" | "win32" | "posix" {
  if (testCase.profile === undefined) throw new Error(`${testCase.id}: profile is required`);
  return testCase.profile;
}
