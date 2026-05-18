import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "csharp-canonicalpath-allocation-check");
const projectPath = path.join(tempRoot, "CanonicalPath.CSharp.AllocationCheck.csproj");
const programPath = path.join(tempRoot, "Program.cs");

const dotnet = findDotnet();
if (!dotnet) {
  console.log("dotnet not found; skipping C# CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(projectPath, projectFile(), "utf8");
writeFileSync(programPath, programFile(), "utf8");

const result = spawnSync(
  dotnet.command,
  [...dotnet.prefixArgs, "run", "-c", "Release", "--project", dotnet.nativePath(projectPath)],
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
using CanonicalPath;
using CP = CanonicalPath.CanonicalPath;

internal static class Program
{
    private const int Iterations = 10000;
    private const long MaxAllocatedBytes = 128L * 1024L * 1024L;

    private static int Main()
    {
        CanonicalPathNormalizeOptions posix = new CanonicalPathNormalizeOptions { SourceHost = "posix", TargetProfile = "posix" };
        CanonicalPathNormalizeOptions win32 = new CanonicalPathNormalizeOptions { SourceHost = "win32", TargetProfile = "win32-drive" };
        CanonicalPathNormalizeOptions uri = new CanonicalPathNormalizeOptions
        {
            SourceHost = "vscode-file-uri",
            TargetProfile = "posix",
            URI = new CanonicalPathURIOptions { AllowFileUri = true },
        };
        CanonicalPathNormalizeOptions wsl = new CanonicalPathNormalizeOptions
        {
            SourceHost = "wsl",
            TargetProfile = "win32-drive",
            WSL = new CanonicalPathWSLOptions { Enabled = true, MountRoot = "/mnt" },
        };
        CanonicalPathWSLOptions wslOut = new CanonicalPathWSLOptions { MountRoot = "/mnt" };

        int checksum = RunWorkload(posix, win32, uri, wsl, wslOut, 64);
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetAllocatedBytesForCurrentThread();
        checksum += RunWorkload(posix, win32, uri, wsl, wslOut, Iterations);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        if (checksum == 0) throw new InvalidOperationException("allocation workload was optimized away");
        if (allocated > MaxAllocatedBytes)
        {
            throw new InvalidOperationException("C# CanonicalPath allocation check exceeded budget: " + allocated + " > " + MaxAllocatedBytes);
        }

        Console.WriteLine("C# CanonicalPath allocation check passed: allocated {0} bytes over {1} iterations", allocated, Iterations);
        return 0;
    }

    private static int RunWorkload(
        CanonicalPathNormalizeOptions posix,
        CanonicalPathNormalizeOptions win32,
        CanonicalPathNormalizeOptions uri,
        CanonicalPathNormalizeOptions wsl,
        CanonicalPathWSLOptions wslOut,
        int iterations)
    {
        int checksum = 0;
        for (int i = 0; i < iterations; i++)
        {
            checksum += CP.Normalize("/home//alice/./repo/src/../README.md", posix).Length;
            checksum += CP.Normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win32).Length;
            checksum += CP.Normalize("file:///repo/caf%C3%A9.txt", uri).Length;
            checksum += CP.Normalize("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).Length;
            checksum += CP.Relative("c:/repo", "c:/repo/src/file.txt").Length;
            checksum += CP.Join("c:/repo", "src/file.txt").Length;
            checksum += CP.IsEqual("C:\\Users\\Alice\\Repo", "c:/Users/Alice/Repo", win32) ? 1 : 0;
            checksum += CP.ToWin32("c:/Users/Alice/Repo").Length;
            checksum += CP.ToWSL("c:/Users/Alice/Repo", wslOut).Length;
            checksum += CP.ToPOSIX("/home/alice/repo").Length;
            checksum += CP.SanitizeComponent("feature/auth", "portable").Length;
            checksum += CP.EncodeComponent("CON.txt", "win32").Length;
            checksum += CP.EncodeGitRef("feature/auth").Length;
        }

        return checksum;
    }
}
`;
}
