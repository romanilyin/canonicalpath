import { createHash } from "node:crypto";
import { join, normalize, normalizeRelative, relative } from "../canonicalpath/index.js";
import { pathError } from "../canonicalpath/errors.js";
import type { CanonicalPath, CanonicalRelativePath, NormalizeOptions } from "../canonicalpath/types.js";

export type UnityMcpPathScope = "unity_asset" | "knowledge" | "package_manifest" | "artifact" | "gateway_cache" | "temp_session";
export type UnityMcpWorkflowScope = Extract<UnityMcpPathScope, "knowledge" | "artifact">;
export type ScopedPathKind = "project" | "cache";

export interface ScopedPathResult {
  scope: UnityMcpPathScope;
  kind: ScopedPathKind;
  path: CanonicalRelativePath;
}

export class CanonicalPathService {
  normalize(raw: string, options: NormalizeOptions = {}): CanonicalPath {
    return normalize(raw, options);
  }

  normalizeProjectRoot(raw: string, options: NormalizeOptions = {}): CanonicalPath {
    const projectRoot = normalize(raw, options);
    if (projectRoot === ".") throw pathError("ERR_INVALID_PATH", "Unity project root must be absolute");
    return projectRoot;
  }

  normalizeUnityAssetPath(raw: string): CanonicalRelativePath {
    if (raw === "") throw pathError("ERR_EMPTY_PATH", "Unity path is empty");
    if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "Unity path contains NUL");

    const value = raw.replaceAll("\\", "/");
    if (/^[A-Za-z]:/.test(value)) {
      throw pathError("ERR_ABSOLUTE_PATH", "Unity path must not be drive-qualified");
    }
    if (value.split("/").includes("..")) {
      throw pathError("ERR_OUTSIDE_ROOT", "Unity path traversal is not allowed");
    }

    const clean = normalizeRelative(value);
    if (!isAllowedUnityRoot(clean)) {
      throw pathError("ERR_INVALID_PATH", "Unity path must start with Assets/ or Packages/");
    }
    return clean;
  }

  normalizeScopedPath(scope: UnityMcpPathScope, raw: string): ScopedPathResult {
    return normalizeScopedPath(scope, raw);
  }

  normalizeScopedGlobPattern(scope: UnityMcpWorkflowScope, raw: string): CanonicalRelativePath {
    return normalizeScopedGlobPattern(scope, raw);
  }

  toScopedCanonicalPath(projectRoot: CanonicalPath, scope: UnityMcpPathScope, raw: string): CanonicalPath {
    return toScopedCanonicalPath(projectRoot, scope, raw);
  }

  fromUnityAssetPath(projectRoot: CanonicalPath, unityPath: string): CanonicalPath {
    return join(projectRoot, this.normalizeUnityAssetPath(unityPath));
  }

  toUnityAssetPath(projectRoot: CanonicalPath, fullPath: CanonicalPath): CanonicalRelativePath {
    return this.normalizeUnityAssetPath(relative(projectRoot, fullPath));
  }

  assertInsideProject(projectRoot: CanonicalPath, candidate: CanonicalPath): void {
    relative(projectRoot, candidate);
  }

  makeSafeFileName(input: string, maxLength = 128): string {
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      throw pathError("ERR_INVALID_COMPONENT", "maxLength must be a positive integer");
    }

    if (input === "") throw pathError("ERR_INVALID_COMPONENT", "file name input is empty");
    if (input.includes("\0")) throw pathError("ERR_NUL_BYTE", "file name input contains NUL");

    let safe = input.replace(/[\\/:\t\n\r]+/g, "-").replace(/^[ ._-]+|[ ._-]+$/g, "");
    if (safe === "") safe = "file";
    safe = escapeReservedWin32Component(safe);
    if (safe.length <= maxLength) return safe;
    if (maxLength <= 10) return trimGeneratedName(safe.slice(0, maxLength));

    const hash = createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8);
    const prefix = trimGeneratedName(safe.slice(0, maxLength - 10));
    return `${prefix}--${hash}`;
  }
}

