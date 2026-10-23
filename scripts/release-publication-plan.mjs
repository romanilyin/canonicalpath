import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// This source is mirrored verbatim in the privileged workflow, which never
// checks out or executes repository/asset-provided helpers. Tests enforce parity.
function calendarVersionParts(value) {
  const match = typeof value === "string" && value.length <= 100 && /^([1-9][0-9]{3})\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])-(0|[1-9][0-9]*)$/.exec(value);
  if (!match) throw new Error("Unsupported calendar version in npm registry preflight");
  const [, year, month, day, sequence] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) throw new Error("Invalid calendar date in npm registry preflight");
  return [year, month, day, sequence].map(part => BigInt(part));
}

function isLaterCalendarVersion(version, latest) {
  const requested = calendarVersionParts(version), current = calendarVersionParts(latest);
  for (let index = 0; index < requested.length; index++) {
    if (requested[index] !== current[index]) return requested[index] > current[index];
  }
  return false;
}

export function planPublication(rows, lookup) {
  const pending = [];
  const skipped = [];
  for (const row of rows) {
    const [name, version, integrity, filename, extra] = row.split("\t");
    if (!name || !version || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity ?? "") ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.tgz$/.test(filename ?? "") || extra !== undefined) throw new Error("Invalid verified publication row");
    calendarVersionParts(version);
    const current = lookup(name, version);
    if (!current || typeof current !== "object" || current.integrity === undefined || current.latest === undefined) throw new Error("Registry preflight must check both the target version and latest");
    if (current.integrity === null) {
      if (current.latest !== null && !isLaterCalendarVersion(version, current.latest)) throw new Error(`${name}@${version} would replace an equal or newer latest; refusing a rollback`);
      pending.push({ name, version, integrity, filename });
      continue;
    }
    if (current.integrity !== integrity) throw new Error(`${name}@${version} is already published with different contents`);
    if (current.latest !== version) throw new Error(`${name}@${version} is published, but latest points to a different version; refusing a rollback`);
    skipped.push({ name, version });
  }
  return { pending, skipped };
}

function view(args, missingAllowed = false, run = execFileSync) {
  let output;
  try {
    output = run("npm", ["view", ...args, "--json", "--registry=https://registry.npmjs.org/", "--strict-ssl=true"], {
      encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    let failure;
    try { failure = JSON.parse(String(error.stdout)); } catch { /* Any non-JSON failure is fatal. */ }
    if (missingAllowed && error.status !== 0 && failure?.error?.code === "E404") return null;
    throw new Error("npm registry preflight failed; no package will be published", { cause: error });
  }
  const value = JSON.parse(output);
  if (typeof value !== "string" || !value) throw new Error("Invalid npm registry preflight response");
  return value;
}

export function preflightNpmPackages(directory, run = execFileSync) {
  const rows = readFileSync(path.join(directory, "manifest.tsv"), "utf8").trimEnd().split("\n");
  const result = planPublication(rows, (name, version) => {
    const integrity = view([`${name}@${version}`, "dist.integrity"], true, run);
    // A missing old version must not skip the latest check and roll back a newer release.
    const latest = view([name, "dist-tags.latest"], integrity === null, run);
    return { integrity, latest };
  });
  // All package identities have been checked before exposing any pending row.
  const pending = result.pending.map(entry => [entry.name, entry.version, entry.integrity, path.join(directory, entry.filename)].join("\t")).join("\n");
  writeFileSync(path.join(directory, "pending.tsv"), pending ? pending + "\n" : "", { mode: 0o600 });
  for (const entry of result.skipped) console.log(`${entry.name}@${entry.version} already has the original integrity; skipping`);
}
