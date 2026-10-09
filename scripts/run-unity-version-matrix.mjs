import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Discover installed editors so local verification follows the actual host,
// including beta/alpha versions. CI hosts without Unity skip this local gate.
const hubRoots = process.env.UNITY_HUB_EDITOR_ROOT ? [process.env.UNITY_HUB_EDITOR_ROOT] : [
  "C:/Program Files/Unity/Hub/Editor", "/mnt/c/Program Files/Unity/Hub/Editor", "/Applications/Unity/Hub/Editor",
];
const versions = [];
for (const hubRoot of hubRoots) {
  if (!existsSync(hubRoot)) continue;
  for (const entry of readdirSync(hubRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+[abfp]\d+$/.test(entry.name)) continue;
    const editor = [path.join(hubRoot, entry.name, "Editor", "Unity.exe"), path.join(hubRoot, entry.name, "Unity.app", "Contents", "MacOS", "Unity")].find(existsSync);
    if (editor) versions.push({ prefix: entry.name, installed: entry.name, editor });
  }
}
versions.sort((a, b) => a.installed.localeCompare(b.installed, undefined, { numeric: true }));

const lanes = {
  editmode: {
    label: "EditMode",
    script: "run-unity-editmode-tests.mjs",
    env(prefix) {
      return { UNITY_REQUIRED_VERSION_PREFIX: prefix };
    },
  },
  "burst-alloc": {
    label: "Burst allocation",
    script: "run-unity-burst-allocation-probe.mjs",
    env(prefix) {
      return { UNITY_BURST_ALLOC_PROBE: "1", UNITY_BURST_REQUIRED_VERSION_PREFIX: prefix };
    },
  },
};

const laneName = process.argv[2];
const lane = lanes[laneName];
if (!lane) {
  console.error(`Usage: node scripts/run-unity-version-matrix.mjs ${Object.keys(lanes).join("|")}`);
  process.exit(1);
}

if (versions.length === 0) {
  console.log("No installed Unity editors found; skipping local Unity version matrix");
  process.exit(0);
}
const failures = [];
for (const version of versions) {
  console.log(`Running Unity ${version.installed} ${lane.label} lane`);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", lane.script)], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, ...lane.env(version.prefix), UNITY_EDITOR: version.editor },
  });

  if (result.error) {
    console.error(result.error.message);
    failures.push(`${version.installed}: ${result.error.message}`);
    continue;
  }

  const status = result.status ?? 1;
  if (status !== 0) failures.push(`${version.installed}: exit ${status}`);
}

if (failures.length > 0) {
  console.error(`Unity ${lane.label} matrix failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Unity ${lane.label} matrix passed: ${versions.map((version) => version.installed).join(", ")}`);
