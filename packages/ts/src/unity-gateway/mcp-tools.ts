import { errorCode } from "../canonicalpath/errors.js";
import type { McpToolDescriptor, McpToolResult, UnityBridgeClient, UnityBridgeWriteCommand, UnityBridgeWriteRequest, UnityPathValidationOptions } from "./types.js";
import type { UnityMcpWorkflowScope } from "./path-service.js";

export const unityMCPToolNames = [
  "unity.status",
  "unity.projectInfo",
  "unity.readLog",
  "unity.read",
  "unity.validatePath",
  "unity.knowledge.read",
  "unity.knowledge.write",
  "unity.knowledge.list",
  "unity.knowledge.glob",
  "unity.artifact.read",
  "unity.artifact.write",
  "unity.artifact.list",
  "unity.artifact.glob",
  "unity.assets.refresh",
  "unity.scene.save",
  "unity.asset.import",
  "unity.prefab.create",
  "unity.module.create",
] as const;
export type UnityMCPToolName = (typeof unityMCPToolNames)[number];

export class UnityMCPToolRegistry {
  constructor(private readonly bridge: UnityBridgeClient) {}

  listTools(): McpToolDescriptor[] {
    return unityToolDescriptors;
  }

  async callTool(name: string, args: unknown = {}): Promise<McpToolResult> {
    try {
      const value = await this.callToolStrict(name, args);
      return toolResult(value);
    } catch (error) {
      return toolResult({ error: errorCode(error), message: errorMessage(error) }, true);
    }
  }

  private async callToolStrict(name: string, args: unknown): Promise<unknown> {
    const input = objectArgs(args);
    switch (name) {
      case "unity.status":
        return this.bridge.status(optionalString(input, "project_id"));
      case "unity.projectInfo":
        return this.bridge.projectInfo(requiredString(input, "project_id"));
      case "unity.readLog":
        return this.bridge.readLog(optionalString(input, "project_id"), optionalInteger(input, "max_entries"));
      case "unity.read":
        return this.bridge.readText(requiredString(input, "project_id"), requiredString(input, "unity_path"), optionalInteger(input, "max_chars"));
      case "unity.validatePath":
        return this.bridge.validatePath(requiredString(input, "project_id"), requiredString(input, "unity_path"), validationOptions(input));
      case "unity.knowledge.read":
        return this.bridge.readScopedText(requiredString(input, "project_id"), "knowledge", requiredString(input, "path"), optionalInteger(input, "max_chars"));
      case "unity.knowledge.write":
        return this.bridge.writeScopedText(requiredString(input, "project_id"), "knowledge", requiredString(input, "path"), requiredString(input, "text"), optionalInteger(input, "max_chars"));
      case "unity.knowledge.list":
        return this.bridge.listScoped(requiredString(input, "project_id"), "knowledge", optionalString(input, "path_prefix"), optionalInteger(input, "max_entries"));
      case "unity.knowledge.glob":
        return this.bridge.globScoped(requiredString(input, "project_id"), "knowledge", requiredString(input, "glob"), optionalInteger(input, "max_entries"));
      case "unity.artifact.read":
        return this.bridge.readScopedText(requiredString(input, "project_id"), "artifact", requiredString(input, "path"), optionalInteger(input, "max_chars"));
      case "unity.artifact.write":
        return this.bridge.writeScopedText(requiredString(input, "project_id"), "artifact", requiredString(input, "path"), requiredString(input, "text"), optionalInteger(input, "max_chars"));
      case "unity.artifact.list":
        return this.bridge.listScoped(requiredString(input, "project_id"), "artifact", optionalString(input, "path_prefix"), optionalInteger(input, "max_entries"));
      case "unity.artifact.glob":
        return this.bridge.globScoped(requiredString(input, "project_id"), "artifact", requiredString(input, "glob"), optionalInteger(input, "max_entries"));
      case "unity.assets.refresh":
        return this.bridge.writeCommand("assets.refresh", writeRequest(input, false));
      case "unity.scene.save":
        return this.bridge.writeCommand("scene.save", writeRequest(input, true));
      case "unity.asset.import":
        return this.bridge.writeCommand("asset.import", writeRequest(input, true));
      case "unity.prefab.create":
        return this.bridge.writeCommand("prefab.create", writeRequest(input, true));
      case "unity.module.create":
        return this.bridge.writeCommand("module.create", writeRequest(input, true));
      default:
        throw new Error(`unsupported Unity MCP tool ${name}`);
    }
  }
}

export function createUnityMCPTools(bridge: UnityBridgeClient): UnityMCPToolRegistry {
  return new UnityMCPToolRegistry(bridge);
}

