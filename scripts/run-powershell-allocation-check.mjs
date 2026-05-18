import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkScript = path.join(root, "scripts/check-powershell-allocations.ps1");

const requestedShells = parseShells(process.argv.slice(2));
const shells = requestedShells ?? firstAvailableList(["pwsh", "powershell.exe"], false);
if (shells.length === 0) {
  console.log("PowerShell not found; skipping CanonicalPath PowerShell allocation check");
  process.exit(0);
}

for (const shell of shells) {
  console.log(`Running CanonicalPath PowerShell allocation check with ${shell}`);
  const useWindowsPowerShellFromWSL = process.platform === "linux" && shell === "powershell.exe";
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

function parseShells(args) {
  if (args.length === 0) return undefined;
  const shells = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--all-available") return firstAvailableList(["powershell.exe", "pwsh"], true);
    if (arg === "--shell") {
      const shell = args[++i];
      if (!shell) throw new Error("--shell requires a command");
      shells.push(shell);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  for (const shell of shells) {
    if (!commandExists(shell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])) {
      throw new Error(`PowerShell command not found or unusable: ${shell}`);
    }
  }
  return shells;
}

function firstAvailableList(commands, includeAll) {
  const available = [];
  for (const command of commands) {
    if (commandExists(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])) {
      available.push(command);
      if (!includeAll) break;
    }
  }
  return available;
}

function commandExists(command, args) {
  const probe = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return !probe.error && probe.status === 0;
}

function wslpath(value) {
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0) return value;
  const converted = result.stdout.trim();
  return existsSync(value) && converted ? converted : value;
}
