import { hasDriveRoot } from "../canonicalpath/internal.js";
import { pathError } from "../canonicalpath/errors.js";
import type { CanonicalPath, HostKind, NormalizeOptions } from "../canonicalpath/types.js";
import { CanonicalPathService } from "./path-service.js";
import type { NativeHostKind, UnityBridgePathValidation, UnityPathValidationOptions, UnityProjectPathAlias, UnityProjectPathAliasRegistration, UnityProjectPathAliasSelector, UnityProjectRecord, UnityProjectRegistration } from "./types.js";

export class CanonicalPathBroker {
  private readonly projects = new Map<string, UnityProjectRecord>();

  constructor(readonly paths = new CanonicalPathService()) {}

  registerProject(registration: UnityProjectRegistration): UnityProjectRecord {
    if (registration.projectId === "") throw pathError("ERR_INVALID_PATH", "projectId is required");
    if (registration.projectId.includes("\0")) throw pathError("ERR_NUL_BYTE", "projectId contains NUL");

    const normalizeOptions = copyOptions({ ...registration.normalizeOptions, sourceHost: registration.normalizeOptions?.sourceHost ?? "posix" });
    const record: UnityProjectRecord = {
      projectId: registration.projectId,
      canonicalProjectPath: this.paths.normalizeProjectRoot(registration.projectRoot, normalizeOptions),
      normalizeOptions,
      hostRoot: registration.hostRoot,
      pathAliases: [],
    };
    if (registration.hostRoot !== undefined) {
      this.addPathAlias(record, {
        clientType: "gateway",
        clientId: "default",
        environmentId: "default",
        hostKind: requireNativeHostKind(normalizeOptions.sourceHost),
        hostRoot: registration.hostRoot,
        normalizeOptions,
        label: "default host root",
      });
    }
    for (const alias of registration.aliases ?? []) this.addPathAlias(record, alias);
    this.projects.set(record.projectId, record);
    return copyProject(record);
  }

  getProject(projectId: string): UnityProjectRecord {
    return copyProject(this.requireProject(projectId));
  }

  private requireProject(projectId: string): UnityProjectRecord {
    const project = this.projects.get(projectId);
    if (!project) throw pathError("ERR_INVALID_PATH", `unknown Unity project ${projectId}`);
    return project;
  }

  listProjects(): UnityProjectRecord[] {
    return [...this.projects.values()].map(copyProject);
  }

  registerPathAlias(projectId: string, registration: UnityProjectPathAliasRegistration): UnityProjectPathAlias {
    return copyAlias(this.addPathAlias(this.requireProject(projectId), registration));
  }

  private addPathAlias(project: UnityProjectRecord, registration: UnityProjectPathAliasRegistration): UnityProjectPathAlias {
    const alias = this.createPathAlias(project, registration);
    if (project.pathAliases.some((existing) => pathAliasKey(existing) === pathAliasKey(alias))) {
      throw pathError("ERR_INVALID_PATH", "path alias already exists for project/client/environment");
    }
    project.pathAliases.push(alias);
    return alias;
  }

  listPathAliases(projectId: string): UnityProjectPathAlias[] {
    return [...this.getProject(projectId).pathAliases];
  }

  getPathAlias(projectId: string, selector: UnityProjectPathAliasSelector): UnityProjectPathAlias {
    const matches = this.listPathAliases(projectId).filter((alias) => pathAliasMatches(alias, selector));
    if (matches.length === 0) throw pathError("ERR_INVALID_PATH", `no path alias for Unity project ${projectId}`);
    if (matches.length > 1) throw pathError("ERR_INVALID_PATH", `ambiguous path alias for Unity project ${projectId}`);
    return matches[0];
  }

  resolveHostRoot(projectId: string, selector: UnityProjectPathAliasSelector = {}): string | undefined {
    const project = this.getProject(projectId);
    if (Object.keys(selector).length === 0) return project.hostRoot ?? (project.pathAliases.length === 1 ? project.pathAliases[0]?.hostRoot : undefined);
    return this.getPathAlias(projectId, selector).hostRoot;
  }

  fromUnityAssetPath(projectId: string, unityPath: string): CanonicalPath {
    return this.paths.fromUnityAssetPath(this.getProject(projectId).canonicalProjectPath, unityPath);
  }

  toUnityAssetPath(projectId: string, fullPath: CanonicalPath): string {
    return this.paths.toUnityAssetPath(this.getProject(projectId).canonicalProjectPath, fullPath);
  }

  validateUnityAssetPath(projectId: string, unityPath: string, options: UnityPathValidationOptions = {}): UnityBridgePathValidation {
    const project = this.getProject(projectId);
    const cleanUnityPath = this.paths.normalizeUnityAssetPath(unityPath);
    const result: UnityBridgePathValidation = {
      ok: true,
      projectId,
      unityPath: cleanUnityPath,
      canonicalPath: this.paths.fromUnityAssetPath(project.canonicalProjectPath, cleanUnityPath),
    };
    if (options.generatedFileName !== undefined) {
      result.safeFileName = this.paths.makeSafeFileName(options.generatedFileName, options.maxFileNameLength ?? 128);
    }
    return result;
  }