export function normalizeScopedPath(scope: UnityMcpPathScope, raw: string): ScopedPathResult {
  const clean = validateScopedRelativeInput(raw);

  switch (scope) {
    case "unity_asset":
      return scopedProjectPath(scope, clean, startsWithAny(clean, ["Assets", "Packages"]));
    case "package_manifest":
      return packageManifestPath(scope, clean);
    case "knowledge":
      return prefixedScopedProjectPath(scope, "Assets/UnityMcpKnowledge", clean, isPlainScopeRelative(clean));
    case "artifact":
      return prefixedScopedProjectPath(scope, "Library/SGGUnityMcp", clean, startsWithAny(clean, ["job-artifacts", "screenshots"]));
    case "gateway_cache":
      if (!startsWithAny(clean, ["index"])) throw pathError("ERR_OUTSIDE_ROOT", "gateway cache path must be under index/");
      return { scope, kind: "cache", path: clean };
    case "temp_session":
      return prefixedScopedProjectPath(scope, "Temp/SGGUnityMcp", clean, isPlainScopeRelative(clean));
    default:
      throw pathError("ERR_INVALID_PATH", "unsupported Unity MCP path scope");
  }
}

export function toScopedCanonicalPath(projectRoot: CanonicalPath, scope: UnityMcpPathScope, raw: string): CanonicalPath {
  const result = normalizeScopedPath(scope, raw);
  if (result.kind !== "project") throw pathError("ERR_INVALID_PATH", "cache scoped paths are not project paths");
  return join(projectRoot, result.path);
}

export function normalizeScopedGlobPattern(scope: UnityMcpWorkflowScope, raw: string): CanonicalRelativePath {
  if (scope !== "knowledge" && scope !== "artifact") throw pathError("ERR_INVALID_PATH", "bounded workflow glob scope must be knowledge or artifact");
  const clean = validateScopedGlobInput(raw);
  if (scope === "artifact") {
    if (!startsWithAny(clean, ["job-artifacts", "screenshots"])) throw pathError("ERR_OUTSIDE_ROOT", "artifact glob must be under job-artifacts/ or screenshots/");
  } else if (!isPlainScopeGlob(clean)) {
    throw pathError("ERR_OUTSIDE_ROOT", "knowledge glob is outside its allowed root");
  }
  return clean;
}

function isAllowedUnityRoot(value: string): boolean {
  return value === "Assets" || value.startsWith("Assets/") || value === "Packages" || value.startsWith("Packages/");
}

