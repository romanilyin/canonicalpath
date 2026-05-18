import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "csharp-canonicalpath-vector-check");
const projectPath = path.join(tempRoot, "CanonicalPath.CSharp.VectorCheck.csproj");
const programPath = path.join(tempRoot, "Program.cs");
const vectorFiles = [
  "lexical_cases.json",
  "windows_cases.json",
  "wsl_cases.json",
  "uri_cases.json",
  "unicode_cases.json",
  "security_cases.json",
  "component_cases.json",
  "git_cases.json",
  "equality_cases.json",
].map((name) => path.join(root, "spec", "testdata", name));

const dotnet = findDotnet();
if (!dotnet) {
  console.log("dotnet not found; skipping C# CanonicalPath vector check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(projectPath, projectFile(), "utf8");
writeFileSync(programPath, programFile(), "utf8");

const result = spawnSync(
  dotnet.command,
  [...dotnet.prefixArgs, "run", "-c", "Release", "--project", dotnet.nativePath(projectPath), "--", ...vectorFiles.map((file) => dotnet.nativePath(file))],
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
  if (process.platform === "linux" && commandExists("cmd.exe", ["/d", "/c", "dotnet", "--info"])) {
    return { command: "cmd.exe", prefixArgs: ["/d", "/c", "dotnet"], nativePath: wslpathIfAvailable };
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
    <ProjectReference Include="../../packages/csharp/CanonicalPath.csproj" />
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
using CP = CanonicalPath.CanonicalPath;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 0) throw new ArgumentException("Expected one or more canonicalpath vector files.");

        int count = 0;
        for (int i = 0; i < args.Length; i++)
        {
            CanonicalPathVectorFile vectors = JsonSerializer.Deserialize<CanonicalPathVectorFile>(File.ReadAllText(args[i]));
            if (vectors == null || vectors.cases == null) throw new InvalidOperationException("Invalid vector file: " + args[i]);
            foreach (CanonicalPathVectorCase testCase in vectors.cases)
            {
                RunVector(testCase);
                count++;
            }
        }

        Console.WriteLine("C# CanonicalPath vectors passed: {0} cases", count);
        return 0;
    }

    private static void RunVector(CanonicalPathVectorCase testCase)
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

    private static string RunOperation(CanonicalPathVectorCase testCase)
    {
        if (testCase.operation == "normalize")
        {
            return CP.Normalize(Required(testCase.raw, testCase, "raw"), ToOptions(testCase.options));
        }
        if (testCase.operation == "relative")
        {
            return CP.Relative(Required(testCase.root, testCase, "root"), Required(testCase.target, testCase, "target"));
        }
        if (testCase.operation == "join")
        {
            return CP.Join(Required(testCase.root, testCase, "root"), Required(testCase.relative, testCase, "relative"));
        }
        if (testCase.operation == "is-equal")
        {
            return CP.IsEqual(Required(testCase.root, testCase, "root"), Required(testCase.target, testCase, "target"), ToOptions(testCase.options)) ? "true" : "false";
        }
        if (testCase.operation == "to-win32")
        {
            return CP.ToWin32(Required(testCase.raw, testCase, "raw"));
        }
        if (testCase.operation == "to-wsl")
        {
            return CP.ToWSL(Required(testCase.raw, testCase, "raw"), ToWSLOptions(testCase.options == null ? null : testCase.options.wsl));
        }
        if (testCase.operation == "to-posix")
        {
            return CP.ToPOSIX(Required(testCase.raw, testCase, "raw"));
        }
        if (testCase.operation == "sanitize-component")
        {
            return CP.SanitizeComponent(Required(testCase.raw, testCase, "raw"), Required(testCase.profile, testCase, "profile"));
        }
        if (testCase.operation == "encode-component")
        {
            return CP.EncodeComponent(Required(testCase.raw, testCase, "raw"), Required(testCase.profile, testCase, "profile"));
        }
        if (testCase.operation == "encode-git-ref")
        {
            return CP.EncodeGitRef(Required(testCase.raw, testCase, "raw"));
        }
        throw new InvalidOperationException(testCase.id + ": unsupported operation " + testCase.operation);
    }

    private static CanonicalPathNormalizeOptions ToOptions(VectorOptions source)
    {
        if (source == null) return null;
        return new CanonicalPathNormalizeOptions
        {
            SourceHost = source.sourceHost,
            TargetProfile = source.targetProfile,
            WSL = ToWSLOptions(source.wsl),
            URI = ToURIOptions(source.uri),
            Windows = ToWindowsOptions(source.windows),
            TrimOuterWhitespace = source.trimOuterWhitespace,
        };
    }

    private static CanonicalPathWSLOptions ToWSLOptions(VectorWSLOptions source)
    {
        if (source == null) return null;
        return new CanonicalPathWSLOptions { Enabled = source.enabled, MountRoot = source.mountRoot };
    }

    private static CanonicalPathURIOptions ToURIOptions(VectorURIOptions source)
    {
        if (source == null) return null;
        return new CanonicalPathURIOptions
        {
            AllowFileUri = source.allowFileUri,
            AllowVSCodeFileUri = source.allowVSCodeFileUri,
            RejectEncodedSlash = source.rejectEncodedSlash,
        };
    }

    private static CanonicalPathWindowsOptions ToWindowsOptions(VectorWindowsOptions source)
    {
        if (source == null) return null;
        return new CanonicalPathWindowsOptions
        {
            PreserveExtendedLength = source.preserveExtendedLength,
            RejectDeviceNames = source.rejectDeviceNames,
            RejectADS = source.rejectADS,
        };
    }

    private static string Required(string value, CanonicalPathVectorCase testCase, string field)
    {
        if (value == null) throw new InvalidOperationException(testCase.id + ": missing " + field);
        return value;
    }

    private static string ErrorCode(Exception ex)
    {
        CanonicalPathException pathEx = ex as CanonicalPathException;
        if (pathEx != null) return pathEx.Code;
        return ex.GetType().Name + ": " + (ex.Message ?? string.Empty);
    }
}

public sealed class CanonicalPathVectorFile
{
    public int version { get; set; }
    public List<CanonicalPathVectorCase> cases { get; set; }
}

public sealed class CanonicalPathVectorCase
{
    public string id { get; set; }
    public string operation { get; set; }
    public string raw { get; set; }
    public string root { get; set; }
    public string target { get; set; }
    public string relative { get; set; }
    public string profile { get; set; }
    public VectorOptions options { get; set; }
    public string expected { get; set; }
    public string error { get; set; }
}

public sealed class VectorOptions
{
    public string sourceHost { get; set; }
    public string targetProfile { get; set; }
    public VectorWSLOptions wsl { get; set; }
    public VectorURIOptions uri { get; set; }
    public VectorWindowsOptions windows { get; set; }
    public bool trimOuterWhitespace { get; set; }
}

public sealed class VectorWSLOptions
{
    public bool enabled { get; set; }
    public string mountRoot { get; set; }
}

public sealed class VectorURIOptions
{
    public bool allowFileUri { get; set; }
    public bool allowVSCodeFileUri { get; set; }
    public bool? rejectEncodedSlash { get; set; }
}

public sealed class VectorWindowsOptions
{
    public bool preserveExtendedLength { get; set; }
    public bool rejectDeviceNames { get; set; }
    public bool rejectADS { get; set; }
}
`;
}
