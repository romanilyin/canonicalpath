import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { createServer as createPlainServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createTlsFixture } from "./tls-test-fixture.mjs";
import { selectPowerShells } from "./powershell-shell.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
const available = (command, args) => spawnSync(command, args, { stdio: "ignore", windowsHide: true }).status === 0;
const shells = selectPowerShells();
const hasBash = process.platform !== "win32" && available("bash", ["--version"]) && available("curl", ["--version"]) && available("python3", ["--version"]);
const dotnet = findDotnet();
const windowsEnvironmentNames = [
  "CANONICALFS_DAEMON_URL", "CANONICALFS_DAEMON_TOKEN", "CANONICALFS_TLS_CA_FILE",
  "CANONICALFS_TLS_CERTIFICATE_SHA256", "CANONICALFS_TLS_PUBLIC_KEY_PIN",
  "CANONICALFS_MAX_RESPONSE_BYTES", "CANONICALFS_TIMEOUT_MILLISECONDS",
];

function windowsPath(value) {
  if (process.platform !== "linux") return value;
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Cannot convert test path for Windows interop: ${value}`);
  }
  return result.stdout.trim();
}

function windowsEnvironment(env, interop) {
  if (!interop) return env;
  const result = { ...env };
  if (result.CANONICALFS_TLS_CA_FILE) result.CANONICALFS_TLS_CA_FILE = windowsPath(result.CANONICALFS_TLS_CA_FILE);
  const controlled = new Set(windowsEnvironmentNames);
  const inherited = (env.WSLENV || "").split(":").filter(entry => entry && !controlled.has(entry.split("/")[0].toUpperCase()));
  for (const name of windowsEnvironmentNames) {
    // Preserve negative cases even if Windows already has daemon credentials or trust configured.
    if (result[name] === undefined) result[name] = "";
  }
  // Paths were translated explicitly above: /p here would translate them a second time.
  result.WSLENV = [...inherited, ...windowsEnvironmentNames.map(name => `${name}/w`)].join(":");
  return result;
}

function findDotnet() {
  // Match the discovery order used by the existing C# vector and Unity runners.
  if (available("dotnet", ["--info"])) return { command: "dotnet", prefixArgs: [], nativePath: value => value, interop: false };
  if (available("dotnet.exe", ["--info"])) return { command: "dotnet.exe", prefixArgs: [], nativePath: windowsPath, interop: process.platform === "linux" };
  if (process.platform === "linux" && available("cmd.exe", ["/d", "/c", "dotnet", "--info"])) {
    return { command: "cmd.exe", prefixArgs: ["/d", "/c", "dotnet"], nativePath: windowsPath, interop: true };
  }
  return undefined;
}

async function listener(tls, action) {
  const received = [];
  const handler = (request, response) => { received.push(request.headers.authorization); request.resume(); response.end("{}"); };
  const server = tls ? createServer({ cert: tls.cert, key: tls.key }, handler) : createPlainServer(handler);
  server.on("tlsClientError", () => {});
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await action(`${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`, received); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

async function failuresAndSuccess(invoke) {
  const trusted = createTlsFixture();
  const wrongName = createTlsFixture({ subjectAltName: "DNS:wrong.invalid" });
  try {
    for (const mode of ["valid", "http", "missing-pin", "wrong-pin", "untrusted-ca", "wrong-hostname"]) {
      const tls = mode === "wrong-hostname" ? wrongName : trusted;
      await listener(mode === "http" ? undefined : tls, async (endpoint, received) => {
        const env = { ...process.env, ...tls.env, CANONICALFS_DAEMON_URL: endpoint, CANONICALFS_DAEMON_TOKEN: "tls-regression-private-bearer" };
        if (mode === "missing-pin") { delete env.CANONICALFS_TLS_CERTIFICATE_SHA256; delete env.CANONICALFS_TLS_PUBLIC_KEY_PIN; }
        if (mode === "wrong-pin") { env.CANONICALFS_TLS_CERTIFICATE_SHA256 = "0".repeat(64); env.CANONICALFS_TLS_PUBLIC_KEY_PIN = "sha256//" + "A".repeat(43) + "="; }
        if (mode === "untrusted-ca") delete env.CANONICALFS_TLS_CA_FILE;
        const result = await invoke(env);
        assert.equal(result.code === 0, mode === "valid", `${mode}: ${result.stderr || result.stdout}`);
        assert.deepEqual(received, mode === "valid" ? ["Bearer tls-regression-private-bearer"] : [], `${mode}: unauthenticated peer received HTTP headers`);
        assert.ok(!(result.stdout + result.stderr).includes("tls-regression-private-bearer"), "bearer appeared in diagnostics");
      });
    }
  } finally { trusted.dispose(); wrongName.dispose(); }
}

async function connectionPoolKeepsTrustIsolated(invoke) {
  const tls = createTlsFixture();
  try {
    await listener(tls, async (endpoint, received) => {
      const env = { ...process.env, ...tls.env, CANONICALFS_DAEMON_URL: endpoint, CANONICALFS_DAEMON_TOKEN: "tls-regression-private-bearer" };
      const result = await invoke(env);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /accepted/);
      assert.deepEqual(received, ["Bearer tls-regression-private-bearer"], "a fresh wrong-pin client reused a connection authenticated under the previous client's pin");
      assert.ok(!(result.stdout + result.stderr).includes("tls-regression-private-bearer"), "bearer appeared in diagnostics");
    });
  } finally { tls.dispose(); }
}

const resultOf = promise => promise.then(value => ({ ...value, code: 0 }), error => ({ stdout: error.stdout || "", stderr: error.stderr || "", code: error.code ?? 1 }));

test("Bash authenticates TLS before bearer, including loopback", { skip: !hasBash, timeout: 30000 }, async () => {
  await failuresAndSuccess(env => resultOf(run("bash", [path.join(root, "packages/bash-wrapper/canonicalfs.sh"), "close-project", "p"], { env, timeout: 5000 })));
});

for (const shell of shells) {
  const interop = process.platform === "linux" && /\.exe$/i.test(shell);
  const nativePath = interop ? windowsPath : value => value;
  test(`${shell}: managed CMD transport authenticates TLS before bearer`, { timeout: 60000 }, async () => {
    await failuresAndSuccess(env => resultOf(run(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      nativePath(path.join(root, "packages/windows-cmd-batch-wrapper/canonicalfs.ps1")), "-Operation", "close-project", "-ProjectId", "p"], { env: windowsEnvironment(env, interop), timeout: 8000, windowsHide: true })));
  });
  test(`${shell}: a new wrong-pin client cannot reuse the preceding client's authenticated connection`, { timeout: 30000 }, async () => {
    const modulePath = nativePath(path.join(root, "packages/powershell/CanonicalPath/CanonicalPath.psd1")).replaceAll("'", "''");
    const script = `$ErrorActionPreference = 'Stop'
Import-Module '${modulePath}' -Force
$good = New-CanonicalFSDaemonClient -Endpoint $env:CANONICALFS_DAEMON_URL -Token $env:CANONICALFS_DAEMON_TOKEN
$response = $good.Send('POST', '/v1/projects/close', '{}', $false)
if ($response.StatusCode -ne 200) { throw 'trusted request failed' }
$ca = [System.IO.File]::ReadAllText($env:CANONICALFS_TLS_CA_FILE)
$bad = [CanonicalPath.PowerShell.DaemonClient]::new($env:CANONICALFS_DAEMON_URL, $env:CANONICALFS_DAEMON_TOKEN, 3000, 1024, $ca, ('0' * 64))
$rejected = $false
try { $null = $bad.Send('POST', '/v1/projects/close', '{}', $false) } catch { $rejected = $true }
if (-not $rejected) { throw 'wrong-pin client reused an authenticated connection' }
Write-Output 'accepted'`;
    await connectionPoolKeepsTrustIsolated(env => resultOf(run(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: windowsEnvironment(env, interop), timeout: 12000, windowsHide: true,
    })));
  });
}

