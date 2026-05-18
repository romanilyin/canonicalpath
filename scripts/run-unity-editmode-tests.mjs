import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredUnityVersionPrefix = process.env.UNITY_REQUIRED_VERSION_PREFIX || process.env.UNITY_EDITMODE_REQUIRED_VERSION_PREFIX;
const projectRoot = path.join(root, "tmp", tempProjectName("unity-editmode-project", requiredUnityVersionPrefix));

const unity = findUnityEditor(requiredUnityVersionPrefix);
if (!unity) {
  const versionLabel = requiredUnityVersionPrefix ? ` ${requiredUnityVersionPrefix}` : "";
  console.log(`Unity Editor${versionLabel} not found; skipping Unity EditMode tests. Set UNITY_EDITOR or UNITY_EXE to enable this gate.`);
  process.exit(0);
}
const unityVersion = projectVersionForUnity(unity, requiredUnityVersionPrefix);
if (requiredUnityVersionPrefix) console.log(`Using Unity Editor ${unityVersion} for versioned Unity EditMode tests.`);

rmSync(projectRoot, { recursive: true, force: true });
mkdirSync(path.join(projectRoot, "Assets", "Editor"), { recursive: true });
mkdirSync(path.join(projectRoot, "Packages"), { recursive: true });
mkdirSync(path.join(projectRoot, "ProjectSettings"), { recursive: true });
copyUnityPackage();
writeFileSync(path.join(projectRoot, "Packages", "manifest.json"), manifest(), "utf8");
writeFileSync(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), `m_EditorVersion: ${unityVersion}\n`, "utf8");
writeFileSync(path.join(projectRoot, "Assets", "Editor", "CanonicalPathUnityEditModeRunner.cs"), runnerSource(), "utf8");

const result = runUnity([
  "-batchmode",
  "-nographics",
  "-quit",
  "-projectPath",
  relativeForUnity(projectRoot),
  "-executeMethod",
  "CanonicalPathUnityEditModeRunner.Run",
]);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

function runUnity(args) {
  if (process.platform === "linux" && unity.startsWith("/mnt/")) {
    const command = ["Set-Location", quotePowerShell(wslpathIfAvailable(root)) + ";", "&", quotePowerShell(wslpathIfAvailable(unity)), ...args.map(quotePowerShell), ";", "exit", "$LASTEXITCODE"].join(" ");
    return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "inherit" });
  }
  return spawnSync(unity, args, { stdio: "inherit", cwd: root });
}

function manifest() {
  const packagePath = wslpathIfAvailable(localUnityPackagePath()).replaceAll("\\", "/");
  return JSON.stringify(
    {
      dependencies: {
        "com.romanilyin.canonicalpath": `file:${packagePath}`,
        "com.unity.test-framework": "1.1.33",
      },
      testables: ["com.romanilyin.canonicalpath"],
    },
    null,
    2,
  );
}

function copyUnityPackage() {
  cpSync(path.join(root, "packages", "unity"), localUnityPackagePath(), { recursive: true });
}

function localUnityPackagePath() {
  return path.join(projectRoot, "Packages", "com.romanilyin.canonicalpath");
}

