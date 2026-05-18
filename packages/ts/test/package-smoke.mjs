import { join, normalize, relative } from "@romanilyin/canonicalpath";
import { toWin32 } from "@romanilyin/canonicalpath/canonicalpath";
import { canonicalFSLimitations, validateRelativePath } from "@romanilyin/canonicalpath/canonicalfs";
import { CanonicalPathService, normalizeScopedPath } from "@romanilyin/canonicalpath/unity-gateway";

const root = normalize("/repo/src/..");
const target = normalize("/repo/src/file.txt");
const rel = relative(root, target);
const joined = join(root, rel);
const win32 = toWin32(normalize("C:\\Repo\\README.md"));
const fsRel = validateRelativePath("safe/file.txt");
const scoped = normalizeScopedPath("knowledge", "notes/agent.md");
const service = new CanonicalPathService();

if (root !== "/repo") throw new Error(`unexpected root: ${root}`);
if (rel !== "src/file.txt") throw new Error(`unexpected relative path: ${rel}`);
if (joined !== "/repo/src/file.txt") throw new Error(`unexpected joined path: ${joined}`);
if (win32 !== "C:\\Repo\\README.md") throw new Error(`unexpected Win32 serialization: ${win32}`);
if (fsRel !== "safe/file.txt") throw new Error(`unexpected canonicalfs relative path: ${fsRel}`);
if (!canonicalFSLimitations.includes("best-effort")) throw new Error("canonicalfs limitations text changed unexpectedly");
if (scoped.path !== "Assets/UnityMcpKnowledge/notes/agent.md") throw new Error(`unexpected scoped path: ${scoped.path}`);
if (service.normalizeUnityAssetPath("Assets/Scene.unity") !== "Assets/Scene.unity") throw new Error("unity gateway service export failed");