test("Unity and PowerShell C# production transports authenticate TLS before bearer", { skip: !dotnet, timeout: 120000 }, async () => {
  // A Windows SDK invoked from WSL must build beside the mounted repository, not in Linux /tmp.
  const tempParent = dotnet.interop ? path.join(root, "tmp") : tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const temp = mkdtempSync(path.join(tempParent, "canonicalfs-managed-tls-"));
  try {
    const xml = value => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const sources = ["packages/unity/Runtime/CanonicalPath.cs", "packages/unity/Runtime/CanonicalPathHttpClient.cs", "packages/powershell/CanonicalPath/DaemonClient.cs"];
    writeFileSync(path.join(temp, "Check.csproj"), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable></PropertyGroup><ItemGroup>${sources.map(file => `<Compile Include="${xml(dotnet.nativePath(path.join(root, file)))}" />`).join("")}</ItemGroup></Project>`);
    writeFileSync(path.join(temp, "Program.cs"), `using System; using System.IO; using CanonicalPath;
class Program {
 static void Send(string kind,string endpoint,string token,string pin,string ca) {
  if(kind=="unity") { using(var c=new CanonicalFSDaemonHttpClient(new Uri(endpoint),token,new CanonicalFSTlsOptions(pin,ca))) c.CloseProjectAsync("p").GetAwaiter().GetResult(); }
  else { var c=new CanonicalPath.PowerShell.DaemonClient(endpoint,token,3000,1024,ca,pin); var response=c.Send("POST","/v1/projects/close","{}",false); if(response.StatusCode!=200) throw new Exception("Unexpected status"); }
 }
 static int Main(string[] args) {
  try {
   string endpoint=Environment.GetEnvironmentVariable("CANONICALFS_DAEMON_URL");
   string pin=Environment.GetEnvironmentVariable("CANONICALFS_TLS_CERTIFICATE_SHA256");
   string caPath=Environment.GetEnvironmentVariable("CANONICALFS_TLS_CA_FILE");
   string ca=String.IsNullOrEmpty(caPath)?null:File.ReadAllText(caPath);
   string token=Environment.GetEnvironmentVariable("CANONICALFS_DAEMON_TOKEN");
   Send(args[0],endpoint,token,pin,ca);
   if(args.Length>1 && args[1]=="reject-next-pin") {
    bool rejected=false;
    try { Send(args[0],endpoint,token,new String('0',64),ca); } catch { rejected=true; }
    if(!rejected) throw new Exception("Wrong-pin client reused an authenticated connection");
   }
   Console.WriteLine("accepted"); return 0;
  } catch { Console.Error.WriteLine("TLS request rejected"); return 1; }
 }
}`);
    await run(dotnet.command, [...dotnet.prefixArgs, "build", dotnet.nativePath(path.join(temp, "Check.csproj")), "-c", "Release", "--nologo", "-o", dotnet.nativePath(path.join(temp, "out"))], { timeout: 60000, windowsHide: true });
    for (const kind of ["unity", "powershell"]) {
      await failuresAndSuccess(env => resultOf(run(dotnet.command, [...dotnet.prefixArgs, dotnet.nativePath(path.join(temp, "out", "Check.dll")), kind], { env: windowsEnvironment(env, dotnet.interop), timeout: 5000, windowsHide: true })));
      await connectionPoolKeepsTrustIsolated(env => resultOf(run(dotnet.command, [...dotnet.prefixArgs, dotnet.nativePath(path.join(temp, "out", "Check.dll")), kind, "reject-next-pin"], {
        env: windowsEnvironment(env, dotnet.interop), timeout: 10000, windowsHide: true,
      })));
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