  private createPathAlias(project: UnityProjectRecord, registration: UnityProjectPathAliasRegistration): UnityProjectPathAlias {
    assertAliasString(registration.clientType, "clientType");
    assertAliasString(registration.clientId, "clientId");
    assertAliasString(registration.environmentId, "environmentId");
    assertAliasString(registration.hostRoot, "hostRoot");
    const { hostKind, normalizeOptions } = nativeAliasOptions(registration, project.normalizeOptions);
    // Native POSIX backslashes are component data, including a literal \..\.
    // Only Windows grammar treats them as separators for absolute/dot checks.
    const nativeRoot = hostKind === "win32" ? registration.hostRoot.replaceAll("\\", "/") : registration.hostRoot;
    const absolute = hostKind === "win32"
      ? hasDriveRoot(nativeRoot) || nativeRoot.startsWith("//")
      : nativeRoot.startsWith("/") && (!nativeRoot.startsWith("//") || nativeRoot.startsWith("///"));
    if (!absolute || nativeRoot.split("/").some((part) => part === "." || part === "..")) {
      throw pathError("ERR_INVALID_PATH", "path alias hostRoot must be an absolute native path without dot segments");
    }
    const aliasCanonicalPath = this.paths.normalizeProjectRoot(registration.hostRoot, normalizeOptions);
    if (aliasCanonicalPath !== project.canonicalProjectPath) {
      throw pathError("ERR_INVALID_PATH", "path alias hostRoot does not match canonical project identity");
    }
    return {
      projectId: project.projectId,
      canonicalProjectPath: project.canonicalProjectPath,
      clientType: registration.clientType,
      clientId: registration.clientId,
      environmentId: registration.environmentId,
      hostKind,
      hostRoot: registration.hostRoot,
      normalizeOptions,
      label: registration.label,
    };
  }
}

function assertAliasString(value: string, label: string): void {
  if (value === "") throw pathError("ERR_INVALID_PATH", `${label} is required`);
  if (value.includes("\0")) throw pathError("ERR_NUL_BYTE", `${label} contains NUL`);
}

function isNativeHostKind(value: HostKind | undefined): value is NativeHostKind {
  return value === "posix" || value === "win32" || value === "wsl";
}

function requireNativeHostKind(value: HostKind | undefined): NativeHostKind {
  if (!isNativeHostKind(value)) throw pathError("ERR_INVALID_PATH", "path alias requires a native host kind: posix, win32 or wsl");
  return value;
}

function nativeAliasOptions(registration: UnityProjectPathAliasRegistration, projectOptions: NormalizeOptions | undefined): { hostKind: NativeHostKind; normalizeOptions: NormalizeOptions } {
  const requestedSource = registration.normalizeOptions?.sourceHost;
  const inheritedSource = projectOptions?.sourceHost;
  const hostKind = requireNativeHostKind(registration.hostKind ?? requestedSource ?? (isNativeHostKind(inheritedSource) ? inheritedSource : "posix"));
  if (requestedSource !== undefined && requestedSource !== hostKind) {
    throw pathError("ERR_INVALID_PATH", "path alias hostKind and sourceHost must select the same native grammar");
  }
  // An alias's explicit options replace project options. Inherit only when the
  // project selected this same native grammar; canonical/URI input is not I/O.
  const base = registration.normalizeOptions ?? (inheritedSource === hostKind ? projectOptions : undefined);
  const normalizeOptions = copyOptions({ ...base, sourceHost: hostKind });
  if (normalizeOptions.trimOuterWhitespace) throw pathError("ERR_INVALID_PATH", "native alias normalization must not trim retained hostRoot data");
  if (hostKind === "wsl" && !normalizeOptions.wsl?.enabled) {
    throw pathError("ERR_INVALID_PATH", "native WSL aliases require explicit WSL mapping; use posix for unmapped native paths");
  }
  return { hostKind, normalizeOptions };
}

function copyOptions(options: NormalizeOptions): NormalizeOptions {
  return {
    ...options,
    ...(options.wsl === undefined ? {} : { wsl: { ...options.wsl } }),
    ...(options.uri === undefined ? {} : { uri: { ...options.uri } }),
    ...(options.windows === undefined ? {} : { windows: { ...options.windows } }),
  };
}

function copyAlias(alias: UnityProjectPathAlias): UnityProjectPathAlias {
  return { ...alias, normalizeOptions: alias.normalizeOptions === undefined ? undefined : copyOptions(alias.normalizeOptions) };
}

function copyProject(project: UnityProjectRecord): UnityProjectRecord {
  return { ...project, normalizeOptions: project.normalizeOptions === undefined ? undefined : copyOptions(project.normalizeOptions), pathAliases: project.pathAliases.map(copyAlias) };
}

function pathAliasKey(alias: Pick<UnityProjectPathAlias, "clientType" | "clientId" | "environmentId">): string {
  return `${alias.clientType}\0${alias.clientId}\0${alias.environmentId}`;
}

function pathAliasMatches(alias: UnityProjectPathAlias, selector: UnityProjectPathAliasSelector): boolean {
  if (selector.clientType !== undefined && alias.clientType !== selector.clientType) return false;
  if (selector.clientId !== undefined && alias.clientId !== selector.clientId) return false;
  if (selector.environmentId !== undefined && alias.environmentId !== selector.environmentId) return false;
  if (selector.hostKind !== undefined && alias.hostKind !== selector.hostKind) return false;
  return true;
}
