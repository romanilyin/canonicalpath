import { CanonicalPathBroker } from "./broker.js";
import type {
  UnityBridgeScopedEntry,
  UnityBridgeScopedGlobResult,
  UnityBridgeScopedListResult,
  UnityBridgeScopedTextResult,
  UnityBridgeScopedWriteResult,
  UnityBridgeClient,
  UnityBridgeLogEntry,
  UnityBridgePathValidation,
  UnityBridgeProjectInfo,
  UnityBridgeReadResult,
  UnityBridgeStatus,
  UnityBridgeWriteCommand,
  UnityBridgeWriteRequest,
  UnityBridgeWriteResult,
  UnityMcpArtifactRef,
  UnityPathValidationOptions,
} from "./types.js";
import type { UnityMcpWorkflowScope } from "./path-service.js";
import type { CanonicalRelativePath } from "../canonicalpath/index.js";
import { pathError } from "../canonicalpath/errors.js";

export interface FakeUnityBridgeOptions {
  projectName?: string;
  unityVersion?: string;
  logs?: UnityBridgeLogEntry[];
  files?: Record<string, string>;
  scopedFiles?: Record<string, string>;
}

export class FakeUnityBridge implements UnityBridgeClient {
  private readonly logs: UnityBridgeLogEntry[];
  private readonly scopedFiles = new Map<string, string>();

  constructor(
    readonly broker: CanonicalPathBroker,
    private readonly options: FakeUnityBridgeOptions = {},
  ) {
    this.logs = [...(options.logs ?? [])];
    for (const [key, value] of Object.entries(options.scopedFiles ?? {})) this.scopedFiles.set(key, value);
  }

  async status(projectId?: string): Promise<UnityBridgeStatus> {
    return {
      state: "ready",
      projectId,
      projectName: this.options.projectName,
      unityVersion: this.options.unityVersion,
    };
  }

  async projectInfo(projectId: string): Promise<UnityBridgeProjectInfo> {
    const project = this.broker.getProject(projectId);
    return {
      projectId,
      canonicalProjectPath: project.canonicalProjectPath,
      hostRoot: project.hostRoot,
      pathAliases: project.pathAliases,
      projectName: this.options.projectName,
      unityVersion: this.options.unityVersion,
    };
  }

