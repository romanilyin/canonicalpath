import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(root, "packages", "windows-cmd-batch-wrapper", "canonicalfs.cmd");
const wrapperForWindows = wslpathIfAvailable(wrapper);
const allocationMode = process.argv.includes("--allocation");

if (!commandExists("cmd.exe", ["/c", "ver"])) {
  console.log("cmd.exe not found; skipping Windows CMD wrapper check");
  process.exit(0);
}
if (!commandExists("cmd.exe", ["/c", "curl.exe", "--version"])) {
  console.log("Windows curl.exe not found; skipping Windows CMD wrapper check");
  process.exit(0);
}
if (!commandExists("cmd.exe", ["/c", "powershell.exe", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])) {
  console.log("Windows PowerShell not found; skipping Windows CMD wrapper check");
  process.exit(0);
}
if (!commandExists("go", ["version"])) {
  console.log("Go command not found; skipping Windows CMD wrapper check");
  process.exit(0);
}

const daemon = await startDaemon();
try {
  if (allocationMode) {
    runAllocationCheck(daemon);
  } else {
    runSmokeCheck(daemon);
  }
} finally {
  await daemon.stop();
}

function commandExists(command, args) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

function wslpathIfAvailable(value) {
  if (process.platform !== "linux") return value;
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0) return value;
  return result.stdout.trim() || value;
}

function wrapperEnv(daemon, token = daemon.token) {
  return {
    url: daemon.endpoint,
    token,
    powershell: "powershell.exe",
  };
}

