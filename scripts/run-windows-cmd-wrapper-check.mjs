import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  return { ...process.env,
    CANONICALFS_DAEMON_URL: daemon.endpoint,
    CANONICALFS_DAEMON_TOKEN: token ?? "",
    WSLENV: [process.env.WSLENV, "CANONICALFS_DAEMON_URL/w", "CANONICALFS_DAEMON_TOKEN/w"].filter(Boolean).join(":"),
  };
}

function runWrapper(daemon, args, options = {}) {
  const payload = { op: args[0] };
  if (args[1] !== undefined) payload.project_id = args[1];
  if (args[0] === "open-project") payload.host_root = args[2];
  else if (args[2] !== undefined) payload.path = args[2];
  if (args[0] === "write-text") payload.text = args[3];
  if (args[0] === "read-text" && args[3] !== undefined) payload.max_bytes = Number(args[3]);
  if (args[0] === "rename") payload.target = args[3];
  const selectedWrapper = options.compat ? "canonicalpath.cmd" : "canonicalfs.cmd";
  const result = spawnSync("cmd.exe", ["/d", "/c", selectedWrapper], {
    cwd: options.wrapperDirectory ?? path.dirname(wrapper), input: JSON.stringify(payload), encoding: "utf8", timeout: 45000,
    env: wrapperEnv(daemon, options.token),
  });
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
    const marker = path.join(root, "tmp", `cmd-injection-${process.pid}.txt`);
    const hostile = `Привет 😀 %PATH% !value! ^ & | < > ( ) " & echo INJECTED>${wslpathIfAvailable(marker)} & rem "`;
    for (const compat of [false, true]) {
      runWrapper(daemon, ["write-text", projectId, "safe/file.txt", hostile], { compat });
      const roundTrip = runWrapper(daemon, ["read-text", projectId, "safe/file.txt", "4096"], { compat });
      if (roundTrip !== hostile || existsSync(marker)) throw new Error("CMD transport interpreted data as commands");
    }
    mkdirSync(path.join(root, "tmp"), { recursive: true });
    const installation = mkdtempSync(path.join(root, "tmp", "cmd-install-"));
    const unusualDirectory = path.join(installation, `cmd-wrapper %PATH% & (probe) ${process.pid}`);
    mkdirSync(unusualDirectory, { recursive: true });
    try {
      for (const file of ["canonicalfs.cmd", "canonicalpath.cmd", "canonicalfs.ps1"]) copyFileSync(path.join(path.dirname(wrapper), file), path.join(unusualDirectory, file));
      const transportDirectory = path.join(installation, "powershell", "CanonicalPath");
      mkdirSync(transportDirectory, { recursive: true });
      copyFileSync(path.join(root, "packages/powershell/CanonicalPath/DaemonClient.cs"), path.join(transportDirectory, "DaemonClient.cs"));
      for (const compat of [false, true]) {
        const value = runWrapper(daemon, ["read-text", projectId, "safe/file.txt", "4096"], { compat, wrapperDirectory: unusualDirectory });
        if (value !== hostile) throw new Error("CMD wrapper failed from a path containing shell metacharacters");
      }
    } finally { rmSync(installation, { recursive: true, force: true }); }

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
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wslpathIfAvailable(scriptPath)], {
      cwd: root, encoding: "utf8", env: wrapperEnv(daemon),
    });
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
  $payload = [ordered]@{ op=$Arguments[0] }
  if ($Arguments.Length -gt 1) { $payload.project_id=$Arguments[1] }
  if ($Arguments.Length -gt 2) { $payload.path=$Arguments[2] }
  if ($Arguments.Length -gt 3) { $payload.max_bytes=[long]$Arguments[3] }
  $OutputEncoding = New-Object Text.UTF8Encoding($false)
  Push-Location -LiteralPath ${psString(path.win32.dirname(wrapperPath))}
  try {
    ($payload | ConvertTo-Json -Compress) | & cmd.exe /d /c canonicalfs.cmd | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('wrapper command failed: ' + ($Arguments -join ' ')) }
  } finally { Pop-Location }
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

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function startDaemon() {
  const tempParent = mkdtempSync(path.join(tmpdir(), "canonicalfs-cmd-wrapper-"));
  const projectRoot = path.join(tempParent, "project");
  mkdirSync(projectRoot);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString("hex");
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
