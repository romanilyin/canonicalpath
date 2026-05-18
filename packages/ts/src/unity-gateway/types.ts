import type { CanonicalPath, CanonicalRelativePath, HostKind, NormalizeOptions } from "../canonicalpath/types.js";
import type { UnityMcpWorkflowScope } from "./path-service.js";

export interface UnityProjectPathAliasRegistration {
  clientType: string;
  clientId: string;
  environmentId: string;
  hostKind?: HostKind;
  hostRoot: string;
  normalizeOptions?: NormalizeOptions;
  label?: string;
}

export interface UnityProjectPathAlias {
  projectId: string;
  canonicalProjectPath: CanonicalPath;
  clientType: string;
  clientId: string;
  environmentId: string;
  hostKind: HostKind;
  hostRoot: string;
  normalizeOptions?: NormalizeOptions;
  label?: string;
}

export interface UnityProjectPathAliasSelector {
  clientType?: string;
  clientId?: string;
  environmentId?: string;
  hostKind?: HostKind;
}

export interface UnityProjectRegistration {
  projectId: string;
  projectRoot: string;
  normalizeOptions?: NormalizeOptions;
  hostRoot?: string;
  aliases?: UnityProjectPathAliasRegistration[];
}

export interface UnityProjectRecord {
  projectId: string;
  canonicalProjectPath: CanonicalPath;
  normalizeOptions?: NormalizeOptions;
  hostRoot?: string;
  pathAliases: UnityProjectPathAlias[];
}

export interface UnityBridgePathValidation {
  ok: true;
  projectId: string;
  unityPath: CanonicalRelativePath;
  canonicalPath: CanonicalPath;
  safeFileName?: string;
}

export interface UnityBridgeStatus {
  state: "ready" | "disconnected" | "error";
  projectId?: string;
  projectName?: string;
  unityVersion?: string;
  detail?: string;
}

export interface UnityBridgeProjectInfo {
  projectId: string;
  canonicalProjectPath: CanonicalPath;
  hostRoot?: string;
  pathAliases: UnityProjectPathAlias[];
  projectName?: string;
  unityVersion?: string;
}

export interface UnityBridgeLogEntry {
  level: "trace" | "debug" | "info" | "warning" | "error";
  message: string;
  timestamp?: string;
}

export interface UnityBridgeReadResult {
  projectId: string;
  unityPath: CanonicalRelativePath;
  canonicalPath: CanonicalPath;
  text: string;
  truncated: boolean;
}

export interface UnityMcpArtifactRef {
  scope: "artifact";
  path: CanonicalRelativePath;
}

export interface UnityBridgeScopedTextResult {
  projectId: string;
  scope: UnityMcpWorkflowScope;
  path: CanonicalRelativePath;
  projectRelativePath: CanonicalRelativePath;
  text: string;
  truncated: boolean;
  artifactRef?: UnityMcpArtifactRef;
}

export interface UnityBridgeScopedWriteResult {
  ok: true;
  projectId: string;
  scope: UnityMcpWorkflowScope;
  path: CanonicalRelativePath;
  projectRelativePath: CanonicalRelativePath;
  chars: number;
  artifactRef?: UnityMcpArtifactRef;
}

export interface UnityBridgeScopedEntry {
  scope: UnityMcpWorkflowScope;
  path: CanonicalRelativePath;
  projectRelativePath: CanonicalRelativePath;
  kind: "file";
  chars: number;
  artifactRef?: UnityMcpArtifactRef;
}

export interface UnityBridgeScopedListResult {
  projectId: string;
  scope: UnityMcpWorkflowScope;
  pathPrefix?: CanonicalRelativePath;
  entries: UnityBridgeScopedEntry[];
  truncated: boolean;
}

export interface UnityBridgeScopedGlobResult {
  projectId: string;
  scope: UnityMcpWorkflowScope;
  glob: CanonicalRelativePath;
  entries: UnityBridgeScopedEntry[];
  truncated: boolean;
}

export type UnityBridgeWriteCommand = "assets.refresh" | "scene.save" | "asset.import" | "prefab.create" | "module.create";

export interface UnityBridgeWriteRequest {
  projectId: string;
  unityPath?: string;
  generatedFileName?: string;
  dryRun?: boolean;
}

export interface UnityBridgeWriteResult {
  ok: true;
  command: UnityBridgeWriteCommand;
  projectId: string;
  unityPath?: CanonicalRelativePath;
  canonicalPath?: CanonicalPath;
  safeFileName?: string;
  dryRun: boolean;
  performed: boolean;
  detail?: string;
}

export interface UnityBridgeClient {
  status(projectId?: string): Promise<UnityBridgeStatus>;
  projectInfo(projectId: string): Promise<UnityBridgeProjectInfo>;
  readLog(projectId?: string, maxEntries?: number): Promise<UnityBridgeLogEntry[]>;
  readText(projectId: string, unityPath: string, maxChars?: number): Promise<UnityBridgeReadResult>;
  readScopedText(projectId: string, scope: UnityMcpWorkflowScope, path: string, maxChars?: number): Promise<UnityBridgeScopedTextResult>;
  writeScopedText(projectId: string, scope: UnityMcpWorkflowScope, path: string, text: string, maxChars?: number): Promise<UnityBridgeScopedWriteResult>;
  listScoped(projectId: string, scope: UnityMcpWorkflowScope, pathPrefix?: string, maxEntries?: number): Promise<UnityBridgeScopedListResult>;
  globScoped(projectId: string, scope: UnityMcpWorkflowScope, glob: string, maxEntries?: number): Promise<UnityBridgeScopedGlobResult>;
  validatePath(projectId: string, unityPath: string, options?: UnityPathValidationOptions): Promise<UnityBridgePathValidation>;
  writeCommand(command: UnityBridgeWriteCommand, request: UnityBridgeWriteRequest): Promise<UnityBridgeWriteResult>;
}

export interface UnityPathValidationOptions {
  generatedFileName?: string;
  maxFileNameLength?: number;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
  isError?: boolean;
}
