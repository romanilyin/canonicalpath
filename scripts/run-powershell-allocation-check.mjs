import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectPowerShells } from "./powershell-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkScript = path.join(root, "scripts/check-powershell-allocations.ps1");

const shells = selectPowerShells(process.argv.slice(2));
if (shells.length === 0) {
  console.log("PowerShell 7 not found; skipping CanonicalPath PowerShell allocation check");
  process.exit(0);
}

for (const shell of shells) {
  console.log(`Running CanonicalPath PowerShell allocation check with ${shell}`);
  const useWindowsPowerShellFromWSL = process.platform === "linux" && /(?:powershell|pwsh)\.exe$/i.test(shell);
  const repoRoot = useWindowsPowerShellFromWSL ? wslpath(root) : root;
  const scriptPath = useWindowsPowerShellFromWSL ? wslpath(checkScript) : checkScript;
  const result = spawnSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-RepoRoot", repoRoot],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function wslpath(value) {
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0) return value;
  const converted = result.stdout.trim();
  return existsSync(value) && converted ? converted : value;
}
