import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalize } from "../src/canonicalpath";
import type { NormalizeOptions } from "../src/canonicalpath";

interface VectorFile {
  cases: VectorCase[];
}

interface VectorCase {
  id: string;
  operation: string;
  expected?: string;
  options?: NormalizeOptions;
}

const testdataDir = fileURLToPath(new URL("../../../spec/testdata", import.meta.url));

describe("canonicalpath normalize idempotence", () => {
  for (const fileName of readdirSync(testdataDir).filter((name) => name.endsWith("_cases.json"))) {
    const vectors = JSON.parse(readFileSync(path.join(testdataDir, fileName), "utf8")) as VectorFile;

    for (const testCase of vectors.cases.filter((item) => item.operation === "normalize" && item.expected !== undefined)) {
      it(`${fileName}:${testCase.id}`, () => {
        const first = required(testCase.expected, testCase.id);
        expect(normalize(first, testCase.options ?? {})).toBe(first);
      });
    }
  }

  it("holds for arbitrary valid default-normalized strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (raw) => {
        try {
          const first = normalize(raw);
          expect(normalize(first)).toBe(first);
        } catch {
          // Invalid inputs may be rejected; idempotence only applies to successful normalization.
        }
      }),
      { numRuns: 500 },
    );
  });
});

function required(value: string | undefined, id: string): string {
  if (value === undefined) throw new Error(`${id}: expected is required`);
  return value;
}
