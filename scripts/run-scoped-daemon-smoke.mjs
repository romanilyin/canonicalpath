import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!commandExists("go", ["version"])) {
  console.log("Go command not found; skipping scoped daemon smoke");
  process.exit(0);
}

const daemon = await startDaemon();
try {
  await expectError("ERR_UNAUTHORIZED", () => request(daemon, "GET", "/v1/caps", undefined, "wrong-token"));

  const caps = await requestOK(daemon, "GET", "/v1/caps");
  for (const endpoint of ["POST /v1/scoped/readFile", "POST /v1/scoped/writeFile", "POST /v1/scoped/stat", "POST /v1/scoped/mkdirAll", "POST /v1/scoped/remove"]) {
    if (!caps.endpoints.includes(endpoint)) throw new Error(`caps missing ${endpoint}`);
  }

  await expectError("ERR_ROOT_NOT_ALLOWED", () =>
    request(daemon, "POST", "/v1/projects/open", { project_id: "evil", host_root: daemon.siblingRoot }),
  );

  await requestOK(daemon, "POST", "/v1/projects/open", { project_id: "project-1", host_root: daemon.projectRoot });

  await requestOK(daemon, "POST", "/v1/scoped/mkdirAll", scoped("knowledge", "write", "notes"));
  await requestOK(daemon, "POST", "/v1/scoped/writeFile", scoped("knowledge", "write", "notes/agent.md", "scoped knowledge"));
  const knowledge = await requestOK(daemon, "POST", "/v1/scoped/readFile", { ...scoped("knowledge", "read", "notes/agent.md"), max_bytes: 128 });
  if (fromBase64(knowledge.data_base64) !== "scoped knowledge") throw new Error("scoped knowledge read mismatch");

  const knowledgeStat = await requestOK(daemon, "POST", "/v1/scoped/stat", scoped("knowledge", "read", "notes/agent.md"));
  if (knowledgeStat.stat.path !== "Assets/UnityMcpKnowledge/notes/agent.md" || knowledgeStat.stat.is_directory || knowledgeStat.stat.size <= 0) {
    throw new Error(`unexpected knowledge stat: ${JSON.stringify(knowledgeStat.stat)}`);
  }

  await requestOK(daemon, "POST", "/v1/scoped/mkdirAll", scoped("artifact", "write", "job-artifacts/run-1"));
  await requestOK(daemon, "POST", "/v1/scoped/writeFile", scoped("artifact", "write", "job-artifacts/run-1/summary.json", "{}"));
  const artifactStat = await requestOK(daemon, "POST", "/v1/scoped/stat", scoped("artifact", "read", "job-artifacts/run-1/summary.json"));
  if (artifactStat.stat.path !== "Library/SGGUnityMcp/job-artifacts/run-1/summary.json") {
    throw new Error(`unexpected artifact stat path: ${artifactStat.stat.path}`);
  }

  await requestOK(daemon, "POST", "/v1/scoped/writeFile", scoped("package_manifest", "write", "Packages/manifest.json", "{}"));
  const manifestStat = await requestOK(daemon, "POST", "/v1/scoped/stat", scoped("package_manifest", "read", "Packages/manifest.json"));
  if (manifestStat.stat.path !== "Packages/manifest.json") throw new Error(`unexpected manifest stat path: ${manifestStat.stat.path}`);

  await requestOK(daemon, "POST", "/v1/scoped/mkdirAll", scoped("temp_session", "write", "session-1"));
  await requestOK(daemon, "POST", "/v1/scoped/writeFile", scoped("temp_session", "write", "session-1/delete.txt", "delete"));
  await requestOK(daemon, "POST", "/v1/scoped/remove", scoped("temp_session", "delete", "session-1/delete.txt"));

  await expectError("ERR_UNSUPPORTED_OPERATION", () => request(daemon, "POST", "/v1/scoped/readFile", { ...scoped("knowledge", "write", "notes/agent.md"), max_bytes: 128 }));
  await expectError("ERR_UNSUPPORTED_OPERATION", () => request(daemon, "POST", "/v1/scoped/readFile", { ...scoped("gateway_cache", "read", "index/key.json"), max_bytes: 128 }));
  await expectError("ERR_OUTSIDE_ROOT", () => request(daemon, "POST", "/v1/scoped/readFile", { ...scoped("knowledge", "read", "../agent.md"), max_bytes: 128 }));
  await expectError("ERR_ENCODED_SEPARATOR", () => request(daemon, "POST", "/v1/scoped/readFile", { ...scoped("knowledge", "read", "notes%2Fagent.md"), max_bytes: 128 }));
  await expectError("ERR_INVALID_PATH", () => request(daemon, "POST", "/v1/scoped/readFile", { ...scoped("unknown", "read", "agent.md"), max_bytes: 128 }));

  await requestOK(daemon, "POST", "/v1/projects/close", { project_id: "project-1" });
  console.log("Scoped daemon smoke passed");
} finally {
  await daemon.stop();
}

function scoped(scope, operation, rawPath, text) {
  const payload = { project_id: "project-1", scope, operation, path: rawPath };
  if (text !== undefined) payload.data_base64 = Buffer.from(text, "utf8").toString("base64");
  return payload;
}

async function requestOK(daemon, method, urlPath, body) {
  const response = await request(daemon, method, urlPath, body);
  if (response.error) throw new Error(`unexpected ${response.error.code}: ${response.error.message}`);
  return response;
}

async function expectError(code, action) {
  const response = await action();
  if (response.error?.code === code) return;
  throw new Error(`expected ${code}, got ${JSON.stringify(response.error)}`);
}

async function request(daemon, method, urlPath, body, token = daemon.token) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${daemon.endpoint}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`daemon returned non-JSON response: ${response.status} ${response.statusText}`, { cause: error });
  }
  if (!response.ok && !payload.error) throw new Error(`daemon HTTP ${response.status} without error envelope`);
  return payload;
}

function fromBase64(value) {
  return Buffer.from(value ?? "", "base64").toString("utf8");
}

async function startDaemon() {
  const tempParent = mkdtempSync(path.join(tmpdir(), "canonicalfs-scoped-smoke-"));
  const projectRoot = path.join(tempParent, "project");
  const siblingRoot = path.join(tempParent, "project-evil");
  mkdirSync(path.join(projectRoot, "Packages"), { recursive: true });
  mkdirSync(siblingRoot);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const token = `scoped-daemon-smoke-${Math.random().toString(16).slice(2)}`;
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
    siblingRoot,
    async stop() {
      await stopProcessTree(child);
      rmSync(tempParent, { recursive: true, force: true });
    },
  };
}

async function waitForHealth(endpoint, child, stderr) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`canonicalfs daemon exited early with ${child.exitCode}: ${stderr()}`);
    try {
      const response = await fetch(`${endpoint}/healthz`);
      if (response.ok) return;
    } catch {
      // Retry until the daemon starts listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for canonicalfs daemon: ${stderr()}`);
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
      server.close(() => {
        if (!address || typeof address === "string") reject(new Error("failed to reserve TCP port"));
        else resolve(address.port);
      });
    });
  });
}

function commandExists(command, args) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}
