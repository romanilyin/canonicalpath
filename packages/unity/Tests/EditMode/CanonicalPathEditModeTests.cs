using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using CP = CanonicalPath.CanonicalPath;

namespace CanonicalPath.Tests
{
    public sealed class CanonicalPathEditModeTests
    {
        [Test]
        public void ManagedCanonicalPathMatchesRepresentativeSharedVectors()
        {
            Assert.AreEqual("/home/alice/repo", CP.Normalize("/home//alice/./repo/", new CanonicalPathNormalizeOptions { SourceHost = "posix", TargetProfile = "posix" }));
            Assert.AreEqual("c:/Users/Alice/Repo", CP.Normalize("C:\\Users\\Alice\\Repo", new CanonicalPathNormalizeOptions { SourceHost = "win32", TargetProfile = "win32-drive" }));
            Assert.AreEqual("c:/Users/Alice/Repo", CP.Normalize("/mnt/c/Users/Alice/Repo", new CanonicalPathNormalizeOptions { SourceHost = "wsl", TargetProfile = "win32-drive", WSL = new CanonicalPathWSLOptions { Enabled = true, MountRoot = "/mnt" } }));
            Assert.AreEqual("src/file.txt", CP.Relative("c:/repo", "c:/repo/src/file.txt"));
            Assert.AreEqual("c:/repo/src/file.txt", CP.Join("c:/repo", "src/file.txt"));
            Assert.AreEqual("feature-auth--fc659bd73585", CP.EncodeGitRef("feature/auth"));
        }

        [Test]
        public void ManagedCanonicalPathRejectsSecurityCases()
        {
            AssertPathError("ERR_NUL_BYTE", () => CP.Normalize("safe\0name", null));
            AssertPathError("ERR_DRIVE_RELATIVE_PATH", () => CP.Normalize("C:foo", new CanonicalPathNormalizeOptions { SourceHost = "win32", TargetProfile = "win32-drive" }));
            AssertPathError("ERR_OUTSIDE_ROOT", () => CP.Relative("/tmp/project", "/tmp/project-evil/file.txt"));
            AssertPathError("ERR_ABSOLUTE_PATH", () => CP.Join("c:/repo", "d:/escape.txt"));
        }

        [Test]
        public void PathGuardMatchesBridgePayloadRules()
        {
            Assert.AreEqual("Assets/Scripts/Player.cs", PathGuard.NormalizeUnityPath("Assets\\Scripts//Player.cs"));
            Assert.AreEqual("CON-.txt", PathGuard.MakeSafeFileName("CON.txt", 128));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("ProjectSettings/TagManager.asset"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("Assets/../ProjectSettings/TagManager.asset"));
        }

        [Test]
        public void PathGuardRejectsAdditionalBridgePayloadEdges()
        {
            Assert.AreEqual("Assets", PathGuard.NormalizeUnityPath("Assets"));
            Assert.AreEqual("Packages/com.example/package.json", PathGuard.NormalizeUnityPath("Packages\\com.example//package.json"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("assets/Scripts/App.cs"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("AssetsEvil/Scripts/App.cs"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("PackagesEvil/com.example/package.json"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("\\\\server\\share\\Assets\\Escape.cs"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("Packages/com.example/../../ProjectSettings/TagManager.asset"));
            Assert.Throws<ArgumentException>(() => PathGuard.NormalizeUnityPath("Assets/Bad\0Name.cs"));
        }

        [Test]
        public void ScopedPathGuardMatchesRepresentativeScopeRules()
        {
            ScopedPathResult asset = ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, "Assets/Scripts/App.cs");
            Assert.AreEqual(UnityMcpPathScope.UnityAsset, asset.Scope);
            Assert.AreEqual("project", asset.Kind);
            Assert.AreEqual("Assets/Scripts/App.cs", asset.Path);

            Assert.AreEqual("Assets/UnityMcpKnowledge/agent-instructions.md", ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.Knowledge, "agent-instructions.md").Path);
            Assert.AreEqual("Library/SGGUnityMcp/screenshots/request-1.png", ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.Artifact, "screenshots/request-1.png").Path);
            Assert.AreEqual("cache", ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.GatewayCache, "index/sha256-abcd1234/result.json").Kind);
            Assert.AreEqual("/repo/Game/Temp/SGGUnityMcp/session-1/request.json", ScopedPathGuard.ToScopedCanonicalPath(BridgeCanonicalPathService.Instance, new CanonicalPathValue("/repo/Game"), UnityMcpPathScope.TempSession, "session-1/request.json").Value);

            AssertPathError("ERR_OUTSIDE_ROOT", () => ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, "AssetsEvil/Scripts/App.cs"));
            AssertPathError("ERR_INVALID_PATH", () => ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, "Assets\\Scripts/App.cs"));
            AssertPathError("ERR_INVALID_PATH", () => ScopedPathGuard.ToScopedCanonicalPath(BridgeCanonicalPathService.Instance, new CanonicalPathValue("/repo/Game"), UnityMcpPathScope.GatewayCache, "index/sha256-abcd1234/result.json"));
        }

