import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(root, "packages", "bash-wrapper", "canonicalfs.sh");
const allocationMode = process.argv.includes("--allocation");

if (!commandExists("bash", ["--version"])) {
  console.log("bash not found; skipping Bash wrapper check");
  process.exit(0);
}
if (!commandExists("curl", ["--version"])) {
  console.log("curl not found; skipping Bash wrapper check");
  process.exit(0);
}
if (!commandExists("python3", ["--version"])) {
  console.log("python3 not found; skipping Bash wrapper check");
  process.exit(0);
}
if (!commandExists("go", ["version"])) {
  console.log("Go command not found; skipping Bash wrapper check");
  process.exit(0);
}
if (allocationMode && !commandExists("/usr/bin/time", ["--version"])) {
  console.log("/usr/bin/time not found; skipping Bash wrapper allocation check");
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

function wrapperEnv(daemon, token = daemon.token) {
  const env = {
    ...process.env,
    CANONICALFS_DAEMON_URL: daemon.endpoint,
    PYTHON: "python3",
  };
  if (token !== undefined) env.CANONICALFS_DAEMON_TOKEN = token;
  return env;
}

function runWrapper(daemon, args, options = {}) {
  const result = spawnSync("bash", [wrapper, ...args], {
    cwd: root,
    encoding: "utf8",
    env: wrapperEnv(daemon, options.token),
  });
  if (result.error) throw result.error;
  if (options.expectFailure) {
    if ((result.status ?? 1) === 0) throw new Error(`expected Bash wrapper command to fail: ${args.join(" ")}`);
    return result;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Bash wrapper command failed: ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
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

  const projectId = `bash-wrapper-smoke-${Math.random().toString(16).slice(2)}`;
  runWrapper(daemon, ["open-project", projectId, daemon.projectRoot]);
  try {
    runWrapper(daemon, ["mkdir-all", projectId, "safe"]);
    runWrapper(daemon, ["write-text", projectId, "safe/file.txt", "hello from bash wrapper"]);
    const text = runWrapper(daemon, ["read-text", projectId, "safe/file.txt", "128"]);
    if (text !== "hello from bash wrapper") throw new Error(`read text mismatch: ${text}`);

    const stat = JSON.parse(runWrapper(daemon, ["stat", projectId, "safe/file.txt"]));
    if (stat.is_directory || stat.size <= 0) throw new Error(`stat response mismatch: ${JSON.stringify(stat)}`);

    const outside = runWrapper(daemon, ["read-text", projectId, "../escape.txt", "64"], { expectFailure: true });
    if (!outside.stderr.includes("ERR_OUTSIDE_ROOT")) throw new Error(`expected ERR_OUTSIDE_ROOT, got ${outside.stderr}`);

    runWrapper(daemon, ["remove", projectId, "safe/file.txt"]);
  } finally {
    runWrapper(daemon, ["close-project", projectId]);
  }

  console.log("Bash wrapper transport smoke passed");
}

function runAllocationCheck(daemon) {
  const tempRoot = path.join(root, "tmp", "bash-wrapper-allocation-check");
  const loopPath = path.join(tempRoot, "loop.sh");
  const iterations = 150;
  const budgetKb = 200000;
  const projectId = `bash-wrapper-alloc-${Math.random().toString(16).slice(2)}`;

  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  runWrapper(daemon, ["open-project", projectId, daemon.projectRoot]);
  try {
    runWrapper(daemon, ["mkdir-all", projectId, "safe"]);
    runWrapper(daemon, ["write-text", projectId, "safe/file.txt", "hello from bash allocation check"]);

    writeFileSync(loopPath, allocationLoop(iterations, projectId), "utf8");
    const result = spawnSync("/usr/bin/time", ["-f", "MAX_RSS_KB=%M", "bash", loopPath], {
      cwd: root,
      encoding: "utf8",
      env: wrapperEnv(daemon),
    });
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      throw new Error(`Bash wrapper allocation loop failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }
    const match = result.stderr.match(/MAX_RSS_KB=(\d+)/);
    if (!match) throw new Error(`could not parse max RSS from /usr/bin/time output: ${result.stderr}`);
    const maxRssKb = Number(match[1]);
    if (maxRssKb > budgetKb) throw new Error(`Bash wrapper allocation check exceeded max RSS budget: ${maxRssKb} KB > ${budgetKb} KB`);
    console.log(`Bash wrapper allocation check passed: max RSS ${maxRssKb} KB over ${iterations} iterations`);
  } finally {
    try {
      runWrapper(daemon, ["close-project", projectId]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function allocationLoop(iterations, projectId) {
  return `#!/usr/bin/env bash
set -euo pipefail
for ((index = 0; index < ${iterations}; index++)); do
  bash ${shellQuote(wrapper)} health >/dev/null
  bash ${shellQuote(wrapper)} caps >/dev/null
  bash ${shellQuote(wrapper)} stat ${shellQuote(projectId)} safe/file.txt >/dev/null
  bash ${shellQuote(wrapper)} read-text ${shellQuote(projectId)} safe/file.txt 128 >/dev/null
done
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function startDaemon() {
  const tempParent = mkdtempSync(path.join(tmpdir(), "canonicalfs-bash-wrapper-"));
  const projectRoot = path.join(tempParent, "project");
  mkdirSync(projectRoot);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const token = `bash-wrapper-token-${Math.random().toString(16).slice(2)}`;
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