function validateScopedRelativeInput(raw: string): CanonicalRelativePath {
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "scoped path is empty");
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "scoped path contains NUL");
  if (/^file:\/\//i.test(raw)) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed");
  if (/%(?:2f|5c|252f|255c)/i.test(raw)) throw pathError("ERR_ENCODED_SEPARATOR", "encoded path separators are not allowed");
  if (raw.startsWith("/") || raw.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(raw)) throw pathError("ERR_ABSOLUTE_PATH", "scoped path must be relative");
  if (/^[A-Za-z]:($|[^\\/])/.test(raw)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative scoped paths are not allowed");
  if (raw.includes("\\")) throw pathError("ERR_INVALID_PATH", "scoped paths must use slash separators");

  const parts = raw.split("/");
  if (parts.some((part) => part === "..")) throw pathError("ERR_OUTSIDE_ROOT", "scoped path traversal is not allowed");
  if (parts.some((part) => part === "" || part === "." || part.includes(":") || part.endsWith(".") || part.endsWith(" "))) {
    throw pathError("ERR_INVALID_PATH", "scoped path contains an invalid component");
  }
  if (raw.length > 4096 || parts.some((part) => part.length > 255)) throw pathError("ERR_INVALID_PATH", "scoped path exceeds length limits");
  return raw as CanonicalRelativePath;
}

function validateScopedGlobInput(raw: string): CanonicalRelativePath {
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "scoped glob is empty");
  if (raw.length > 512) throw pathError("ERR_INVALID_PATH", "scoped glob exceeds length limit");
  if (!raw.includes("*") && !raw.includes("?")) throw pathError("ERR_INVALID_PATH", "scoped glob must contain a wildcard");
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "scoped glob contains NUL");
  if (/^file:\/\//i.test(raw)) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed");
  if (/%(?:2f|5c|252f|255c)/i.test(raw)) throw pathError("ERR_ENCODED_SEPARATOR", "encoded path separators are not allowed");
  if (raw.startsWith("/") || raw.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(raw)) throw pathError("ERR_ABSOLUTE_PATH", "scoped glob must be relative");
  if (/^[A-Za-z]:($|[^\\/])/.test(raw)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative scoped globs are not allowed");
  if (raw.includes("\\")) throw pathError("ERR_INVALID_PATH", "scoped globs must use slash separators");

  const parts = raw.split("/");
  if (parts.some((part) => part === "..")) throw pathError("ERR_OUTSIDE_ROOT", "scoped glob traversal is not allowed");
  if (parts.some((part) => part === "" || part === "." || part.includes(":"))) throw pathError("ERR_INVALID_PATH", "scoped glob contains an invalid component");
  if (parts.some((part) => part.endsWith(".") || part.endsWith(" ") || part.length > 255)) throw pathError("ERR_INVALID_PATH", "scoped glob component exceeds policy limits");
  return raw as CanonicalRelativePath;
}

function scopedProjectPath(scope: UnityMcpPathScope, path: CanonicalRelativePath, allowed: boolean): ScopedPathResult {
  if (!allowed) throw pathError("ERR_OUTSIDE_ROOT", "scoped path is outside its allowed root");
  return { scope, kind: "project", path };
}

function packageManifestPath(scope: UnityMcpPathScope, path: CanonicalRelativePath): ScopedPathResult {
  if (path.startsWith("Packages/manifest.json/") || path.startsWith("Packages/packages-lock.json/")) {
    throw pathError("ERR_INVALID_PATH", "package manifest scope only accepts exact manifest files");
  }
  return scopedProjectPath(scope, path, path === "Packages/manifest.json" || path === "Packages/packages-lock.json");
}

function prefixedScopedProjectPath(scope: UnityMcpPathScope, root: string, path: CanonicalRelativePath, allowed: boolean): ScopedPathResult {
  if (!allowed) throw pathError("ERR_OUTSIDE_ROOT", "scoped path is outside its allowed root");
  return { scope, kind: "project", path: `${root}/${path}` as CanonicalRelativePath };
}

function isPlainScopeRelative(value: string): boolean {
  return !startsWithAny(value, [
    "Assets",
    "AssetsEvil",
    "Packages",
    "PackagesEvil",
    "ProjectSettings",
    "Library",
    "Temp",
    "UnityMcpKnowledge",
    "UnityMcpKnowledgeEvil",
    "UnityMcpArtifacts",
    "UnityMcpGatewayCache",
    "UnityMcpTempSession",
  ]);
}

function isPlainScopeGlob(value: string): boolean {
  const firstComponent = value.split("/")[0] ?? "";
  const literalPrefix = firstComponent.replace(/[?*].*$/, "");
  return !startsWithAny(literalPrefix, [
    "Assets",
    "AssetsEvil",
    "Packages",
    "PackagesEvil",
    "ProjectSettings",
    "Library",
    "Temp",
    "UnityMcpKnowledge",
    "UnityMcpKnowledgeEvil",
    "UnityMcpArtifacts",
    "UnityMcpGatewayCache",
    "UnityMcpTempSession",
  ]);
}

function startsWithAny(value: string, roots: string[]): boolean {
  return roots.some((root) => value === root || value.startsWith(`${root}/`));
}

function trimGeneratedName(value: string): string {
  return value.replace(/[ ._-]+$/g, "") || "file";
}

function escapeReservedWin32Component(value: string): string {
  const dot = value.indexOf(".");
  const base = dot >= 0 ? value.slice(0, dot) : value;
  const suffix = dot >= 0 ? value.slice(dot) : "";
  return isReservedDeviceBase(base) ? `${base}-${suffix}` : value;
}

function isReservedDeviceBase(value: string): boolean {
  const upper = value.toUpperCase();
  return upper === "CON" || upper === "PRN" || upper === "AUX" || upper === "NUL" || /^(COM|LPT)[1-9]$/.test(upper);
}