        [Test]
        public void PathGuardSanitizesGeneratedFileNameEdges()
        {
            Assert.AreEqual("AUX-", PathGuard.MakeSafeFileName("AUX", 128));
            Assert.AreEqual("COM1-", PathGuard.MakeSafeFileName("COM1", 128));
            Assert.AreEqual("NUL-.meta", PathGuard.MakeSafeFileName("NUL.meta", 128));
            Assert.AreEqual("bad-name-asset-main.cs", PathGuard.MakeSafeFileName("bad\nname:asset\tmain.cs", 128));
            Assert.AreEqual("fil", PathGuard.MakeSafeFileName("......", 3));
            Assert.Throws<ArgumentOutOfRangeException>(() => PathGuard.MakeSafeFileName("file.txt", 0));
        }

        [Test]
        public void UnityBridgeBuiltinsValidateWriteCommandsBeforeExecution()
        {
            UnityBridgeBuiltins bridge = new UnityBridgeBuiltins("project-1", new CanonicalPathValue("/repo/Game"), "Game", "6000.4");

            UnityBridgeWriteResult refresh = bridge.ExecuteWriteCommand("assets.refresh", null, null, true);
            Assert.IsTrue(refresh.Ok);
            Assert.AreEqual("assets.refresh", refresh.Command);
            Assert.AreEqual(string.Empty, refresh.UnityPath);
            Assert.IsFalse(refresh.Performed);

            UnityBridgeWriteResult import = bridge.ExecuteWriteCommand("asset.import", "Assets\\Scripts//App.cs", "AUX", true);
            Assert.AreEqual("Assets/Scripts/App.cs", import.UnityPath);
            Assert.AreEqual("/repo/Game/Assets/Scripts/App.cs", import.CanonicalPath);
            Assert.AreEqual("AUX-", import.SafeFileName);
            Assert.IsTrue(import.DryRun);

            Assert.Throws<ArgumentException>(() => bridge.ExecuteWriteCommand("scene.save", "Assets/../ProjectSettings/Tags.asset", null, true));
            Assert.Throws<ArgumentException>(() => bridge.ExecuteWriteCommand("unsupported", "Assets/App.cs", null, true));
            Assert.Throws<ArgumentException>(() => bridge.ExecuteWriteCommand("asset.import", null, null, true));
        }

        [Test]
        public void ManagedTransportAddsBearerAuthAndParsesCapabilities()
        {
            using (FakeHandler handler = new FakeHandler("{\"auth_required\":true,\"endpoints\":[\"POST /v1/fs/readFile\"],\"limits\":{\"max_request_bytes\":1048576,\"default_read_bytes\":1048576,\"max_read_bytes\":16777216,\"max_response_bytes\":25165824}}"))
            using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
            using (CancellationTokenSource cancellation = new CancellationTokenSource())
            {
                CanonicalFSDaemonCapabilities caps = client.CapabilitiesAsync(cancellation.Token).GetAwaiter().GetResult();
                Assert.IsTrue(caps.AuthRequired);
                Assert.AreEqual("Bearer", handler.LastRequest.Headers.Authorization.Scheme);
                Assert.AreEqual("test-token", handler.LastRequest.Headers.Authorization.Parameter);
                Assert.AreEqual("http://127.0.0.1:1234/v1/caps", handler.LastRequest.RequestUri.ToString());
                Assert.IsTrue(handler.LastCancellationToken.CanBeCanceled);
            }
        }

