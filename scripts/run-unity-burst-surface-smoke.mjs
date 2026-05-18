import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "unity-burst-surface-smoke");
const projectPath = path.join(tempRoot, "CanonicalPath.Unity.BurstSurfaceSmoke.csproj");
const programPath = path.join(tempRoot, "Program.cs");

const dotnet = findDotnet();
if (!dotnet) {
  console.log("dotnet not found; skipping Unity Burst surface smoke");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(projectPath, projectFile(), "utf8");
writeFileSync(programPath, programFile(), "utf8");

const result = spawnSync(dotnet.command, [...dotnet.prefixArgs, "run", "--project", dotnet.nativePath(projectPath)], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

function findDotnet() {
  if (commandExists("dotnet", ["--info"])) return { command: "dotnet", prefixArgs: [], nativePath: (value) => value };
  if (commandExists("dotnet.exe", ["--info"])) return { command: "dotnet.exe", prefixArgs: [], nativePath: wslpathIfAvailable };
  if (process.platform === "linux" && commandExists("cmd.exe", ["/c", "dotnet", "--info"])) return { command: "cmd.exe", prefixArgs: ["/c", "dotnet"], nativePath: wslpathIfAvailable };
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
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="../../packages/unity/Runtime/CanonicalPathBurst.cs" Link="CanonicalPathBurst.cs" />
  </ItemGroup>
</Project>
`;
}

function programFile() {
  return String.raw`using System;
using CanonicalPath;

internal static class Program
{
    private static unsafe int Main()
    {
        Equal(true, CanonicalPathBurst.IsAsciiLetter('C'));
        Equal((ushort)'c', CanonicalPathBurst.ToLowerAscii('C'));
        Equal(true, CanonicalPathBurst.IsWindowsDriveRoot('C', ':', '\\'));
        Equal(true, CanonicalPathBurst.IsWindowsDriveRelative('C', ':', true, 'f'));
        Equal(CanonicalPathBurstStatus.AbsolutePath, CanonicalPathBurst.ValidateRelativePrefix(3, '/', 'a', true, 'p'));
        Equal(CanonicalPathBurstStatus.DriveRelativePath, CanonicalPathBurst.ValidateRelativePrefix(5, 'C', ':', true, 'f'));
        Equal(CanonicalPathBurstStatus.NulByte, CanonicalPathBurst.ValidateRelativeCodeUnit(0));
        Equal(CanonicalPathBurstStatus.Ok, CanonicalPathBurst.ValidateRelativePrefix(8, 'A', 's', true, 's'));

        ushort* input = stackalloc ushort[] { (ushort)'A', (ushort)'s', (ushort)'s', (ushort)'e', (ushort)'t', (ushort)'s', (ushort)'\\', (ushort)'/', (ushort)'P', (ushort)'l', (ushort)'a', (ushort)'y', (ushort)'e', (ushort)'r', (ushort)'.', (ushort)'c', (ushort)'s' };
        ushort* output = stackalloc ushort[32];
        int written;
        Equal(CanonicalPathBurstStatus.Ok, CanonicalPathBurst.CopyRelativeCanonical(input, 17, output, 32, out written));
        Equal(16, written);
        Equal((ushort)'/', output[6]);

        ushort* traversal = stackalloc ushort[] { (ushort)'A', (ushort)'s', (ushort)'s', (ushort)'e', (ushort)'t', (ushort)'s', (ushort)'/', (ushort)'.', (ushort)'.' };
        Equal(CanonicalPathBurstStatus.InvalidPath, CanonicalPathBurst.CopyRelativeCanonical(traversal, 9, output, 32, out written));

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        long before = GC.GetAllocatedBytesForCurrentThread();
        int checksum = 0;
        for (int i = 0; i < 1000000; i++)
        {
            if (CanonicalPathBurst.IsAsciiLetter('A')) checksum++;
            checksum += CanonicalPathBurst.ToLowerAscii('Z');
            checksum += (int)CanonicalPathBurst.ValidateRelativePrefix(5, 's', 'r', true, 'c');
            checksum += (int)CanonicalPathBurst.ValidateRelativeCodeUnit('x');
            checksum += (int)CanonicalPathBurst.CopyRelativeCanonical(input, 17, output, 32, out written);
            checksum += written;
        }
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        if (checksum <= 0) throw new InvalidOperationException("workload was optimized away");
        if (allocated != 0) throw new InvalidOperationException("expected zero managed allocations, got " + allocated);

        Console.WriteLine("Unity Burst-compatible surface smoke passed");
        return 0;
    }

    private static void Equal<T>(T expected, T actual)
    {
        if (!object.Equals(expected, actual)) throw new InvalidOperationException("expected " + expected + ", got " + actual);
    }
}
`;
}