function runWrapper(daemon, args, options = {}) {
  const result = runCmdScript(wrapperScript(daemon, args, options.token));
  if (result.error) throw result.error;
  if (options.expectFailure) {
    if ((result.status ?? 1) === 0) throw new Error(`expected Windows CMD wrapper command to fail: ${args.join(" ")}`);
    return result;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Windows CMD wrapper command failed: ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result.stdout;
}

function wrapperScript(daemon, args, token = daemon.token) {
  const env = wrapperEnv(daemon, token);
  return cmdScript([
    cmdSet("CANONICALFS_DAEMON_URL", env.url),
    cmdSet("POWERSHELL", env.powershell),
    cmdSet("CANONICALFS_DAEMON_TOKEN", env.token ?? ""),
    `call ${cmdCommandPath(wrapperForWindows)} ${args.map(cmdArgument).join(" ")}`,
    "exit /b %ERRORLEVEL%",
  ]);
}

function runSmokeCheck(daemon) {
  const health = JSON.parse(runWrapper(daemon, ["health"], { token: undefined }));
  if (!health.ok) throw new Error("health response mismatch");

  const caps = JSON.parse(runWrapper(daemon, ["caps"]));
  if (!caps.auth_required || !caps.endpoints.includes("POST /v1/fs/readFile")) throw new Error("capabilities response mismatch");

  const unauthorized = runWrapper(daemon, ["caps"], { token: "wrong-token", expectFailure: true });
  if (!unauthorized.stderr.includes("ERR_UNAUTHORIZED")) throw new Error(`expected ERR_UNAUTHORIZED, got ${unauthorized.stderr}`);

  const projectId = `cmd-wrapper-smoke-${Math.random().toString(16).slice(2)}`;
  runWrapper(daemon, ["open-project", projectId, daemon.projectRoot]);
  try {
    runWrapper(daemon, ["mkdir-all", projectId, "safe"]);
    runWrapper(daemon, ["write-text", projectId, "safe/file.txt", "hello from cmd wrapper"]);
    const text = runWrapper(daemon, ["read-text", projectId, "safe/file.txt", "128"]);
    if (text !== "hello from cmd wrapper") throw new Error(`read text mismatch: ${text}`);

    const stat = JSON.parse(runWrapper(daemon, ["stat", projectId, "safe/file.txt"]));
    if (stat.is_directory || stat.size <= 0) throw new Error(`stat response mismatch: ${JSON.stringify(stat)}`);

    const outside = runWrapper(daemon, ["read-text", projectId, "../escape.txt", "64"], { expectFailure: true });
    if (!outside.stderr.includes("ERR_OUTSIDE_ROOT")) throw new Error(`expected ERR_OUTSIDE_ROOT, got ${outside.stderr}`);

    runWrapper(daemon, ["remove", projectId, "safe/file.txt"]);
  } finally {
    runWrapper(daemon, ["close-project", projectId]);
  }

  console.log("Windows CMD wrapper transport smoke passed");
}

function runAllocationCheck(daemon) {
  const tempRoot = path.join(root, "tmp", "windows-cmd-wrapper-allocation-check");
  const scriptPath = path.join(tempRoot, "allocation.ps1");
  const iterations = 5;
  const budgetBytes = 384 * 1024 * 1024;
  const projectId = `cmd-wrapper-alloc-${Math.random().toString(16).slice(2)}`;

  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  runWrapper(daemon, ["open-project", projectId, daemon.projectRoot]);
  try {
    runWrapper(daemon, ["mkdir-all", projectId, "safe"]);
    runWrapper(daemon, ["write-text", projectId, "safe/file.txt", "hello from cmd allocation check"]);

    writeFileSync(scriptPath, allocationScript(iterations, budgetBytes, wrapperForWindows, projectId), "utf8");
    const result = runCmdScript(allocationCommandScript(daemon, scriptPath));
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      throw new Error(`Windows CMD wrapper allocation loop failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }
    process.stdout.write(result.stdout);
  } finally {
    try {
      runWrapper(daemon, ["close-project", projectId]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function allocationScript(iterations, budgetBytes, wrapperPath, projectId) {
  return `
$ErrorActionPreference = 'Stop'
function Invoke-LocalGC { [GC]::Collect(); [GC]::WaitForPendingFinalizers(); [GC]::Collect() }
function Invoke-Wrapper([string[]]$Arguments) {
  & cmd.exe /c ${psString(wrapperPath)} @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('wrapper command failed: ' + ($Arguments -join ' ')) }
}
Write-Host ('Windows CMD wrapper allocation check running: ' + ${iterations} + ' iterations')

for ($warmup = 0; $warmup -lt 1; $warmup++) {
  Invoke-Wrapper @('health')
  Invoke-Wrapper @('caps')
  Invoke-Wrapper @('stat', ${psString(projectId)}, 'safe/file.txt')
  Invoke-Wrapper @('read-text', ${psString(projectId)}, 'safe/file.txt', '128')
}
Invoke-LocalGC
$before = [Diagnostics.Process]::GetCurrentProcess().PrivateMemorySize64
for ($index = 0; $index -lt ${iterations}; $index++) {
  Invoke-Wrapper @('health')
  Invoke-Wrapper @('caps')
  Invoke-Wrapper @('stat', ${psString(projectId)}, 'safe/file.txt')
  Invoke-Wrapper @('read-text', ${psString(projectId)}, 'safe/file.txt', '128')
}
Invoke-LocalGC
$after = [Diagnostics.Process]::GetCurrentProcess().PrivateMemorySize64
$delta = $after - $before
if ($delta -lt 0) { $delta = 0 }
if ($delta -gt ${budgetBytes}) { throw ('Windows CMD wrapper allocation check exceeded private bytes delta: ' + $delta + ' > ${budgetBytes}') }
Write-Host ('Windows CMD wrapper allocation check passed: private bytes delta ' + $delta + ' over ${iterations} iterations')
`;
}

function allocationCommandScript(daemon, scriptPath) {
  const env = wrapperEnv(daemon, daemon.token);
  return cmdScript([
    cmdSet("CANONICALFS_DAEMON_URL", env.url),
    cmdSet("POWERSHELL", env.powershell),
    cmdSet("CANONICALFS_DAEMON_TOKEN", env.token),
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${cmdCommandPath(wslpathIfAvailable(scriptPath))}`,
    "exit /b %ERRORLEVEL%",
  ]);
}

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function cmdQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function cmdCommandPath(value) {
  const text = String(value);
  return /\s/.test(text) ? cmdQuote(text) : text;
}

function cmdArgument(value) {
  const text = String(value);
  return /[\s&()<>|^]/.test(text) ? cmdQuote(text) : text;
}

function cmdSet(name, value) {
  return `set "${name}=${String(value).replaceAll('"', '""')}"`;
}

function cmdScript(lines) {
  return `@echo off\r\n${lines.join("\r\n")}\r\n`;
}

function runCmdScript(contents) {
  const tempParent = path.join(root, "tmp");
  mkdirSync(tempParent, { recursive: true });
  const tempRoot = mkdtempSync(path.join(tempParent, "windows-cmd-wrapper-invoke-"));
  const scriptPath = path.join(tempRoot, "invoke.cmd");
  writeFileSync(scriptPath, contents, "utf8");
  try {
    return spawnSync("cmd.exe", ["/d", "/c", wslpathIfAvailable(scriptPath)], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function startDaemon() {
  const tempParent = mkdtempSync(path.join(tmpdir(), "canonicalfs-cmd-wrapper-"));
  const projectRoot = path.join(tempParent, "project");
  mkdirSync(projectRoot);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const token = `cmd-wrapper-token-${Math.random().toString(16).slice(2)}`;
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
    if (child.exitCode !== null) throw new Error(`canonicalfs daemon exited early with code ${child.exitCode}: ${stderr()}`);
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
