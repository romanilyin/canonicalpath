import { Buffer } from "node:buffer";
import type { CanonicalRelativePath } from "../canonicalpath/types.js";
import { fsError } from "./errors.js";
import type { CanonicalFSDaemonCapabilities, CanonicalFSClient, FileStat } from "./types.js";

interface TransportError {
  code: string;
  message: string;
}

interface TransportResponse {
  data_base64?: string;
  stat?: {
    path: string;
    size: number;
    is_directory: boolean;
  };
  error?: TransportError;
}

interface CapsTransportResponse {
  auth_required: boolean;
  endpoints: string[];
  limits: {
    max_request_bytes: number;
    default_read_bytes: number;
    max_read_bytes: number;
    max_response_bytes: number;
  };
  error?: TransportError;
}

export type CanonicalFSFetch = (input: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<Response>;

export interface CanonicalFSHTTPClientOptions {
  capabilityToken: string;
  fetch?: CanonicalFSFetch;
}

export class CanonicalFSHTTPClient implements CanonicalFSClient {
  private readonly endpoint: string;
  private readonly capabilityToken: string;
  private readonly fetchImpl: CanonicalFSFetch;

  constructor(endpoint: string, options: CanonicalFSHTTPClientOptions) {
    const capabilityToken = options.capabilityToken.trim();
    if (capabilityToken === "") throw fsError("ERR_DAEMON", "capabilityToken is required");
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.capabilityToken = capabilityToken;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async openProject(projectId: string, hostRoot: string): Promise<void> {
    await this.call("/v1/projects/open", { project_id: projectId, host_root: hostRoot });
  }

  async capabilities(): Promise<CanonicalFSDaemonCapabilities> {
    const response = await this.request<CapsTransportResponse>("GET", "/v1/caps");
    return {
      authRequired: response.auth_required,
      endpoints: response.endpoints,
      limits: {
        maxRequestBytes: response.limits.max_request_bytes,
        defaultReadBytes: response.limits.default_read_bytes,
        maxReadBytes: response.limits.max_read_bytes,
        maxResponseBytes: response.limits.max_response_bytes,
      },
    };
  }

  async closeProject(projectId: string): Promise<void> {
    await this.call("/v1/projects/close", { project_id: projectId });
  }

  async readFile(projectId: string, rel: CanonicalRelativePath): Promise<Uint8Array> {
    const response = await this.call("/v1/fs/readFile", { project_id: projectId, path: rel });
    return fromBase64(response.data_base64 ?? "");
  }

  async writeFile(projectId: string, rel: CanonicalRelativePath, data: Uint8Array): Promise<void> {
    await this.call("/v1/fs/writeFile", { project_id: projectId, path: rel, data_base64: toBase64(data) });
  }

  async stat(projectId: string, rel: CanonicalRelativePath): Promise<FileStat> {
    const response = await this.call("/v1/fs/stat", { project_id: projectId, path: rel });
    if (!response.stat) throw fsError("ERR_DAEMON", "stat response is missing");
    return { path: response.stat.path as CanonicalRelativePath, size: response.stat.size, isDirectory: response.stat.is_directory };
  }

  async mkdirAll(projectId: string, rel: CanonicalRelativePath): Promise<void> {
    await this.call("/v1/fs/mkdirAll", { project_id: projectId, path: rel });
  }

  async remove(projectId: string, rel: CanonicalRelativePath): Promise<void> {
    await this.call("/v1/fs/remove", { project_id: projectId, path: rel });
  }

  async rename(projectId: string, oldRel: CanonicalRelativePath, newRel: CanonicalRelativePath): Promise<void> {
    await this.call("/v1/fs/rename", { project_id: projectId, path: oldRel, target: newRel });
  }

  private async call(path: string, body: Record<string, unknown>): Promise<TransportResponse> {
    return this.request<TransportResponse>("POST", path, body);
  }

  private async request<T extends { error?: TransportError }>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.capabilityToken}` };
    if (body) headers["content-type"] = "application/json";
    const response = await this.fetchImpl(`${this.endpoint}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let payload: T;
    try {
      payload = (await response.json()) as T;
    } catch {
      throw fsError("ERR_DAEMON", "daemon response is not valid JSON");
    }
    if (!response.ok || payload.error) throwTransportError(payload.error ?? { code: "ERR_DAEMON", message: response.statusText });
    return payload;
  }
}

function throwTransportError(error: TransportError): never {
  switch (error.code) {
    case "ERR_ABSOLUTE_PATH":
    case "ERR_ARCHIVE_TRAVERSAL":
    case "ERR_DRIVE_RELATIVE_PATH":
    case "ERR_NUL_BYTE":
    case "ERR_OUTSIDE_ROOT":
    case "ERR_RACE_DETECTED":
    case "ERR_READ_LIMIT_EXCEEDED":
    case "ERR_REQUEST_TOO_LARGE":
    case "ERR_RESPONSE_TOO_LARGE":
    case "ERR_ROOT_NOT_ALLOWED":
    case "ERR_SYMLINK_ESCAPE":
    case "ERR_UNAUTHORIZED":
    case "ERR_UNSUPPORTED_OPERATION":
    case "ERR_DAEMON":
      throw fsError(error.code, error.message);
    default:
      throw new Error(`${error.code}: ${error.message}`);
  }
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}
