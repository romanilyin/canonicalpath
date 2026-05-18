import type { CanonicalRelativePath } from "../canonicalpath/types.js";
import type { CanonicalFSClient, FileStat } from "./types.js";
import { validateRelativePath } from "./validate.js";

export class CanonicalFSRPCRoot {
  constructor(
    readonly projectId: string,
    private readonly client: CanonicalFSClient,
  ) {}

  async readFile(rel: string): Promise<Uint8Array> {
    return this.client.readFile(this.projectId, this.validate(rel));
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    return this.client.writeFile(this.projectId, this.validate(rel), data);
  }

  async stat(rel: string): Promise<FileStat> {
    return this.client.stat(this.projectId, this.validate(rel));
  }

  async mkdirAll(rel: string): Promise<void> {
    return this.client.mkdirAll(this.projectId, this.validate(rel));
  }

  async remove(rel: string): Promise<void> {
    return this.client.remove(this.projectId, this.validate(rel));
  }

  async rename(oldRel: string, newRel: string): Promise<void> {
    return this.client.rename(this.projectId, this.validate(oldRel), this.validate(newRel));
  }

  validate(rel: string): CanonicalRelativePath {
    return validateRelativePath(rel);
  }
}
