using System;
using System.Collections.Generic;
using System.IO;
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
        private readonly ICanonicalPathService paths;
        private readonly CanonicalPathValue projectRoot;
        private readonly string projectId;
        private readonly string projectName;
        private readonly string unityVersion;
        private readonly List<UnityBridgeLogEntry> logs = new List<UnityBridgeLogEntry>();

        public UnityBridgeBuiltins(string projectId, CanonicalPathValue projectRoot, string projectName, string unityVersion, ICanonicalPathService paths = null)
        {
            if (string.IsNullOrEmpty(projectId)) throw new ArgumentException("projectId is required.", "projectId");
            this.projectId = projectId;
            this.projectRoot = projectRoot;
            this.projectName = projectName ?? string.Empty;
            this.unityVersion = unityVersion ?? string.Empty;
            this.paths = paths ?? BridgeCanonicalPathService.Instance;
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
            if (maxChars < 1) throw new ArgumentOutOfRangeException("maxChars", "maxChars must be positive.");
            string cleanUnityPath = PathGuard.NormalizeUnityPath(unityPath);
            CanonicalPathValue canonicalPath = paths.FromUnityAssetPath(projectRoot, cleanUnityPath);
            string text = File.ReadAllText(canonicalPath.Value, Encoding.UTF8);
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
            string detail = "Write command validated by PathGuard; connect UnityEditor implementation to perform it.";
            if (!dryRun) performed = TryPerformUnityEditorWrite(command, cleanUnityPath, out detail);
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

        private static bool TryPerformUnityEditorWrite(string command, string cleanUnityPath, out string detail)
        {
#if UNITY_EDITOR
            if (command == "assets.refresh")
            {
                UnityEditor.AssetDatabase.Refresh();
                detail = "AssetDatabase.Refresh executed.";
                return true;
            }
            if (command == "asset.import")
            {
                UnityEditor.AssetDatabase.ImportAsset(cleanUnityPath);
                detail = "AssetDatabase.ImportAsset executed.";
                return true;
            }
            if (command == "scene.save")
            {
                UnityEngine.SceneManagement.Scene scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
                if (!scene.IsValid()) throw new InvalidOperationException("No active scene is available to save.");
                if (!UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, cleanUnityPath)) throw new InvalidOperationException("Unity failed to save the active scene.");
                detail = "EditorSceneManager.SaveScene executed.";
                return true;
            }
            detail = "Command validated; prefab/module creation requires a bridge-specific implementation.";
            return false;
#else
            detail = "Command validated; UnityEditor write execution is available only inside the Unity Editor.";
            return false;
#endif
        }
    }
}
