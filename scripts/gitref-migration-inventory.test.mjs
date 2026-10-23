import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildGitRefMigrationInventory } from "./gitref-migration-inventory.mjs";

test("migration inventory agrees with all shared v2 GitRef vectors", () => {
  const cases = JSON.parse(readFileSync(new URL("../spec/testdata/git_cases.json", import.meta.url))).cases.filter(value => value.operation === "encode-git-ref" && value.expected);
  const result = buildGitRefMigrationInventory(cases.map(value => value.raw));
  assert.equal(result.status, "review-required");
  for (const vector of cases) {
    const record = result.entries.find(value => value.ref === vector.raw);
    assert.equal(record.v2Directory, vector.expected);
    assert.equal(record.ownershipVerified, false);
  }
  assert.equal(result.entries[0].legacyDirectory, "feature-auth--fc659bd73585");
});

test("migration inventory preserves identity and refuses malformed input", () => {
  assert.equal(buildGitRefMigrationInventory(["one", "one"]).entries.length, 1);
  assert.notEqual(...buildGitRefMigrationInventory(["café", "cafe\u0301"]).entries.map(value => value.v2Directory));
  for (const refs of [{}, [""], [null], ["x\0y"], ["\ud800"]]) assert.throws(() => buildGitRefMigrationInventory(refs));
});
