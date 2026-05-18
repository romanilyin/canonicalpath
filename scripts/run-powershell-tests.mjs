import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testScripts = [
  path.join(root, "packages/powershell/CanonicalPath/test/CanonicalPath.Tests.ps1"),
  path.join(root, "packages/powershell/CanonicalPath/test/CanonicalFSDaemonClient.Smoke.ps1"),
];

const requestedShells = parseShells(process.argv.slice(2));
const shells = requestedShells ?? firstAvailableList(["pwsh", "powershell.exe"], false);
if (shells.length === 0) {
  console.log("PowerShell not found; skipping CanonicalPath PowerShell tests");
  process.exit(0);
}

for (const shell of shells) {
  console.log(`Running CanonicalPath PowerShell tests with ${shell}`);
  const useWindowsPowerShellFromWSL = process.platform === "linux" && shell === "powershell.exe";
  const repoRoot = useWindowsPowerShellFromWSL ? wslpath(root) : root;
  for (const testScript of testScripts) {
    const extraArgs = [];
    let externalDaemon;
    if (useWindowsPowerShellFromWSL && testScript.endsWith("CanonicalFSDaemonClient.Smoke.ps1") && commandExists("go", ["version"])) {
      externalDaemon = await startDaemonForWindowsPowerShell();
      extraArgs.push("-Endpoint", externalDaemon.endpoint, "-Token", externalDaemon.token, "-HostRoot", externalDaemon.projectRoot);
    }

    const scriptPath = useWindowsPowerShellFromWSL ? wslpath(testScript) : testScript;
    const result = spawnSync(
      shell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-RepoRoot", repoRoot, ...extraArgs],
      { stdio: "inherit" },
    );

    if (externalDaemon) {
      await externalDaemon.stop();
    }

    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}
process.exit(0);

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

async function startDaemonForWindowsPowerShell() {
  const tempParent = mkdtempSync(path.join(tmpdir(), "canonicalfs-ps-smoke-"));
  const projectRoot = path.join(tempParent, "project");
  mkdirSync(projectRoot);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const token = `ps-smoke-token-${Math.random().toString(16).slice(2)}`;
  const child = spawn("go", ["run", "./packages/go/cmd/canonicalfs-daemon", "-listen", `127.0.0.1:${port}`, "-allow-root", projectRoot], {
    cwd: root,
    env: { ...process.env, CANONICALFS_DAEMON_TOKEN: token },
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(endpoint, child, () => stderr);
  } catch (error) {
    await stopProcessTree(child);
    rmSync(tempParent, { recursive: true, force: true });
    throw error;
  }

  return {
    endpoint,
    token,
    projectRoot,
    async stop() {
      await stopProcessTree(child);
      rmSync(tempParent, { recursive: true, force: true });
    },
  };
}

async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process already exited.
      }
    }
  }
  await waitForExit(child, 2000);
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  }
  await waitForExit(child, 2000);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(endpoint, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`canonicalfs daemon exited early with code ${child.exitCode}: ${stderr()}`);
    }
    try {
      const response = await fetch(`${endpoint}/healthz`);
      if (response.ok) return;
    } catch {
      // Retry until the Go daemon is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("canonicalfs daemon did not become healthy");
}
