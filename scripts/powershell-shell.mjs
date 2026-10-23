import { spawnSync } from "node:child_process";
import path from "node:path";

// Local checks use PowerShell 7 only. Legacy module coverage is an explicit CI
// choice, never a fallback or an automatic probe of Windows PowerShell.
export function selectPowerShells(args = [], {
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
  required = platform === "win32",
} = {}) {
  const requested = [];
  let allowWindowsPowerShell = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--" || argument === "--all-available") continue;
    if (argument === "--allow-windows-powershell") {
      allowWindowsPowerShell = true;
    } else if (argument === "--shell") {
      const shell = args[++index];
      if (!shell || shell.startsWith("--")) throw new Error("--shell requires an executable path");
      requested.push(shell);
    } else {
      throw new Error(`unknown PowerShell argument: ${argument}`);
    }
  }
  const configured = env.CANONICALPATH_POWERSHELL;
  const explicit = requested.length > 0 || configured !== undefined;
  if (configured !== undefined && !configured.trim()) throw new Error("CANONICALPATH_POWERSHELL must name a PowerShell 7 executable");
  const shells = requested.length > 0 ? requested : [configured ?? (platform === "win32"
    ? path.win32.join(env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe")
    : "pwsh")];
  const result = [];
  for (const shell of new Set(shells)) {
    if (/[\0\r\n"]/.test(shell)) throw new Error("Invalid PowerShell executable path");
    if (/^powershell(?:\.exe)?$/i.test(path.win32.basename(shell)) && !allowWindowsPowerShell) {
      throw new Error("Windows PowerShell requires an explicit --allow-windows-powershell CI opt-in");
    }
    const probe = spawn(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "@{ Major = $PSVersionTable.PSVersion.Major; Minor = $PSVersionTable.PSVersion.Minor; Edition = $PSVersionTable.PSEdition } | ConvertTo-Json -Compress"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 15000 });
    if (!explicit && !required && probe.error?.code === "ENOENT") continue;
    if (probe.error || probe.status !== 0) throw new Error(`PowerShell command not found or unusable: ${shell}`);
    let version;
    try { version = JSON.parse(probe.stdout.trim().replace(/^\uFEFF/, "")); }
    catch { throw new Error(`Cannot verify PowerShell version and edition: ${shell}`); }
    const modern = version.Major >= 7 && version.Edition === "Core";
    const legacy = allowWindowsPowerShell && version.Major === 5 && version.Minor === 1 && version.Edition === "Desktop";
    if (!modern && !legacy) throw new Error(`PowerShell 7/Core is required: ${shell}`);
    result.push(shell);
  }
  return result;
}
