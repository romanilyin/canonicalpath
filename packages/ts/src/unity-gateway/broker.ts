import { pathError } from "../canonicalpath/errors.js";
import type { CanonicalPath, HostKind, NormalizeOptions } from "../canonicalpath/types.js";
import { CanonicalPathService } from "./path-service.js";
import type { UnityBridgePathValidation, UnityPathValidationOptions, UnityProjectPathAlias, UnityProjectPathAliasRegistration, UnityProjectPathAliasSelector, UnityProjectRecord, UnityProjectRegistration } from "./types.js";

export class CanonicalPathBroker {
  private readonly projects = new Map<string, UnityProjectRecord>();

  constructor(readonly paths = new CanonicalPathService()) {}

  registerProject(registration: UnityProjectRegistration): UnityProjectRecord {
    if (registration.projectId === "") throw pathError("ERR_INVALID_PATH", "projectId is required");
    if (registration.projectId.includes("\0")) throw pathError("ERR_NUL_BYTE", "projectId contains NUL");

    const record: UnityProjectRecord = {
      projectId: registration.projectId,
      canonicalProjectPath: this.paths.normalizeProjectRoot(registration.projectRoot, registration.normalizeOptions),
      normalizeOptions: registration.normalizeOptions,
      hostRoot: registration.hostRoot,
      pathAliases: [],
    };
    if (registration.hostRoot !== undefined) {
      this.addPathAlias(record, {
        clientType: "gateway",
        clientId: "default",
        environmentId: "default",
        hostKind: defaultHostKind(registration.normalizeOptions),
        hostRoot: registration.hostRoot,
        normalizeOptions: registration.normalizeOptions,
        label: "default host root",
      });
    }
    for (const alias of registration.aliases ?? []) this.addPathAlias(record, alias);
    this.projects.set(record.projectId, record);
    return record;
  }

  getProject(projectId: string): UnityProjectRecord {
    const project = this.projects.get(projectId);
    if (!project) throw pathError("ERR_INVALID_PATH", `unknown Unity project ${projectId}`);
    return project;
  }

  listProjects(): UnityProjectRecord[] {
    return [...this.projects.values()];
  }

  registerPathAlias(projectId: string, registration: UnityProjectPathAliasRegistration): UnityProjectPathAlias {
    return this.addPathAlias(this.getProject(projectId), registration);
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
    const normalizeOptions = registration.normalizeOptions ?? project.normalizeOptions;
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
      hostKind: registration.hostKind ?? defaultHostKind(normalizeOptions),
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

function defaultHostKind(options: NormalizeOptions | undefined): HostKind {
  return options?.sourceHost ?? "posix";
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
