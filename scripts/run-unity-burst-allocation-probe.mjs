import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitySuccessMarker = "Unity Burst allocation probe passed";
const unknownEntryPointDiagnostic = "not a known Burst entry point";
const requiredUnityVersionPrefix = process.env.UNITY_BURST_REQUIRED_VERSION_PREFIX;
const projectRoot = path.join(root, "tmp", tempProjectName("unity-burst-allocation-probe-project", requiredUnityVersionPrefix));

if (process.env.UNITY_BURST_ALLOC_PROBE !== "1") {
  console.log("Unity Burst allocation probe skipped. Set UNITY_BURST_ALLOC_PROBE=1 to enable this optional gate.");
  process.exit(0);
}

const unity = findUnityEditor(requiredUnityVersionPrefix);
if (!unity) {
  const versionLabel = requiredUnityVersionPrefix ? ` ${requiredUnityVersionPrefix}` : "";
  console.log(`Unity Editor${versionLabel} not found; skipping Unity Burst allocation probe. Set UNITY_EDITOR or UNITY_EXE to enable this gate.`);
  process.exit(0);
}
const unityVersion = projectVersionForUnity(unity, requiredUnityVersionPrefix);
if (requiredUnityVersionPrefix) console.log(`Using Unity Editor ${unityVersion} for versioned Unity Burst allocation probe.`);

rmSync(projectRoot, { recursive: true, force: true });
mkdirSync(path.join(projectRoot, "Assets", "Editor"), { recursive: true });
mkdirSync(path.join(projectRoot, "Packages"), { recursive: true });
mkdirSync(path.join(projectRoot, "ProjectSettings"), { recursive: true });
copyUnityPackage();
writeFileSync(path.join(projectRoot, "Packages", "manifest.json"), manifest(), "utf8");
writeFileSync(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), `m_EditorVersion: ${unityVersion}\n`, "utf8");
writeFileSync(path.join(projectRoot, "Assets", "Editor", "CanonicalPathUnityBurstAllocationProbeRunner.cs"), runnerSource(), "utf8");
writeFileSync(path.join(projectRoot, "Assets", "Editor", "CanonicalPath.UnityBurstAllocationProbe.asmdef"), asmdef(), "utf8");

const result = runUnity([
  "-batchmode",
  "-nographics",
  "-quit",
  "-projectPath",
  relativeForUnity(projectRoot),
  "-executeMethod",
  "CanonicalPathUnityBurstAllocationProbeRunner.Run",
]);
const output = printCapturedOutput(result);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (output.includes(unknownEntryPointDiagnostic)) {
  console.error(`Unity Burst allocation probe failed: ${unknownEntryPointDiagnostic}`);
  process.exit(1);
}
if (!output.includes(unitySuccessMarker)) {
  console.error(`Unity Burst allocation probe failed: missing success marker "${unitySuccessMarker}"`);
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
public static unsafe class CanonicalPathUnityBurstAllocationProbeRunner
{
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int ProbeDelegate(int iterations);

    [BurstCompile(CompileSynchronously = true)]
    [MonoPInvokeCallback(typeof(ProbeDelegate))]
    private static int Probe(int iterations)
    {
        ushort* input = stackalloc ushort[17];
        input[0] = 'A';
        input[1] = 's';
        input[2] = 's';
        input[3] = 'e';
        input[4] = 't';
        input[5] = 's';
        input[6] = '\\';
        input[7] = '/';
        input[8] = 'P';
        input[9] = 'l';
        input[10] = 'a';
        input[11] = 'y';
        input[12] = 'e';
        input[13] = 'r';
        input[14] = '.';
        input[15] = 'c';
        input[16] = 's';
        ushort* output = stackalloc ushort[32];

        int checksum = 0;
        for (int i = 0; i < iterations; i++)
        {
            int written;
            checksum += CanonicalPathBurst.IsAsciiLetter('A') ? 1 : -1;
            checksum += CanonicalPathBurst.ToLowerAscii('Z');
            checksum += (int)CanonicalPathBurst.ValidateRelativePrefix(5, 's', 'r', true, 'c');
            checksum += (int)CanonicalPathBurst.ValidateRelativeCodeUnit('x');
            checksum += (int)CanonicalPathBurst.CopyRelativeCanonical(input, 17, output, 32, out written);
            checksum += written;
        }
        return checksum > 0 ? 0 : -1;
    }

    public static void Run()
    {
        try
        {
            BurstCompiler.Options.EnableBurstCompilation = true;
            BurstCompiler.Options.EnableBurstSafetyChecks = true;
            FunctionPointer<ProbeDelegate> pointer = BurstCompiler.CompileFunctionPointer<ProbeDelegate>(Probe);
            int warmup = pointer.Invoke(1000);
            if (warmup != 0) throw new InvalidOperationException("Burst allocation probe warmup failed with result " + warmup);

            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();

            long before = GC.GetAllocatedBytesForCurrentThread();
            int result = pointer.Invoke(1000000);
            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
            if (result != 0) throw new InvalidOperationException("Burst allocation probe failed with result " + result);
            if (allocated != 0) throw new InvalidOperationException("expected zero managed allocations after Burst warmup, got " + allocated);

            Console.WriteLine("Unity Burst allocation probe passed");
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

function asmdef() {
  return JSON.stringify(
    {
      name: "CanonicalPath.UnityBurstAllocationProbe",
      rootNamespace: "CanonicalPath",
      references: ["CanonicalPath.UnityBridge", "Unity.Burst"],
      includePlatforms: ["Editor"],
      excludePlatforms: [],
      allowUnsafeCode: true,
      overrideReferences: false,
      precompiledReferences: [],
      autoReferenced: true,
      defineConstraints: [],
      versionDefines: [],
      noEngineReferences: false,
    },
    null,
    2,
  );
}

function findUnityEditor(requiredVersionPrefix) {
  for (const key of ["UNITY_EDITOR", "UNITY_EXE", "UNITY_PATH"]) {
    const value = process.env[key];
    if (value && existsSync(value) && versionMatches(value, requiredVersionPrefix)) return value;
  }

  const hubRoot = "/mnt/c/Program Files/Unity/Hub/Editor";
  if (!existsSync(hubRoot)) return undefined;
  const versions = readdirSync(hubRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    if (requiredVersionPrefix && !matchesVersionPrefix(version, requiredVersionPrefix)) continue;
    const candidate = path.join(hubRoot, version, "Editor", "Unity.exe");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function projectVersionForUnity(value, requiredVersionPrefix) {
  return unityVersionFromPath(value) || (requiredVersionPrefix ? `${requiredVersionPrefix}.0f1` : "6000.4.5f1");
}

function versionMatches(value, requiredVersionPrefix) {
  if (!requiredVersionPrefix) return true;
  const version = unityVersionFromPath(value);
  return version ? matchesVersionPrefix(version, requiredVersionPrefix) : false;
}

function matchesVersionPrefix(version, requiredVersionPrefix) {
  return version === requiredVersionPrefix || version.startsWith(`${requiredVersionPrefix}.`);
}

function unityVersionFromPath(value) {
  const parts = String(value).split(/[\\/]+/);
  const editorIndex = parts.lastIndexOf("Editor");
  if (editorIndex <= 0) return undefined;
  const version = parts[editorIndex - 1];
  return /^\d+\.\d+/.test(version) ? version : undefined;
}

function tempProjectName(baseName, versionPrefix) {
  if (!versionPrefix) return baseName;
  return `${baseName}-${versionPrefix.replaceAll(".", "-")}`;
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
