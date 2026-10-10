using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Text;

namespace CanonicalPath
{
    public sealed class UnityBridgeStatus
    {
        public string State;
        public string ProjectId;
        public string ProjectName;
        public string UnityVersion;
        public string Detail;
    }

    public sealed class UnityBridgeProjectInfo
    {
        public string ProjectId;
        public string CanonicalProjectPath;
        public string ProjectName;
        public string UnityVersion;
    }

    public sealed class UnityBridgeLogEntry
    {
        public string Level;
        public string Message;
        public string Timestamp;
    }

    public sealed class UnityBridgeReadResult
    {
        public string ProjectId;
        public string UnityPath;
        public string CanonicalPath;
        public string Text;
        public bool Truncated;
    }

    public sealed class UnityBridgePathValidation
    {
        public bool Ok;
        public string ProjectId;
        public string UnityPath;
        public string CanonicalPath;
    }

    public sealed class UnityBridgeWriteResult
    {
        public bool Ok;
        public string Command;
        public string ProjectId;
        public string UnityPath;
        public string CanonicalPath;
        public string SafeFileName;
        public bool DryRun;
        public bool Performed;
        public string Detail;
    }

    public sealed class UnityBridgeBuiltins
    {
        public const int MaxReadChars = 1048576;
        public const long MaxReadBytes = 4L * 1048576;
        private readonly CanonicalFSDaemonHttpClient daemon;
        private readonly ICanonicalPathService paths;
        private readonly CanonicalPathValue projectRoot;
        private readonly string projectId;
        private readonly string projectName;
        private readonly string unityVersion;
        private readonly List<UnityBridgeLogEntry> logs = new List<UnityBridgeLogEntry>();

        public UnityBridgeBuiltins(string projectId, CanonicalPathValue projectRoot, string projectName, string unityVersion, ICanonicalPathService paths = null, CanonicalFSDaemonHttpClient daemon = null)
        {
            if (string.IsNullOrEmpty(projectId)) throw new ArgumentException("projectId is required.", "projectId");
            this.projectId = projectId;
            this.projectRoot = projectRoot;
            this.projectName = projectName ?? string.Empty;
            this.unityVersion = unityVersion ?? string.Empty;
            this.paths = paths ?? BridgeCanonicalPathService.Instance;
            this.daemon = daemon;
        }

        public UnityBridgeStatus Status()
        {
            return new UnityBridgeStatus
            {
                State = "ready",
                ProjectId = projectId,
                ProjectName = projectName,
                UnityVersion = unityVersion,
                Detail = string.Empty,
            };
        }

        public UnityBridgeProjectInfo ProjectInfo()
        {
            return new UnityBridgeProjectInfo
            {
                ProjectId = projectId,
                CanonicalProjectPath = projectRoot.Value,
                ProjectName = projectName,
                UnityVersion = unityVersion,
            };
        }

        public UnityBridgeLogEntry[] ReadLog(int maxEntries)
        {
            if (maxEntries < 1) return new UnityBridgeLogEntry[0];
            int count = Math.Min(maxEntries, logs.Count);
            UnityBridgeLogEntry[] result = new UnityBridgeLogEntry[count];
            logs.CopyTo(logs.Count - count, result, 0, count);
            return result;
        }

        public UnityBridgeReadResult ReadText(string unityPath, int maxChars)
        {
            return ReadTextAsync(unityPath, maxChars, CancellationToken.None).GetAwaiter().GetResult();
        }

