import { createTlsFixture, tlsFetch } from "./tls-test-fixture.mjs";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectPowerShells } from "./powershell-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testScripts = [
  path.join(root, "packages/powershell/CanonicalPath/test/CanonicalPath.Tests.ps1"),
  path.join(root, "packages/powershell/CanonicalPath/test/CanonicalFSDaemonClient.Smoke.ps1"),
];

const shells = selectPowerShells(process.argv.slice(2));
if (shells.length === 0) {
  console.log("PowerShell 7 not found; skipping CanonicalPath PowerShell tests");
  process.exit(0);
}

for (const shell of shells) {
  console.log(`Running CanonicalPath PowerShell tests with ${shell}`);
  const useWindowsPowerShellFromWSL = process.platform === "linux" && /(?:powershell|pwsh)\.exe$/i.test(shell);
  const repoRoot = useWindowsPowerShellFromWSL ? wslpath(root) : root;
  for (const testScript of testScripts) {
    const extraArgs = [];
    let externalDaemon;
    if (testScript.endsWith("CanonicalFSDaemonClient.Smoke.ps1") && commandExists("go", ["version"])) {
      externalDaemon = await startDaemonForWindowsPowerShell();
      extraArgs.push("-Endpoint", externalDaemon.endpoint, "-Token", externalDaemon.token, "-HostRoot", externalDaemon.projectRoot);
    }

    let result;
    try {
      const scriptPath = useWindowsPowerShellFromWSL ? wslpath(testScript) : testScript;
      result = spawnSync(
        shell,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-RepoRoot", repoRoot, ...extraArgs],
        { stdio: "inherit", env: externalDaemon ? {
          ...process.env, ...externalDaemon.tlsFixture.env,
          CANONICALFS_TLS_CA_FILE: useWindowsPowerShellFromWSL ? wslpath(externalDaemon.tlsFixture.certFile) : externalDaemon.tlsFixture.certFile,
          WSLENV: [process.env.WSLENV, "CANONICALFS_TLS_CA_FILE/w", "CANONICALFS_TLS_CERTIFICATE_SHA256/w"].filter(Boolean).join(":"),
        } : process.env },
      );
    } finally {
      if (externalDaemon) await externalDaemon.stop();
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
  let child;
  let tls;
  async function stop() {
    try {
      if (child) await stopProcessTree(child);
    } finally {
      try { tls?.dispose(); }
      finally { rmSync(tempParent, { recursive: true, force: true }); }
    }
  }

  try {
    const projectRoot = path.join(tempParent, "project");
    mkdirSync(projectRoot);
    const daemonPath = path.join(tempParent, process.platform === "win32" ? "canonicalfs-daemon.exe" : "canonicalfs-daemon");
    // A cold Go build must finish before the daemon health retry budget starts.
    const buildStarted = Date.now();
    console.log("Building canonicalfs daemon for PowerShell smoke");
    const build = spawnSync("go", ["build", "-o", daemonPath, "./packages/go/cmd/canonicalfs-daemon"], {
      cwd: root, stdio: ["ignore", "inherit", "inherit"], windowsHide: true,
    });
    if (build.error) throw new Error(`canonicalfs daemon build failed: ${build.error.message}`, { cause: build.error });
    if (build.status !== 0) throw new Error(`canonicalfs daemon build failed with ${build.signal ? `signal ${build.signal}` : `code ${build.status}`}`);
    console.log(`Built canonicalfs daemon in ${Date.now() - buildStarted} ms`);

    const port = await freePort();
    tls = createTlsFixture();
    const endpoint = `https://127.0.0.1:${port}`;
    const token = randomBytes(32).toString("hex");
    child = spawn(daemonPath, ["-listen", `127.0.0.1:${port}`, ...tls.daemonArgs, "-allow-root", projectRoot], {
      cwd: root,
      env: { ...process.env, CANONICALFS_DAEMON_TOKEN: token },
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await waitForHealth(endpoint, child, () => stderr, tls);
    return { endpoint, tlsFixture: tls, token, projectRoot, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
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
  if (child.exitCode !== null || child.signalCode !== null) return;
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
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
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

async function waitForHealth(endpoint, child, stderr, tls) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`canonicalfs daemon exited early with ${child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`}: ${stderr()}`);
    }
    try {
      const response = await tlsFetch(`${endpoint}/healthz`, {}, tls);
      if (response.ok) return;
    } catch {
      // Retry until the Go daemon is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`canonicalfs daemon did not become healthy: ${stderr()}`);
}
