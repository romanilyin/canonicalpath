import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.join(root, "tmp", "unity-burst-probe-project");
const unitySuccessMarker = "Unity Burst compiler probe passed";
const unknownEntryPointDiagnostic = "not a known Burst entry point";

if (process.env.UNITY_BURST_PROBE !== "1") {
  console.log("Unity Burst compiler probe skipped. Set UNITY_BURST_PROBE=1 to enable this optional gate.");
  process.exit(0);
}

const unity = findUnityEditor();
if (!unity) {
  console.log("Unity Editor not found; skipping Unity Burst compiler probe. Set UNITY_EDITOR or UNITY_EXE to enable this gate.");
  process.exit(0);
}

rmSync(projectRoot, { recursive: true, force: true });
mkdirSync(path.join(projectRoot, "Assets", "Editor"), { recursive: true });
mkdirSync(path.join(projectRoot, "Packages"), { recursive: true });
mkdirSync(path.join(projectRoot, "ProjectSettings"), { recursive: true });
copyUnityPackage();
writeFileSync(path.join(projectRoot, "Packages", "manifest.json"), manifest(), "utf8");
writeFileSync(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.4.5f1\n", "utf8");
writeFileSync(path.join(projectRoot, "Assets", "Editor", "CanonicalPathUnityBurstProbeRunner.cs"), runnerSource(), "utf8");

const result = runUnity([
  "-batchmode",
  "-nographics",
  "-quit",
  "-projectPath",
  relativeForUnity(projectRoot),
  "-executeMethod",
  "CanonicalPathUnityBurstProbeRunner.Run",
]);
const output = printCapturedOutput(result);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (output.includes(unknownEntryPointDiagnostic)) {
  console.error(`Unity Burst compiler probe failed: ${unknownEntryPointDiagnostic}`);
  process.exit(1);
}
if (!output.includes(unitySuccessMarker)) {
  console.error(`Unity Burst compiler probe failed: missing success marker "${unitySuccessMarker}"`);
  process.exit(1);
}
process.exit(result.status ?? 1);

function runUnity(args) {
  const options = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };
  if (process.platform === "linux" && unity.startsWith("/mnt/")) {
    const command = ["Set-Location", quotePowerShell(wslpathIfAvailable(root)) + ";", "&", quotePowerShell(wslpathIfAvailable(unity)), ...args.map(quotePowerShell), ";", "exit", "$LASTEXITCODE"].join(" ");
    return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], options);
  }
  return spawnSync(unity, args, { ...options, cwd: root });
}

function printCapturedOutput(result) {
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return stdout + stderr;
}

function manifest() {
  const packagePath = wslpathIfAvailable(localUnityPackagePath()).replaceAll("\\", "/");
  return JSON.stringify(
    {
      dependencies: {
        "com.romanilyin.canonicalpath": `file:${packagePath}`,
        "com.unity.burst": process.env.UNITY_BURST_PACKAGE_VERSION || "1.8.18",
      },
    },
    null,
    2,
  );
}

function copyUnityPackage() {
  const sourceRoot = path.join(root, "packages", "unity");
  cpSync(sourceRoot, localUnityPackagePath(), {
    recursive: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source).replaceAll("\\", "/");
      return relative !== "Tests" && relative !== "Tests.meta" && !relative.startsWith("Tests/");
    },
  });
}

function localUnityPackagePath() {
  return path.join(projectRoot, "Packages", "com.romanilyin.canonicalpath");
}

function runnerSource() {
  return String.raw`using System;
using System.Runtime.InteropServices;
using AOT;
using CanonicalPath;
using Unity.Burst;
using UnityEditor;

[BurstCompile]
public static class CanonicalPathUnityBurstProbeRunner
{
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int ProbeDelegate();

    [BurstCompile(CompileSynchronously = true)]
    [MonoPInvokeCallback(typeof(ProbeDelegate))]
    private static int Probe()
    {
        if (!CanonicalPathBurst.IsAsciiLetter('C')) return 1;
        if (CanonicalPathBurst.ToLowerAscii('C') != 'c') return 2;
        if (!CanonicalPathBurst.IsWindowsDriveRoot('C', ':', '\\')) return 3;
        if (!CanonicalPathBurst.IsWindowsDriveRelative('C', ':', true, 'f')) return 4;
        if (CanonicalPathBurst.ValidateRelativePrefix(5, 'C', ':', true, 'f') != CanonicalPathBurstStatus.DriveRelativePath) return 5;
        if (CanonicalPathBurst.ValidateRelativePrefix(8, 'A', 's', true, 's') != CanonicalPathBurstStatus.Ok) return 6;
        return 0;
    }

    public static void Run()
    {
        try
        {
            BurstCompiler.Options.EnableBurstCompilation = true;
            BurstCompiler.Options.EnableBurstSafetyChecks = true;
            FunctionPointer<ProbeDelegate> pointer = BurstCompiler.CompileFunctionPointer<ProbeDelegate>(Probe);
            int result = pointer.Invoke();
            if (result != 0) throw new InvalidOperationException("Burst probe failed with result " + result);
            Console.WriteLine("Unity Burst compiler probe passed");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            EditorApplication.Exit(1);
        }
    }
}
`;
}

function findUnityEditor() {
  for (const key of ["UNITY_EDITOR", "UNITY_EXE", "UNITY_PATH"]) {
    const value = process.env[key];
    if (value && existsSync(value)) return value;
  }

  const hubRoot = "/mnt/c/Program Files/Unity/Hub/Editor";
  if (!existsSync(hubRoot)) return undefined;
  const versions = readdirSync(hubRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(hubRoot, version, "Editor", "Unity.exe");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function relativeForUnity(value) {
  return path.relative(root, value).replaceAll("\\", "/");
}

function wslpathIfAvailable(value) {
  if (process.platform !== "linux") return value;
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0) return value;
  return result.stdout.trim() || value;
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
