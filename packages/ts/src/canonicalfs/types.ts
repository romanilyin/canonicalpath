import type { CanonicalRelativePath } from "../canonicalpath/types.js";

export interface FileStat {
  path: CanonicalRelativePath;
  size: number;
  isDirectory: boolean;
}

export interface CanonicalFSDaemonCapabilities {
  authRequired: boolean;
  endpoints: string[];
  limits: {
    maxRequestBytes: number;
    defaultReadBytes: number;
    maxReadBytes: number;
    maxResponseBytes: number;
  };
}

export interface CanonicalFSClient {
  readFile(projectId: string, rel: CanonicalRelativePath): Promise<Uint8Array>;
  writeFile(projectId: string, rel: CanonicalRelativePath, data: Uint8Array): Promise<void>;
  stat(projectId: string, rel: CanonicalRelativePath): Promise<FileStat>;
  mkdirAll(projectId: string, rel: CanonicalRelativePath): Promise<void>;
  remove(projectId: string, rel: CanonicalRelativePath): Promise<void>;
  rename(projectId: string, oldRel: CanonicalRelativePath, newRel: CanonicalRelativePath): Promise<void>;
}
