import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "unity-canonicalfs-transport-smoke");
const projectPath = path.join(tempRoot, "CanonicalPath.Unity.TransportSmoke.csproj");
const programPath = path.join(tempRoot, "Program.cs");

const dotnet = findDotnet();
if (!dotnet) {
  console.log("dotnet not found; skipping Unity CanonicalFS transport smoke");
  process.exit(0);
}
if (!commandExists("go", ["version"])) {
  console.log("Go command not found; skipping Unity CanonicalFS transport smoke");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(projectPath, projectFile(), "utf8");
writeFileSync(programPath, programFile(), "utf8");

const daemon = await startDaemon();
try {
  const result = spawnSync(
    dotnet.command,
    [...dotnet.prefixArgs, "run", "-c", "Release", "--project", dotnet.nativePath(projectPath), "--", daemon.endpoint, daemon.token, daemon.projectRoot],
    { stdio: "inherit" },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
} finally {
  await daemon.stop();
}

function findDotnet() {
  if (commandExists("dotnet", ["--info"])) return { command: "dotnet", prefixArgs: [], nativePath: (value) => value };
  if (commandExists("dotnet.exe", ["--info"])) return { command: "dotnet.exe", prefixArgs: [], nativePath: wslpathIfAvailable };
  if (process.platform === "linux" && commandExists("cmd.exe", ["/c", "dotnet", "--info"])) {
    return { command: "cmd.exe", prefixArgs: ["/c", "dotnet"], nativePath: wslpathIfAvailable };
  }
  return undefined;
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

function projectFile() {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>disable</Nullable>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="../../packages/unity/Runtime/CanonicalPath.cs" Link="CanonicalPath.cs" />
    <Compile Include="../../packages/unity/Runtime/CanonicalPathHttpClient.cs" Link="CanonicalPathHttpClient.cs" />
  </ItemGroup>
</Project>
`;
}

function programFile() {
  return String.raw`using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CanonicalPath;

internal static class Program
{
    private static int Main(string[] args)
    {
        Run(args).GetAwaiter().GetResult();
        return 0;
    }

    private static async Task Run(string[] args)
    {
        if (args.Length != 3) throw new ArgumentException("Expected endpoint, token, and hostRoot.");
        string endpoint = args[0];
        string token = args[1];
        string hostRoot = args[2];

        using (CancellationTokenSource timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
        using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri(endpoint), token))
        {
            CancellationToken cancellationToken = timeout.Token;
            if (!await client.HealthAsync(cancellationToken)) throw new InvalidOperationException("daemon health check failed");
            CanonicalFSDaemonCapabilities caps = await client.CapabilitiesAsync(cancellationToken);
            if (!caps.AuthRequired) throw new InvalidOperationException("expected daemon auth to be required");
            if (caps.Endpoints == null || !caps.Endpoints.Contains("POST /v1/fs/readFile")) throw new InvalidOperationException("caps missing readFile endpoint");
            if (!caps.Endpoints.Contains("POST /v1/scoped/readFile")) throw new InvalidOperationException("caps missing scoped readFile endpoint");

            await client.OpenProjectAsync("unity-project", hostRoot, cancellationToken);
            await client.MkdirAllAsync("unity-project", "safe", cancellationToken);
            await client.WriteTextAsync("unity-project", "safe/file.txt", "hello from unity csharp", cancellationToken);
            string text = await client.ReadTextAsync("unity-project", "safe/file.txt", 128, cancellationToken);
            if (text != "hello from unity csharp") throw new InvalidOperationException("read text mismatch");

            CanonicalFSFileStat stat = await client.StatAsync("unity-project", "safe/file.txt", cancellationToken);
            if (stat.IsDirectory || stat.Size <= 0) throw new InvalidOperationException("stat response mismatch");

            await client.MkdirAllScopedAsync("unity-project", UnityMcpPathScope.Knowledge, "notes", cancellationToken);
            await client.WriteScopedTextAsync("unity-project", UnityMcpPathScope.Knowledge, "notes/agent.md", "scoped knowledge", cancellationToken);
            string scopedText = await client.ReadScopedTextAsync("unity-project", UnityMcpPathScope.Knowledge, "notes/agent.md", 128, cancellationToken);
            if (scopedText != "scoped knowledge") throw new InvalidOperationException("scoped read text mismatch");

            CanonicalFSFileStat scopedStat = await client.StatScopedAsync("unity-project", UnityMcpPathScope.Knowledge, "notes/agent.md", cancellationToken);
            if (scopedStat.Path != "Assets/UnityMcpKnowledge/notes/agent.md" || scopedStat.IsDirectory || scopedStat.Size <= 0) throw new InvalidOperationException("scoped stat response mismatch");

            await client.MkdirAllScopedAsync("unity-project", UnityMcpPathScope.TempSession, "session-1", cancellationToken);
            await client.WriteScopedTextAsync("unity-project", UnityMcpPathScope.TempSession, "session-1/delete.txt", "delete", cancellationToken);
            await client.RemoveScopedAsync("unity-project", UnityMcpPathScope.TempSession, "session-1/delete.txt", cancellationToken);

            await ExpectError("ERR_UNSUPPORTED_OPERATION", async () => await client.ReadScopedTextAsync("unity-project", UnityMcpPathScope.GatewayCache, "index/key.json", 64, cancellationToken));
            await ExpectError("ERR_OUTSIDE_ROOT", async () => await client.ReadScopedTextAsync("unity-project", UnityMcpPathScope.Knowledge, "../escape.md", 64, cancellationToken));

            await client.RenameAsync("unity-project", "safe/file.txt", "safe/file-renamed.txt", cancellationToken);
            string renamed = await client.ReadTextAsync("unity-project", "safe/file-renamed.txt", 128, cancellationToken);
            if (renamed != "hello from unity csharp") throw new InvalidOperationException("renamed read text mismatch");

            await ExpectError("ERR_OUTSIDE_ROOT", async () => await client.ReadTextAsync("unity-project", "../escape.txt", 64, cancellationToken));
            await client.RemoveAsync("unity-project", "safe/file-renamed.txt", cancellationToken);
            await client.CloseProjectAsync("unity-project", cancellationToken);
        }

        using (CancellationTokenSource timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
        using (CanonicalFSDaemonHttpClient unauthorized = new CanonicalFSDaemonHttpClient(new Uri(endpoint), "wrong-token"))
        {
            await ExpectError("ERR_UNAUTHORIZED", async () => await unauthorized.CapabilitiesAsync(timeout.Token));
        }

        Console.WriteLine("Unity CanonicalFS C# transport smoke passed");
    }

    private static async Task ExpectError(string code, Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (CanonicalFSDaemonException ex)
        {
            if (ex.Code == code) return;
            throw new InvalidOperationException("expected " + code + ", got " + ex.Code, ex);
        }
        throw new InvalidOperationException("expected " + code + " error");
    }
}
`;
}

async function startDaemon() {
  const tempParent = mkdtempSync(path.join(tmpdir(), "canonicalfs-unity-transport-"));
  const projectRoot = path.join(tempParent, "project");
  mkdirSync(projectRoot);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const token = `unity-transport-token-${Math.random().toString(16).slice(2)}`;
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