const unityToolDescriptors: McpToolDescriptor[] = [
  {
    name: "unity.status",
    description: "Report fake or real Unity bridge status without mutating the project.",
    inputSchema: objectSchema({ project_id: { type: "string" } }),
  },
  {
    name: "unity.projectInfo",
    description: "Return registered Unity project identity and bridge metadata.",
    inputSchema: objectSchema({ project_id: { type: "string" } }, ["project_id"]),
  },
  {
    name: "unity.readLog",
    description: "Read recent Unity bridge log entries from the fake or real bridge.",
    inputSchema: objectSchema({ project_id: { type: "string" }, max_entries: { type: "integer", minimum: 1 } }),
  },
  {
    name: "unity.read",
    description: "Read a validated Assets/... or Packages/... text file through the fake or real Unity bridge.",
    inputSchema: objectSchema(
      {
        project_id: { type: "string" },
        unity_path: { type: "string" },
        max_chars: { type: "integer", minimum: 1 },
      },
      ["project_id", "unity_path"],
    ),
  },
  {
    name: "unity.validatePath",
    description: "Dry-run Unity PathGuard validation for Assets/... or Packages/... payload paths.",
    inputSchema: objectSchema(
      {
        project_id: { type: "string" },
        unity_path: { type: "string" },
        generated_file_name: { type: "string" },
        max_file_name_length: { type: "integer", minimum: 1 },
      },
      ["project_id", "unity_path"],
    ),
  },
  scopedReadTool("unity.knowledge.read", "knowledge"),
  scopedWriteTool("unity.knowledge.write", "knowledge"),
  scopedListTool("unity.knowledge.list", "knowledge"),
  scopedGlobTool("unity.knowledge.glob", "knowledge"),
  scopedReadTool("unity.artifact.read", "artifact"),
  scopedWriteTool("unity.artifact.write", "artifact"),
  scopedListTool("unity.artifact.list", "artifact"),
  scopedGlobTool("unity.artifact.glob", "artifact"),
  writeTool("unity.assets.refresh", "assets.refresh", false),
  writeTool("unity.scene.save", "scene.save", true),
  writeTool("unity.asset.import", "asset.import", true),
  writeTool("unity.prefab.create", "prefab.create", true),
  writeTool("unity.module.create", "module.create", true),
];

function toolResult(value: unknown, isError = false): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: isError || undefined,
  };
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("tool args must be an object");
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value === "") throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") throw new Error(`${key} must be a non-empty string when provided`);
  return value;
}

function optionalInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer when provided`);
  return value as number;
}

function validationOptions(args: Record<string, unknown>): UnityPathValidationOptions {
  return {
    generatedFileName: optionalString(args, "generated_file_name"),
    maxFileNameLength: optionalInteger(args, "max_file_name_length"),
  };
}

function writeRequest(args: Record<string, unknown>, requirePath: boolean): UnityBridgeWriteRequest {
  const unityPath = requirePath ? requiredString(args, "unity_path") : optionalString(args, "unity_path");
  return {
    projectId: requiredString(args, "project_id"),
    unityPath,
    generatedFileName: optionalString(args, "generated_file_name"),
    dryRun: optionalBoolean(args, "dry_run"),
  };
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean when provided`);
  return value;
}

function writeTool(name: UnityMCPToolName, command: UnityBridgeWriteCommand, requirePath: boolean): McpToolDescriptor {
  const properties: Record<string, unknown> = {
    project_id: { type: "string" },
    dry_run: { type: "boolean" },
  };
  const required = ["project_id"];
  if (requirePath) {
    properties.unity_path = { type: "string" };
    required.push("unity_path");
  } else {
    properties.unity_path = { type: "string" };
  }
  properties.generated_file_name = { type: "string" };
  return {
    name,
    description: `Validate and dispatch guarded Unity write command ${command}. Fake bridge records only; real bridge must call PathGuard before performing writes.`,
    inputSchema: objectSchema(properties, required),
  };
}

function scopedReadTool(name: UnityMCPToolName, scope: UnityMcpWorkflowScope): McpToolDescriptor {
  return {
    name,
    description: `Read bounded ${scope} text through a scoped path. Real filesystem I/O must delegate to the Go daemon.`,
    inputSchema: objectSchema(
      {
        project_id: { type: "string" },
        path: { type: "string" },
        max_chars: { type: "integer", minimum: 1, maximum: 1_048_576 },
      },
      ["project_id", "path"],
    ),
  };
}

function scopedWriteTool(name: UnityMCPToolName, scope: UnityMcpWorkflowScope): McpToolDescriptor {
  return {
    name,
    description: `Write bounded ${scope} text through a scoped path. Fake bridge stores in memory; real filesystem I/O must delegate to the Go daemon.`,
    inputSchema: objectSchema(
      {
        project_id: { type: "string" },
        path: { type: "string" },
        text: { type: "string", maxLength: 1_048_576 },
        max_chars: { type: "integer", minimum: 1, maximum: 1_048_576 },
      },
      ["project_id", "path", "text"],
    ),
  };
}

function scopedListTool(name: UnityMCPToolName, scope: UnityMcpWorkflowScope): McpToolDescriptor {
  return {
    name,
    description: `List bounded ${scope} entries by scope-relative prefix without returning host paths.`,
    inputSchema: objectSchema(
      {
        project_id: { type: "string" },
        path_prefix: { type: "string" },
        max_entries: { type: "integer", minimum: 1, maximum: 1000 },
      },
      ["project_id"],
    ),
  };
}

function scopedGlobTool(name: UnityMCPToolName, scope: UnityMcpWorkflowScope): McpToolDescriptor {
  return {
    name,
    description: `Match bounded ${scope} entries by scope-relative glob without using host filesystem globs.`,
    inputSchema: objectSchema(
      {
        project_id: { type: "string" },
        glob: { type: "string", minLength: 1, maxLength: 512 },
        max_entries: { type: "integer", minimum: 1, maximum: 1000 },
      },
      ["project_id", "glob"],
    ),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
