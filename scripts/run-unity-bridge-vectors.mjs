import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "unity-bridge-vector-check");
const projectPath = path.join(tempRoot, "CanonicalPath.UnityBridge.VectorCheck.csproj");
const programPath = path.join(tempRoot, "Program.cs");
const vectorsPath = path.join(root, "spec", "testdata", "unity_bridge_vectors.json");

const dotnet = findDotnet();
if (!dotnet) {
  console.log("dotnet not found; skipping Unity bridge C# vector check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(projectPath, projectFile(), "utf8");
writeFileSync(programPath, programFile(), "utf8");

const result = spawnSync(
  dotnet.command,
  [...dotnet.prefixArgs, "run", "--project", dotnet.nativePath(projectPath), "--", dotnet.nativePath(vectorsPath)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

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
    <Compile Include="../../packages/unity/Runtime/UnityBridgeBuiltins.cs" Link="UnityBridgeBuiltins.cs" />
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
        if (args.Length != 1) throw new ArgumentException("Expected path to unity_bridge_vectors.json.");
        UnityBridgeVectorFile vectors = JsonSerializer.Deserialize<UnityBridgeVectorFile>(File.ReadAllText(args[0]));
        if (vectors == null || vectors.cases == null) throw new InvalidOperationException("Invalid Unity bridge vector file.");

        int count = 0;
        foreach (UnityBridgeVectorCase testCase in vectors.cases)
        {
            RunVector(testCase);
            count++;
        }

        Console.WriteLine("Unity bridge C# vectors passed: {0} cases", count);
        return 0;
    }

    private static void RunVector(UnityBridgeVectorCase testCase)
    {
        try
        {
            string actual = RunOperation(testCase);
            if (!string.IsNullOrEmpty(testCase.error))
            {
                throw new InvalidOperationException(testCase.id + ": expected error " + testCase.error + ", got value " + actual);
            }
            if (!string.Equals(actual, testCase.expected, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(testCase.id + ": expected " + testCase.expected + ", got " + actual);
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

    private static string RunOperation(UnityBridgeVectorCase testCase)
    {
        if (testCase.operation == "normalize-unity-path")
        {
            return PathGuard.NormalizeUnityPath(Required(testCase.raw, testCase, "raw"));
        }
        if (testCase.operation == "from-unity-asset-path")
        {
            return BridgeCanonicalPathService.Instance.FromUnityAssetPath(
                new CanonicalPathValue(Required(testCase.root, testCase, "root")),
                Required(testCase.raw, testCase, "raw")
            ).Value;
        }
        if (testCase.operation == "to-unity-asset-path")
        {
            return BridgeCanonicalPathService.Instance.ToUnityAssetPath(
                new CanonicalPathValue(Required(testCase.root, testCase, "root")),
                new CanonicalPathValue(Required(testCase.target, testCase, "target"))
            );
        }
        if (testCase.operation == "make-safe-file-name")
        {
            return PathGuard.MakeSafeFileName(Required(testCase.raw, testCase, "raw"), testCase.maxLength ?? 128);
        }
        throw new InvalidOperationException(testCase.id + ": unsupported Unity bridge operation " + testCase.operation);
    }

    private static string Required(string value, UnityBridgeVectorCase testCase, string field)
    {
        if (value == null) throw new InvalidOperationException(testCase.id + ": missing " + field);
        return value;
    }

    private static string ErrorCode(Exception ex)
    {
        string message = ex.Message ?? string.Empty;
        if (Contains(message, "NUL")) return "ERR_NUL_BYTE";
        if (Contains(message, "payload path must be relative")) return "ERR_ABSOLUTE_PATH";
        if (Contains(message, "traversal") || Contains(message, "outside project root")) return "ERR_OUTSIDE_ROOT";
        if (Contains(message, "File name input must not be empty") || Contains(message, "maxLength")) return "ERR_INVALID_COMPONENT";
        if (Contains(message, "must start with Assets/ or Packages/")) return "ERR_INVALID_PATH";
        if (Contains(message, "Unity path must not be empty")) return "ERR_EMPTY_PATH";
        return ex.GetType().Name + ": " + message;
    }

    private static bool Contains(string value, string search)
    {
        return value.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0;
    }
}

public sealed class UnityBridgeVectorFile
{
    public int version { get; set; }
    public List<UnityBridgeVectorCase> cases { get; set; }
}

public sealed class UnityBridgeVectorCase
{
    public string id { get; set; }
    public string operation { get; set; }
    public string raw { get; set; }
    public string root { get; set; }
    public string target { get; set; }
    public string expected { get; set; }
    public string error { get; set; }
    public int? maxLength { get; set; }
}
`;
}
