import type { CanonicalRelativePath } from "../canonicalpath/types.js";
import { fsError } from "./errors.js";

export function validateRelativePath(rel: string): CanonicalRelativePath {
  if (rel.includes("\0")) throw fsError("ERR_NUL_BYTE", "path contains NUL");
  if (rel === "" || rel === ".") return "." as CanonicalRelativePath;
  if (isAbsolutePathLike(rel)) throw fsError("ERR_ABSOLUTE_PATH", "path must be relative to root");
  if (isDriveRelativePathLike(rel)) throw fsError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not accepted in CanonicalFS relative paths");
  if (rel.includes("\\")) {
    throw fsError("ERR_OUTSIDE_ROOT", "backslash separators are not accepted in CanonicalFS relative paths");
  }

  const parts: string[] = [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw fsError("ERR_OUTSIDE_ROOT", "path escapes root");
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return (parts.length === 0 ? "." : parts.join("/")) as CanonicalRelativePath;
}

function isAbsolutePathLike(rel: string): boolean {
  if (rel.startsWith("/") || rel.startsWith("\\\\")) return true;
  return /^[A-Za-z]:[\\/]/.test(rel);
}

function isDriveRelativePathLike(rel: string): boolean {
  return /^[A-Za-z]:($|[^\\/])/.test(rel);
}
