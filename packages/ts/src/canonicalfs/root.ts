import { mkdir, readFile, rename as fsRename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalRelativePath } from "../canonicalpath/types.js";
import { fsError } from "./errors.js";
import { canonicalFSLimitations } from "./limitations.js";
import type { FileStat } from "./types.js";
import { validateRelativePath } from "./validate.js";

// Local Node filesystem operations are lexical best-effort helpers only.
// Use CanonicalFSRPCRoot/CanonicalFSHTTPClient with the Go daemon for security-sensitive I/O.
export class BestEffortCanonicalFSRoot {
  constructor(
    readonly projectId: string,
    readonly hostRoot?: string,
  ) {}

  async readFile(rel: string): Promise<Uint8Array> {
    return readFile(this.resolveBestEffort(rel));
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    const target = this.resolveBestEffort(rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async mkdirAll(rel: string): Promise<void> {
    await mkdir(this.resolveBestEffort(rel), { recursive: true });
  }

  async remove(rel: string): Promise<void> {
    await rm(this.resolveBestEffort(rel), { recursive: true, force: false });
  }

  async rename(oldRel: string, newRel: string): Promise<void> {
    const oldClean = validateRelativePath(oldRel);
    const newClean = validateRelativePath(newRel);
    await fsRename(this.resolveCleanBestEffort(oldClean), this.resolveCleanBestEffort(newClean));
  }

  async stat(rel: string): Promise<FileStat> {
    const clean = validateRelativePath(rel);
    const info = await stat(this.resolveCleanBestEffort(clean));
    return { path: clean, size: info.size, isDirectory: info.isDirectory() };
  }

  validate(rel: string): CanonicalRelativePath {
    return validateRelativePath(rel);
  }

  private resolveBestEffort(rel: string): string {
    return this.resolveCleanBestEffort(validateRelativePath(rel));
  }

  private resolveCleanBestEffort(rel: CanonicalRelativePath): string {
    if (!this.hostRoot) throw fsError("ERR_OUTSIDE_ROOT", `hostRoot is required for local TypeScript canonicalfs. ${canonicalFSLimitations}`);
    return path.join(this.hostRoot, rel);
  }
}