  async readLog(_projectId?: string, maxEntries = 100): Promise<UnityBridgeLogEntry[]> {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) return [];
    return this.logs.slice(-maxEntries);
  }

  async readText(projectId: string, unityPath: string, maxChars = 1_048_576): Promise<UnityBridgeReadResult> {
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer");
    const validation = this.broker.validateUnityAssetPath(projectId, unityPath);
    const text = this.options.files?.[fileKey(projectId, validation.unityPath)] ?? "";
    const truncated = text.length > maxChars;
    return {
      projectId,
      unityPath: validation.unityPath,
      canonicalPath: validation.canonicalPath,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  }

  async readScopedText(projectId: string, scope: UnityMcpWorkflowScope, path: string, maxChars?: number): Promise<UnityBridgeScopedTextResult> {
    const limit = boundedPositiveInteger(maxChars, 65_536, 1_048_576, "maxChars");
    const resolved = this.resolveWorkflowPath(projectId, scope, path);
    const text = this.scopedFiles.get(scopedFileKey(projectId, scope, resolved.path)) ?? "";
    const truncated = text.length > limit;
    return {
      projectId,
      scope,
      path: resolved.path,
      projectRelativePath: resolved.projectRelativePath,
      text: truncated ? text.slice(0, limit) : text,
      truncated,
      artifactRef: artifactRef(scope, resolved.path),
    };
  }

  async writeScopedText(projectId: string, scope: UnityMcpWorkflowScope, path: string, text: string, maxChars?: number): Promise<UnityBridgeScopedWriteResult> {
    if (typeof text !== "string") throw pathError("ERR_INVALID_PATH", "text must be a string");
    const limit = boundedPositiveInteger(maxChars, 1_048_576, 1_048_576, "maxChars");
    if (text.length > limit) throw pathError("ERR_INVALID_PATH", "text exceeds bounded write limit");
    const resolved = this.resolveWorkflowPath(projectId, scope, path);
    this.scopedFiles.set(scopedFileKey(projectId, scope, resolved.path), text);
    return {
      ok: true,
      projectId,
      scope,
      path: resolved.path,
      projectRelativePath: resolved.projectRelativePath,
      chars: text.length,
      artifactRef: artifactRef(scope, resolved.path),
    };
  }

  async listScoped(projectId: string, scope: UnityMcpWorkflowScope, pathPrefix?: string, maxEntries?: number): Promise<UnityBridgeScopedListResult> {
    const limit = boundedPositiveInteger(maxEntries, 100, 1000, "maxEntries");
    const prefix = pathPrefix === undefined ? undefined : this.resolveWorkflowPath(projectId, scope, pathPrefix).path;
    const entries = this.scopedEntries(projectId, scope).filter((entry) => prefix === undefined || isUnderPrefix(entry.path, prefix));
    return {
      projectId,
      scope,
      pathPrefix: prefix,
      entries: entries.slice(0, limit),
      truncated: entries.length > limit,
    };
  }

  async globScoped(projectId: string, scope: UnityMcpWorkflowScope, glob: string, maxEntries?: number): Promise<UnityBridgeScopedGlobResult> {
    this.broker.getProject(projectId);
    const cleanGlob = this.broker.paths.normalizeScopedGlobPattern(scope, glob);
    const limit = boundedPositiveInteger(maxEntries, 100, 1000, "maxEntries");
    const pattern = globToRegExp(cleanGlob);
    const entries = this.scopedEntries(projectId, scope).filter((entry) => pattern.test(entry.path));
    return {
      projectId,
      scope,
      glob: cleanGlob,
      entries: entries.slice(0, limit),
      truncated: entries.length > limit,
    };
  }

  async validatePath(projectId: string, unityPath: string, options: UnityPathValidationOptions = {}): Promise<UnityBridgePathValidation> {
    return this.broker.validateUnityAssetPath(projectId, unityPath, options);
  }

  async writeCommand(command: UnityBridgeWriteCommand, request: UnityBridgeWriteRequest): Promise<UnityBridgeWriteResult> {
    const dryRun = request.dryRun !== false;
    const validation = request.unityPath === undefined ? undefined : this.broker.validateUnityAssetPath(request.projectId, request.unityPath, { generatedFileName: request.generatedFileName });
    if (requiresUnityPath(command) && validation === undefined) throw new Error(`${command} requires unityPath`);
    return {
      ok: true,
      command,
      projectId: request.projectId,
      unityPath: validation?.unityPath,
      canonicalPath: validation?.canonicalPath,
      safeFileName: validation?.safeFileName,
      dryRun,
      performed: false,
      detail: dryRun ? "fake bridge dry-run only" : "fake bridge recorded command only",
    };
  }

  appendLog(level: UnityBridgeLogEntry["level"], message: string, timestamp = new Date(0).toISOString()): void {
    this.logs.push({ level, message, timestamp });
  }

  private resolveWorkflowPath(projectId: string, scope: UnityMcpWorkflowScope, path: string): { path: CanonicalRelativePath; projectRelativePath: CanonicalRelativePath } {
    this.broker.getProject(projectId);
    if (scope !== "knowledge" && scope !== "artifact") throw pathError("ERR_INVALID_PATH", "workflow scope must be knowledge or artifact");
    const resolved = this.broker.paths.normalizeScopedPath(scope, path);
    if (resolved.kind !== "project") throw pathError("ERR_INVALID_PATH", "workflow path must be project-backed");
    return { path: path as CanonicalRelativePath, projectRelativePath: resolved.path };
  }

  private scopedEntries(projectId: string, scope: UnityMcpWorkflowScope): UnityBridgeScopedEntry[] {
    this.broker.getProject(projectId);
    const prefix = `${projectId}\0${scope}\0`;
    const entries: UnityBridgeScopedEntry[] = [];
    for (const [key, text] of this.scopedFiles) {
      if (!key.startsWith(prefix)) continue;
      const path = key.slice(prefix.length) as CanonicalRelativePath;
      const resolved = this.broker.paths.normalizeScopedPath(scope, path);
      if (resolved.kind !== "project") continue;
      entries.push({ scope, path, projectRelativePath: resolved.path, kind: "file", chars: text.length, artifactRef: artifactRef(scope, path) });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
  }
}

export function fakeUnityFileKey(projectId: string, unityPath: string): string {
  return fileKey(projectId, unityPath);
}

export function fakeUnityScopedFileKey(projectId: string, scope: UnityMcpWorkflowScope, path: string): string {
  return scopedFileKey(projectId, scope, path);
}

function fileKey(projectId: string, unityPath: string): string {
  return `${projectId}:${unityPath}`;
}

function scopedFileKey(projectId: string, scope: UnityMcpWorkflowScope, path: string): string {
  return `${projectId}\0${scope}\0${path}`;
}

function artifactRef(scope: UnityMcpWorkflowScope, path: CanonicalRelativePath): UnityMcpArtifactRef | undefined {
  return scope === "artifact" ? { scope: "artifact", path } : undefined;
}

function boundedPositiveInteger(value: number | undefined, defaultValue: number, hardCap: number, label: string): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1) throw pathError("ERR_INVALID_PATH", `${label} must be a positive integer`);
  if (value > hardCap) throw pathError("ERR_INVALID_PATH", `${label} exceeds hard cap`);
  return value;
}

function isUnderPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        pattern += ".*";
        i++;
      } else {
        pattern += "[^/]*";
      }
    } else if (ch === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(ch);
    }
  }
  return new RegExp(`${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function requiresUnityPath(command: UnityBridgeWriteCommand): boolean {
  return command !== "assets.refresh";
}
