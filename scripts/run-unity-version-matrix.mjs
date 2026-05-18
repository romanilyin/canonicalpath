import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versions = [
  { prefix: "2022.3", installed: "2022.3.62f3" },
  { prefix: "6000.1", installed: "6000.1.17f1" },
  { prefix: "6000.2", installed: "6000.2.15f1" },
  { prefix: "6000.3", installed: "6000.3.15f1" },
  { prefix: "6000.4", installed: "6000.4.5f1" },
];

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

const failures = [];
for (const version of versions) {
  console.log(`Running Unity ${version.installed} ${lane.label} lane`);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", lane.script)], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, ...lane.env(version.prefix) },
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
