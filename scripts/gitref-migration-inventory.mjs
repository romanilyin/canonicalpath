import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// This tool only reads an inventory and prints a proposed mapping. It never
// discovers, creates, moves, deletes, or attaches a worktree or cache directory.
export function buildGitRefMigrationInventory(refs) {
  if (!Array.isArray(refs)) throw new Error("inventory must be a JSON array of exact ref strings");
  const legacyOwners = new Map();
  const v2Owners = new Map();
  const entries = [];
  for (const ref of new Set(refs)) {
    if (typeof ref !== "string" || ref.length === 0) throw new Error("inventory contains an empty or non-string ref");
    if (ref.includes("\0") || !validScalarString(ref)) throw new Error("inventory ref must contain valid Unicode scalar values without NUL");
    const digest = createHash("sha256").update(ref, "utf8").digest("hex");
    const slug = ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "ref";
    const legacyDirectory = `${slug}--${digest.slice(0, 12)}`;
    const boundedSlug = slug.slice(0, 80).replace(/^[._-]+|[._-]+$/g, "") || "ref";
    const v2Directory = `v2-${boundedSlug}--${digest}`;
    for (const [owners, directory] of [[legacyOwners, legacyDirectory], [v2Owners, v2Directory]]) {
      if (owners.has(directory) && owners.get(directory) !== ref) throw new Error("ambiguous directory ownership: stop and inspect the original ref metadata");
      owners.set(directory, ref);
    }
    entries.push({ ref, legacyDirectory, v2Directory, ownershipVerified: false });
  }
  return { version: 2, status: "review-required", entries };
}

function validScalarString(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("usage: node scripts/gitref-migration-inventory.mjs exact-refs.json");
    const refs = JSON.parse(readFileSync(process.argv[2], "utf8"));
    process.stdout.write(JSON.stringify(buildGitRefMigrationInventory(refs), null, 2) + "\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