        [Test]
        public void ManagedTransportSendsScopedPayloads()
        {
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes("scoped knowledge"));
            using (FakeHandler handler = new FakeHandler("{\"data_base64\":\"" + encoded + "\"}"))
            using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
            {
                string text = client.ReadScopedTextAsync("project-1", UnityMcpPathScope.Knowledge, "agent.md", 64, CancellationToken.None).GetAwaiter().GetResult();
                Assert.AreEqual("scoped knowledge", text);
                Assert.AreEqual("http://127.0.0.1:1234/v1/scoped/readFile", handler.LastRequest.RequestUri.ToString());
                AssertBodyContains(handler, "\"operation\":\"read\"");
                AssertBodyContains(handler, "\"path\":\"agent.md\"");
                AssertBodyContains(handler, "\"project_id\":\"project-1\"");
                AssertBodyContains(handler, "\"scope\":\"knowledge\"");
                AssertBodyContains(handler, "\"max_bytes\":64");
            }

            using (FakeHandler handler = new FakeHandler("{}"))
            using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
            {
                client.WriteScopedTextAsync("project-1", UnityMcpPathScope.Artifact, "job-artifacts/run-1/summary.json", "{}", CancellationToken.None).GetAwaiter().GetResult();
                Assert.AreEqual("http://127.0.0.1:1234/v1/scoped/writeFile", handler.LastRequest.RequestUri.ToString());
                AssertBodyContains(handler, "\"operation\":\"write\"");
                AssertBodyContains(handler, "\"scope\":\"artifact\"");
                AssertBodyContains(handler, "\"data_base64\":\"e30=\"");
            }

            using (FakeHandler handler = new FakeHandler("{\"stat\":{\"path\":\"Packages/manifest.json\",\"size\":2,\"is_directory\":false}}"))
            using (CanonicalFSDaemonHttpClient client = new CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "test-token", handler))
            {
                CanonicalFSFileStat stat = client.StatScopedAsync("project-1", UnityMcpPathScope.PackageManifest, "Packages/manifest.json", CancellationToken.None).GetAwaiter().GetResult();
                Assert.AreEqual("Packages/manifest.json", stat.Path);
                Assert.AreEqual(2, stat.Size);
                Assert.IsFalse(stat.IsDirectory);
                AssertBodyContains(handler, "\"operation\":\"read\"");
                AssertBodyContains(handler, "\"scope\":\"package_manifest\"");
            }
        }

        [Test]
        public void BurstCompatibleSurfaceUsesUnmanagedCodeUnits()
        {
            Assert.IsTrue(CanonicalPathBurst.IsAsciiLetter('C'));
            Assert.AreEqual((ushort)'c', CanonicalPathBurst.ToLowerAscii('C'));
            Assert.IsTrue(CanonicalPathBurst.IsWindowsDriveRoot('C', ':', '\\'));
            Assert.IsTrue(CanonicalPathBurst.IsWindowsDriveRelative('C', ':', true, 'f'));
            Assert.AreEqual(CanonicalPathBurstStatus.AbsolutePath, CanonicalPathBurst.ValidateRelativePrefix(3, '/', 'a', true, 'p'));
            Assert.AreEqual(CanonicalPathBurstStatus.DriveRelativePath, CanonicalPathBurst.ValidateRelativePrefix(5, 'C', ':', true, 'f'));
            Assert.AreEqual(CanonicalPathBurstStatus.NulByte, CanonicalPathBurst.ValidateRelativeCodeUnit(0));
            Assert.AreEqual(CanonicalPathBurstStatus.Ok, CanonicalPathBurst.ValidateRelativePrefix(8, 'A', 's', true, 's'));
        }

        [Test]
        public void ManagedHotLoopHasBoundedEditorAllocations()
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

            Assert.Greater(checksum, 0);
            Assert.LessOrEqual(allocated, 16L * 1024L * 1024L);
        }

        private static void AssertPathError(string code, TestDelegate action)
        {
            CanonicalPathException ex = Assert.Throws<CanonicalPathException>(action);
            Assert.AreEqual(code, ex.Code);
        }

        private static void AssertBodyContains(FakeHandler handler, string expected)
        {
            Assert.IsTrue(handler.LastBody.IndexOf(expected, StringComparison.Ordinal) >= 0, "expected request body to contain " + expected + ", got " + handler.LastBody);
        }

        private sealed class FakeHandler : HttpMessageHandler, IDisposable
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
}