        // The daemon project must already be registered by the trusted host.
        // Lexical CanonicalPath values are metadata and never become local I/O.
        public async Task<UnityBridgeReadResult> ReadTextAsync(string unityPath, int maxChars, CancellationToken cancellationToken)
        {
            if (maxChars < 1 || maxChars > MaxReadChars) throw new ArgumentOutOfRangeException("maxChars", "maxChars exceeds the bounded read limit.");
            string cleanUnityPath = PathGuard.NormalizeUnityPath(unityPath);
            ScopedPathGuard.NormalizeScopedPath(UnityMcpPathScope.UnityAsset, cleanUnityPath);
            CanonicalPathValue canonicalPath = paths.FromUnityAssetPath(projectRoot, cleanUnityPath);
            if (daemon == null) throw new InvalidOperationException("Unity text reads require a registered CanonicalFS daemon client.");
            byte[] data = await daemon.ReadScopedFileAsync(projectId, UnityMcpPathScope.UnityAsset, cleanUnityPath, MaxReadBytes, cancellationToken).ConfigureAwait(false);
            string text = Encoding.UTF8.GetString(data);
            bool truncated = text.Length > maxChars;
            if (truncated) text = text.Substring(0, maxChars);
            return new UnityBridgeReadResult
            {
                ProjectId = projectId,
                UnityPath = cleanUnityPath,
                CanonicalPath = canonicalPath.Value,
                Text = text,
                Truncated = truncated,
            };
        }

        public UnityBridgePathValidation ValidatePath(string unityPath)
        {
            string cleanUnityPath = PathGuard.NormalizeUnityPath(unityPath);
            CanonicalPathValue canonicalPath = paths.FromUnityAssetPath(projectRoot, cleanUnityPath);
            return new UnityBridgePathValidation
            {
                Ok = true,
                ProjectId = projectId,
                UnityPath = cleanUnityPath,
                CanonicalPath = canonicalPath.Value,
            };
        }

        public UnityBridgeWriteResult ExecuteWriteCommand(string command, string unityPath, string generatedFileName, bool dryRun)
        {
            if (!IsSupportedWriteCommand(command)) throw new ArgumentException("Unsupported Unity write command.", "command");
            bool requiresPath = RequiresUnityPath(command);
            string cleanUnityPath = string.Empty;
            string canonicalPath = string.Empty;
            if (!string.IsNullOrEmpty(unityPath))
            {
                cleanUnityPath = PathGuard.NormalizeUnityPath(unityPath);
                canonicalPath = paths.FromUnityAssetPath(projectRoot, cleanUnityPath).Value;
            }
            else if (requiresPath)
            {
                throw new ArgumentException("Unity write command requires a Unity path.", "unityPath");
            }

            string safeFileName = string.IsNullOrEmpty(generatedFileName) ? string.Empty : paths.MakeSafeFileName(generatedFileName, 128);
            bool performed = false;
            string detail = "Dry-run validated by PathGuard; editor effects require a root-confined executor.";
            // UnityEditor APIs accept a pathname, not a root-bound handle. A
            // check followed by SaveScene/ImportAsset cannot prevent link swaps.
            // Until a confined editor executor exists, non-dry-run requests fail closed.
            if (!dryRun) throw new NotSupportedException("Unity editor effects require a root-confined executor. The built-in bridge supports dry-run validation only.");
            return new UnityBridgeWriteResult
            {
                Ok = true,
                Command = command,
                ProjectId = projectId,
                UnityPath = cleanUnityPath,
                CanonicalPath = canonicalPath,
                SafeFileName = safeFileName,
                DryRun = dryRun,
                Performed = performed,
                Detail = detail,
            };
        }

        public void AppendLog(string level, string message, string timestamp = null)
        {
            if (string.IsNullOrEmpty(level)) throw new ArgumentException("level is required.", "level");
            if (message == null) throw new ArgumentNullException("message");
            logs.Add(new UnityBridgeLogEntry
            {
                Level = level,
                Message = message,
                Timestamp = timestamp ?? DateTime.UtcNow.ToString("o"),
            });
        }

        private static bool IsSupportedWriteCommand(string command)
        {
            return command == "assets.refresh"
                || command == "scene.save"
                || command == "asset.import"
                || command == "prefab.create"
                || command == "module.create";
        }

        private static bool RequiresUnityPath(string command)
        {
            return command != "assets.refresh";
        }

    }
}
