import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "unity-mcp-path-scope-vector-check");
const csprojPath = path.join(tempRoot, "CanonicalPath.UnityMcpPathScope.VectorCheck.csproj");
const programPath = path.join(tempRoot, "Program.cs");
const vectorsPath = path.join(root, "spec", "testdata", "unity_mcp_path_scope_vectors.json");
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));

let count = 0;
for (const testCase of vectors.cases) {
  runCase(testCase);
  count += 1;
}

console.log(`Unity MCP path scope vectors passed: ${count} cases`);

const dotnet = findDotnet();
if (!dotnet) {
  console.log("dotnet not found; skipping Unity MCP scoped path C# vector check");
} else {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(csprojPath, projectFile(), "utf8");
  writeFileSync(programPath, programFile(), "utf8");

  const result = spawnSync(
    dotnet.command,
    [...dotnet.prefixArgs, "run", "--project", dotnet.nativePath(csprojPath), "--", dotnet.nativePath(vectorsPath)],
    { stdio: "inherit" },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCase(testCase) {
  try {
    const actual = resolveScopedPath(testCase);
    if (testCase.error !== undefined) {
      throw new Error(`${testCase.id}: expected error ${testCase.error}, got ${actual.kind} ${actual.value}`);
    }
    const expected = testCase.expectedProjectRelative !== undefined
      ? { kind: "project", value: testCase.expectedProjectRelative }
      : { kind: "cache", value: testCase.expectedCacheRelative };
    if (actual.kind !== expected.kind || actual.value !== expected.value) {
      throw new Error(`${testCase.id}: expected ${expected.kind} ${expected.value}, got ${actual.kind} ${actual.value}`);
    }
  } catch (error) {
    if (testCase.error === undefined) throw error;
    if (error.code !== testCase.error) {
      throw new Error(`${testCase.id}: expected error ${testCase.error}, got ${error.code ?? error.message}`);
    }
  }
}

function resolveScopedPath(testCase) {
  const clean = validateCommon(testCase.raw);

  if (testCase.scope === "unity_asset") return projectPath(clean, startsWithAny(clean, ["Assets", "Packages"]));
  if (testCase.scope === "package_manifest") return packageManifestPath(clean);
  if (testCase.scope === "knowledge") return prefixedProjectPath("Assets/UnityMcpKnowledge", clean, isPlainScopeRelative(clean));
  if (testCase.scope === "artifact") return prefixedProjectPath("Library/SGGUnityMcp", clean, startsWithAny(clean, ["job-artifacts", "screenshots"]));
  if (testCase.scope === "gateway_cache") return cachePath(clean, startsWithAny(clean, ["index"]));
  if (testCase.scope === "temp_session") return prefixedProjectPath("Temp/SGGUnityMcp", clean, isPlainScopeRelative(clean));

  fail("ERR_INVALID_PATH");
}

function validateCommon(raw) {
  if (typeof raw !== "string") fail("ERR_INVALID_PATH");
  if (raw.length === 0) fail("ERR_EMPTY_PATH");
  if (raw.includes("\0")) fail("ERR_NUL_BYTE");
  if (/^file:\/\//i.test(raw)) fail("ERR_UNSUPPORTED_URI_SCHEME");
  if (/%(?:2f|5c|252f|255c)/i.test(raw)) fail("ERR_ENCODED_SEPARATOR");
  if (raw.startsWith("/")) fail("ERR_ABSOLUTE_PATH");
  if (raw.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(raw)) fail("ERR_ABSOLUTE_PATH");
  if (/^[A-Za-z]:($|[^\\/])/.test(raw)) fail("ERR_DRIVE_RELATIVE_PATH");
  if (raw.includes("\\")) fail("ERR_INVALID_PATH");

  const parts = raw.split("/");
  if (parts.some((part) => part === "..")) fail("ERR_OUTSIDE_ROOT");
  if (parts.some((part) => part === "" || part === "." || part.includes(":") || part.endsWith(".") || part.endsWith(" "))) fail("ERR_INVALID_PATH");
  if (raw.length > 4096 || parts.some((part) => part.length > 255)) fail("ERR_INVALID_PATH");
  return raw;
}

function isPlainScopeRelative(value) {
  return !startsWithAny(value, [
    "Assets",
    "AssetsEvil",
    "Packages",
    "PackagesEvil",
    "ProjectSettings",
    "Library",
    "Temp",
    "UnityMcpKnowledge",
    "UnityMcpKnowledgeEvil",
    "UnityMcpArtifacts",
    "UnityMcpGatewayCache",
    "UnityMcpTempSession"
  ]);
}

function startsWithAny(value, roots) {
  return roots.some((rootName) => value === rootName || value.startsWith(`${rootName}/`));
}

function projectPath(value, allowed) {
  if (!allowed) fail("ERR_OUTSIDE_ROOT");
  return { kind: "project", value };
}

function packageManifestPath(value) {
  if (value.startsWith("Packages/manifest.json/") || value.startsWith("Packages/packages-lock.json/")) fail("ERR_INVALID_PATH");
  return projectPath(value, value === "Packages/manifest.json" || value === "Packages/packages-lock.json");
}

function prefixedProjectPath(rootName, value, allowed) {
  if (!allowed) fail("ERR_OUTSIDE_ROOT");
  return { kind: "project", value: `${rootName}/${value}` };
}

function cachePath(value, allowed) {
  if (!allowed) fail("ERR_OUTSIDE_ROOT");
  return { kind: "cache", value };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function findDotnet() {
  if (commandExists("dotnet", ["--info"])) {
    return { command: "dotnet", prefixArgs: [], nativePath: (value) => value };
  }
  if (commandExists("dotnet.exe", ["--info"])) {
    return { command: "dotnet.exe", prefixArgs: [], nativePath: wslpathIfAvailable };
  }
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
  </ItemGroup>
</Project>
`;
}

function programFile() {
  return String.raw`using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using CanonicalPath;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("Expected path to unity_mcp_path_scope_vectors.json.");
        UnityMcpPathScopeVectorFile vectors = JsonSerializer.Deserialize<UnityMcpPathScopeVectorFile>(File.ReadAllText(args[0]));
        if (vectors == null || vectors.cases == null) throw new InvalidOperationException("Invalid Unity MCP scoped path vector file.");

        int count = 0;
        foreach (UnityMcpPathScopeVectorCase testCase in vectors.cases)
        {
            RunVector(testCase);
            count++;
        }

        Console.WriteLine("Unity MCP scoped path C# vectors passed: {0} cases", count);
        return 0;
    }

    private static void RunVector(UnityMcpPathScopeVectorCase testCase)
    {
        try
        {
            ScopedPathResult actual = ScopedPathGuard.NormalizeScopedPath(ParseScope(testCase.scope), Required(testCase.raw, testCase, "raw"));
            if (!string.IsNullOrEmpty(testCase.error))
            {
                throw new InvalidOperationException(testCase.id + ": expected error " + testCase.error + ", got " + actual.Kind + " " + actual.Path);
            }
            string expectedKind = testCase.expectedProjectRelative != null ? "project" : "cache";
            string expectedPath = testCase.expectedProjectRelative ?? testCase.expectedCacheRelative;
            if (actual.Kind != expectedKind || actual.Path != expectedPath)
            {
                throw new InvalidOperationException(testCase.id + ": expected " + expectedKind + " " + expectedPath + ", got " + actual.Kind + " " + actual.Path);
            }
        }
        catch (Exception ex)
        {
            if (string.IsNullOrEmpty(testCase.error)) throw;
            string code = ErrorCode(ex);
            if (!string.Equals(code, testCase.error, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(testCase.id + ": expected error " + testCase.error + ", got " + code, ex);
            }
        }
    }

    private static UnityMcpPathScope ParseScope(string scope)
    {
        if (scope == "unity_asset") return UnityMcpPathScope.UnityAsset;
        if (scope == "knowledge") return UnityMcpPathScope.Knowledge;
        if (scope == "package_manifest") return UnityMcpPathScope.PackageManifest;
        if (scope == "artifact") return UnityMcpPathScope.Artifact;
        if (scope == "gateway_cache") return UnityMcpPathScope.GatewayCache;
        if (scope == "temp_session") return UnityMcpPathScope.TempSession;
        throw new InvalidOperationException("unsupported scope " + scope);
    }

    private static string Required(string value, UnityMcpPathScopeVectorCase testCase, string field)
    {
        if (value == null) throw new InvalidOperationException(testCase.id + ": missing " + field);
        return value;
    }

    private static string ErrorCode(Exception ex)
    {
        CanonicalPathException pathError = ex as CanonicalPathException;
        if (pathError != null) return pathError.Code;
        return ex.GetType().Name + ": " + ex.Message;
    }
}

public sealed class UnityMcpPathScopeVectorFile
{
    public int version { get; set; }
    public List<UnityMcpPathScopeVectorCase> cases { get; set; }
}

public sealed class UnityMcpPathScopeVectorCase
{
    public string id { get; set; }
    public string scope { get; set; }
    public string raw { get; set; }
    public string expectedProjectRelative { get; set; }
    public string expectedCacheRelative { get; set; }
    public string error { get; set; }
}
`;
}
