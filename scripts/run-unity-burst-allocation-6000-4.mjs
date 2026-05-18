import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probe = path.join(root, "scripts", "run-unity-burst-allocation-probe.mjs");

const result = spawnSync(process.execPath, [probe], {
  stdio: "inherit",
  env: {
    ...process.env,
    UNITY_BURST_ALLOC_PROBE: "1",
    UNITY_BURST_REQUIRED_VERSION_PREFIX: "6000.4",
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