function runnerSource() {
  return String.raw`using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CanonicalPath;
using UnityEditor;
using CP = CanonicalPath.CanonicalPath;

public static class CanonicalPathUnityEditModeRunner
{
    public static void Run()
    {
        try
        {
            ManagedCanonicalPathMatchesRepresentativeSharedVectors();
            ManagedCanonicalPathRejectsSecurityCases();
            PathGuardMatchesBridgePayloadRules();
            ScopedPathGuardMatchesRepresentativeScopeRules();
            ManagedTransportAddsBearerAuthAndParsesCapabilities();
            ManagedTransportSendsScopedPayloads();
            BurstCompatibleSurfaceUsesUnmanagedCodeUnits();
            ManagedHotLoopHasBoundedEditorAllocations();
            Console.WriteLine("Unity EditMode CanonicalPath runner passed");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            EditorApplication.Exit(1);
        }
    }

    private static void ManagedCanonicalPathMatchesRepresentativeSharedVectors()
    {
        Equal("/home/alice/repo", CP.Normalize("/home//alice/./repo/", new CanonicalPathNormalizeOptions { SourceHost = "posix", TargetProfile = "posix" }));
        Equal("c:/Users/Alice/Repo", CP.Normalize("C:\\Users\\Alice\\Repo", new CanonicalPathNormalizeOptions { SourceHost = "win32", TargetProfile = "win32-drive" }));
        Equal("c:/Users/Alice/Repo", CP.Normalize("/mnt/c/Users/Alice/Repo", new CanonicalPathNormalizeOptions { SourceHost = "wsl", TargetProfile = "win32-drive", WSL = new CanonicalPathWSLOptions { Enabled = true, MountRoot = "/mnt" } }));
        Equal("src/file.txt", CP.Relative("c:/repo", "c:/repo/src/file.txt"));
        Equal("c:/repo/src/file.txt", CP.Join("c:/repo", "src/file.txt"));
        Equal("feature-auth--fc659bd73585", CP.EncodeGitRef("feature/auth"));
    }

    private static void ManagedCanonicalPathRejectsSecurityCases()
    {
        PathError("ERR_NUL_BYTE", delegate { CP.Normalize("safe\0name", null); });
        PathError("ERR_DRIVE_RELATIVE_PATH", delegate { CP.Normalize("C:foo", new CanonicalPathNormalizeOptions { SourceHost = "win32", TargetProfile = "win32-drive" }); });
        PathError("ERR_OUTSIDE_ROOT", delegate { CP.Relative("/tmp/project", "/tmp/project-evil/file.txt"); });
        PathError("ERR_ABSOLUTE_PATH", delegate { CP.Join("c:/repo", "d:/escape.txt"); });
    }

    private static void PathGuardMatchesBridgePayloadRules()
    {
        Equal("Assets/Scripts/Player.cs", PathGuard.NormalizeUnityPath("Assets\\Scripts//Player.cs"));
        Equal("CON-.txt", PathGuard.MakeSafeFileName("CON.txt", 128));
        Throws(delegate { PathGuard.NormalizeUnityPath("ProjectSettings/TagManager.asset"); });
        Throws(delegate { PathGuard.NormalizeUnityPath("Assets/../ProjectSettings/TagManager.asset"); });
    }

    private static void ScopedPathGuardMatchesRepresentativeScopeRules()
    {
        ScopedPathResult asset = ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, "Assets/Scripts/App.cs");
        Equal(UnityMcpPathScope.UnityAsset.ToString(), asset.Scope.ToString());
        Equal("project", asset.Kind);
        Equal("Assets/Scripts/App.cs", asset.Path);

        Equal("Assets/UnityMcpKnowledge/agent-instructions.md", ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.Knowledge, "agent-instructions.md").Path);
        Equal("Library/SGGUnityMcp/screenshots/request-1.png", ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.Artifact, "screenshots/request-1.png").Path);
        Equal("cache", ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.GatewayCache, "index/sha256-abcd1234/result.json").Kind);
        Equal("/repo/Game/Temp/SGGUnityMcp/session-1/request.json", ScopedPathGuard.ToScopedCanonicalPath(BridgeCanonicalPathService.Instance, new CanonicalPathValue("/repo/Game"), UnityMcpPathScope.TempSession, "session-1/request.json").Value);

        PathError("ERR_OUTSIDE_ROOT", delegate { ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, "AssetsEvil/Scripts/App.cs"); });
        PathError("ERR_INVALID_PATH", delegate { ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, "Assets\\Scripts/App.cs"); });
        PathError("ERR_INVALID_PATH", delegate { ScopedPathGuard.ToScopedCanonicalPath(BridgeCanonicalPathService.Instance, new CanonicalPathValue("/repo/Game"), UnityMcpPathScope.GatewayCache, "index/sha256-abcd1234/result.json"); });
    }

    private static void ManagedTransportAddsBearerAuthAndParsesCapabilities()
    {
        using (FakeHandler handler = new FakeHandler("{\"auth_required\":true,\"endpoints\":[\"POST /v1/fs/readFile\"],\"limits\":{\"max_request_bytes\":1048576,\"default_read_bytes\":1048576,\"max_read_bytes\":16777216,\"max_response_bytes\":25165824}}"))
        using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
        using (CancellationTokenSource cancellation = new CancellationTokenSource())
        {
            CanonicalFSDaemonCapabilities caps = client.CapabilitiesAsync(cancellation.Token).GetAwaiter().GetResult();
            if (!caps.AuthRequired) throw new InvalidOperationException("expected auth_required=true");
            Equal("Bearer", handler.LastRequest.Headers.Authorization.Scheme);
            Equal("test-token", handler.LastRequest.Headers.Authorization.Parameter);
            Equal("http://127.0.0.1:1234/v1/caps", handler.LastRequest.RequestUri.ToString());
            True(handler.LastCancellationToken.CanBeCanceled);
        }
    }

    private static void ManagedTransportSendsScopedPayloads()
    {
        string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes("scoped knowledge"));
        using (FakeHandler handler = new FakeHandler("{\"data_base64\":\"" + encoded + "\"}"))
        using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
        {
            string text = client.ReadScopedTextAsync("project-1", UnityMcpPathScope.Knowledge, "agent.md", 64, CancellationToken.None).GetAwaiter().GetResult();
            Equal("scoped knowledge", text);
            Equal("http://127.0.0.1:1234/v1/scoped/readFile", handler.LastRequest.RequestUri.ToString());
            Contains(handler.LastBody, "\"operation\":\"read\"");
            Contains(handler.LastBody, "\"path\":\"agent.md\"");
            Contains(handler.LastBody, "\"project_id\":\"project-1\"");
            Contains(handler.LastBody, "\"scope\":\"knowledge\"");
            Contains(handler.LastBody, "\"max_bytes\":64");
        }

        using (FakeHandler handler = new FakeHandler("{}"))
        using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
        {
            client.WriteScopedTextAsync("project-1", UnityMcpPathScope.Artifact, "job-artifacts/run-1/summary.json", "{}", CancellationToken.None).GetAwaiter().GetResult();
            Equal("http://127.0.0.1:1234/v1/scoped/writeFile", handler.LastRequest.RequestUri.ToString());
            Contains(handler.LastBody, "\"operation\":\"write\"");
            Contains(handler.LastBody, "\"scope\":\"artifact\"");
            Contains(handler.LastBody, "\"data_base64\":\"e30=\"");
        }

        using (FakeHandler handler = new FakeHandler("{\"stat\":{\"path\":\"Packages/manifest.json\",\"size\":2,\"is_directory\":false}}"))
        using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
        {
            CanonicalFSFileStat stat = client.StatScopedAsync("project-1", UnityMcpPathScope.PackageManifest, "Packages/manifest.json", CancellationToken.None).GetAwaiter().GetResult();
            Equal("Packages/manifest.json", stat.Path);
            Equal("2", stat.Size.ToString());
            True(!stat.IsDirectory);
            Contains(handler.LastBody, "\"operation\":\"read\"");
            Contains(handler.LastBody, "\"scope\":\"package_manifest\"");
        }
    }

    private static void BurstCompatibleSurfaceUsesUnmanagedCodeUnits()
    {
        True(CanonicalPathBurst.IsAsciiLetter('C'));
        Equal(((ushort)'c').ToString(), CanonicalPathBurst.ToLowerAscii('C').ToString());
        True(CanonicalPathBurst.IsWindowsDriveRoot('C', ':', '\\'));
        True(CanonicalPathBurst.IsWindowsDriveRelative('C', ':', true, 'f'));
        Equal(CanonicalPathBurstStatus.AbsolutePath.ToString(), CanonicalPathBurst.ValidateRelativePrefix(3, '/', 'a', true, 'p').ToString());
        Equal(CanonicalPathBurstStatus.DriveRelativePath.ToString(), CanonicalPathBurst.ValidateRelativePrefix(5, 'C', ':', true, 'f').ToString());
        Equal(CanonicalPathBurstStatus.NulByte.ToString(), CanonicalPathBurst.ValidateRelativeCodeUnit(0).ToString());
        Equal(CanonicalPathBurstStatus.Ok.ToString(), CanonicalPathBurst.ValidateRelativePrefix(8, 'A', 's', true, 's').ToString());
    }

    private static void ManagedHotLoopHasBoundedEditorAllocations()
    {
        CanonicalPathNormalizeOptions options = new CanonicalPathNormalizeOptions { SourceHost = "win32", TargetProfile = "win32-drive" };
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetAllocatedBytesForCurrentThread();
        int checksum = 0;
        for (int i = 0; i < 1000; i++)
        {
            checksum += CP.Normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", options).Length;
            checksum += CP.Relative("c:/repo", "c:/repo/src/file.txt").Length;
            checksum += CP.Join("c:/repo", "src/file.txt").Length;
        }
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        if (checksum <= 0) throw new InvalidOperationException("allocation workload was optimized away");
        if (allocated > 16L * 1024L * 1024L) throw new InvalidOperationException("allocation budget exceeded: " + allocated);
    }

    private static void Equal(string expected, string actual)
    {
        if (!string.Equals(expected, actual, StringComparison.Ordinal)) throw new InvalidOperationException("expected " + expected + ", got " + actual);
    }

    private static void True(bool actual)
    {
        if (!actual) throw new InvalidOperationException("expected true");
    }

    private static void Contains(string actual, string expected)
    {
        if (actual == null || actual.IndexOf(expected, StringComparison.Ordinal) < 0) throw new InvalidOperationException("expected request body to contain " + expected + ", got " + actual);
    }

    private static void PathError(string code, Action action)
    {
        try
        {
            action();
        }
        catch (CanonicalPathException ex)
        {
            if (ex.Code == code) return;
            throw new InvalidOperationException("expected " + code + ", got " + ex.Code, ex);
        }
        throw new InvalidOperationException("expected " + code + " error");
    }

    private static void Throws(Action action)
    {
        try
        {
            action();
        }
        catch
        {
            return;
        }
        throw new InvalidOperationException("expected exception");
    }

    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly string json;

        public FakeHandler(string json)
        {
            this.json = json;
        }

        public HttpRequestMessage LastRequest { get; private set; }

        public CancellationToken LastCancellationToken { get; private set; }

        public string LastBody { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            LastCancellationToken = cancellationToken;
            LastBody = request.Content == null ? string.Empty : request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        }
    }
}
`;
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
