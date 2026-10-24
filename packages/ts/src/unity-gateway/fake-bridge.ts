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

// These caps apply to work, independently of the caller's returned-entry cap.
// Count the entire store so unrelated project/scope entries cannot hide a scan.
const maxScopedEntriesExamined = 10_000;
const maxScopedStoredEntries = 10_000;
const maxScopedStoredUnits = 8_388_608;
const maxScopedValueUnits = 1_048_576;
const maxScopedQueryWork = 4_000_000;
const scopedEntryOrder = new Intl.Collator(undefined, { numeric: true });

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
  private scopedStoredUnits = 0;
  private readonly options: Pick<FakeUnityBridgeOptions, "projectName" | "unityVersion" | "files">;

  constructor(
    readonly broker: CanonicalPathBroker,
    options: FakeUnityBridgeOptions = {},
  ) {
    this.options = { projectName: options.projectName, unityVersion: options.unityVersion, files: options.files };
    this.logs = [...(options.logs ?? [])];
    // Do not retain the caller's seed object: it could grow after admission.
    const seeds = options.scopedFiles ?? {};
    for (const key in seeds) {
      if (!Object.hasOwn(seeds, key)) continue;
      if (key.length > maxScopedStoredUnits) throw pathError("ERR_INVALID_PATH", "scoped storage exceeds retained-unit limit");
      const parts = key.split("\0");
      if (parts.length !== 3 || (parts[1] !== "knowledge" && parts[1] !== "artifact")) throw pathError("ERR_INVALID_PATH", "invalid scoped seed key");
      const [projectId, scope, path] = parts as [string, UnityMcpWorkflowScope, string];
      const resolved = this.resolveWorkflowPath(projectId, scope, path);
      this.storeScopedText(scopedFileKey(projectId, scope, resolved.path), seeds[key]);
    }
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
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 1_048_576) throw new Error("maxChars must be a positive integer");
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
    this.storeScopedText(scopedFileKey(projectId, scope, resolved.path), text);
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
    const entries = this.scopedEntries(projectId, scope, (path, budget) => {
      if (prefix === undefined) return true;
      budget.consume(path.length + prefix.length);
      return isUnderPrefix(path, prefix);
    });
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
    const matches = compileScopedGlob(cleanGlob);
    const entries = this.scopedEntries(projectId, scope, matches);
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

  private storeScopedText(key: string, text: string): void {
    if (typeof text !== "string") throw pathError("ERR_INVALID_PATH", "text must be a string");
    if (text.length > maxScopedValueUnits) throw pathError("ERR_INVALID_PATH", "text exceeds bounded write limit");
    const previous = this.scopedFiles.get(key);
    const newEntry = previous === undefined;
    if (newEntry && this.scopedFiles.size >= maxScopedStoredEntries) throw pathError("ERR_INVALID_PATH", "scoped storage exceeds entry limit");
    // Charge both the exact composite key and content in UTF-16 code units.
    // A failed replacement must neither change the value nor consume capacity.
    const projected = this.scopedStoredUnits + (newEntry ? key.length : 0) + text.length - (previous?.length ?? 0);
    if (projected > maxScopedStoredUnits) throw pathError("ERR_INVALID_PATH", "scoped storage exceeds retained-unit limit");
    this.scopedFiles.set(key, text);
    this.scopedStoredUnits = projected;
  }

  private resolveWorkflowPath(projectId: string, scope: UnityMcpWorkflowScope, path: string): { path: CanonicalRelativePath; projectRelativePath: CanonicalRelativePath } {
    this.broker.getProject(projectId);
    if (scope !== "knowledge" && scope !== "artifact") throw pathError("ERR_INVALID_PATH", "workflow scope must be knowledge or artifact");
    const resolved = this.broker.paths.normalizeScopedPath(scope, path);
    if (resolved.kind !== "project") throw pathError("ERR_INVALID_PATH", "workflow path must be project-backed");
    return { path: path as CanonicalRelativePath, projectRelativePath: resolved.path };
  }

  private scopedEntries(projectId: string, scope: UnityMcpWorkflowScope, accepts: (path: string, budget: ScopedQueryBudget) => boolean): UnityBridgeScopedEntry[] {
    this.broker.getProject(projectId);
    if (this.scopedFiles.size > maxScopedEntriesExamined) throw pathError("ERR_INVALID_PATH", "scoped query exceeds examined-entry limit");
    const budget = new ScopedQueryBudget();
    const prefix = `${projectId}\0${scope}\0`;
    const entries: UnityBridgeScopedEntry[] = [];
    for (const [key, text] of this.scopedFiles) {
      budget.consume(Math.min(key.length, prefix.length));
      if (!key.startsWith(prefix)) continue;
      const path = key.slice(prefix.length) as CanonicalRelativePath;
      // Charge validation before scanning or splitting a stored path. Seed data
      // passes through the same checks as files written through the tool API.
      budget.consume(path.length);
      const resolved = this.broker.paths.normalizeScopedPath(scope, path);
      if (resolved.kind !== "project") continue;
      if (!accepts(path, budget)) continue;
      entries.push({ scope, path, projectRelativePath: resolved.path, kind: "file", chars: text.length, artifactRef: artifactRef(scope, path) });
    }
    return entries.sort((left, right) => {
      budget.consume(left.path.length + right.path.length);
      return scopedEntryOrder.compare(left.path, right.path);
    });
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

class ScopedQueryBudget {
  private remaining = maxScopedQueryWork;

  consume(units: number): void {
    if (units > this.remaining) throw pathError("ERR_INVALID_PATH", "scoped query exceeds matching or traversal work limit");
    this.remaining -= units;
  }
}

function compileScopedGlob(glob: string): (path: string, budget: ScopedQueryBudget) => boolean {
  const tokens: string[] = [];
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      // Consecutive globstars have identical languages; an odd final single
      // star stays separate because it can consume a line terminator.
      if (tokens[tokens.length - 1] !== "**") tokens.push("**");
      i++;
    } else {
      tokens.push(ch);
    }
  }

  // Iterative NFA/DP: one state per pattern token, with no recursive search or
  // backtracking. For a fixed bounded pattern, work is linear in path length.
  // UTF-16 units, slash handling and globstar line-terminator behavior match
  // the former non-Unicode JavaScript RegExp grammar exactly.
  const width = tokens.length + 1;
  let previous = new Uint8Array(width);
  let current = new Uint8Array(width);
  return (path, budget) => {
    budget.consume(width * (path.length + 1));
    previous[0] = 1;
    for (let i = 1; i < width; i++) {
      const token = tokens[i - 1];
      previous[i] = token === "*" || token === "**" ? previous[i - 1] : 0;
    }
    for (let offset = 0; offset < path.length; offset++) {
      const ch = path[offset];
      current[0] = 0;
      for (let i = 1; i < width; i++) {
        const token = tokens[i - 1];
        if (token === "*" || token === "**") {
          const consumes = token === "*" ? ch !== "/" : !isLineTerminator(ch);
          current[i] = current[i - 1] || (consumes ? previous[i] : 0);
        } else {
          current[i] = previous[i - 1] && (token === "?" ? ch !== "/" : token === ch) ? 1 : 0;
        }
      }
      const swap = previous;
      previous = current;
      current = swap;
    }
    return previous[width - 1] !== 0;
  };
}

function isLineTerminator(value: string): boolean {
  return value === "\n" || value === "\r" || value === "\u2028" || value === "\u2029";
}

function requiresUnityPath(command: UnityBridgeWriteCommand): boolean {
  return command !== "assets.refresh";
}
