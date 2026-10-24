import type { CanonicalPath, CanonicalRelativePath } from "./types.js";
import { pathError } from "./errors.js";
import { canonicalParts, cleanCanonical, cleanCanonicalRelative, isAbsolutePathLike, isDriveRelative, isWindowsRoot, markRelative, validateCanonical } from "./internal.js";

export function relative(root: CanonicalPath, target: CanonicalPath): CanonicalRelativePath {
  const rootParts = canonicalParts(root);
  const targetParts = canonicalParts(target);
  if (rootParts.prefix !== targetParts.prefix || targetParts.parts.length < rootParts.parts.length) {
    throw pathError("ERR_OUTSIDE_ROOT", "target is outside root");
  }
  for (let index = 0; index < rootParts.parts.length; index += 1) {
    if (targetParts.parts[index] !== rootParts.parts[index]) {
      throw pathError("ERR_OUTSIDE_ROOT", "target is outside root");
    }
  }
  if (targetParts.parts.length === rootParts.parts.length) return "." as CanonicalRelativePath;
  return markRelative(targetParts.parts.slice(rootParts.parts.length).join("/")) as CanonicalRelativePath;
}

export function join(root: CanonicalPath, relative: CanonicalRelativePath): CanonicalPath {
  const parsedRoot = validateCanonical(root);
  if (isWindowsRoot(parsedRoot.kind) && relative.includes("\\")) throw pathError("ERR_INVALID_PATH", "Windows join cannot preserve literal backslash components");
  const cleanRelative = cleanCanonicalRelative(relative);
  if (cleanRelative === ".") return root;
  const components = cleanRelative.startsWith("./") ? cleanRelative.slice(2) : cleanRelative;
  return cleanCanonical(`${root}${root.endsWith("/") ? "" : "/"}${components}`) as CanonicalPath;
}

export function normalizeRelative(raw: string): CanonicalRelativePath {
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "relative path is empty");
  if (raw === ".") return "." as CanonicalRelativePath;
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "relative path contains NUL");
  if (isAbsolutePathLike(raw)) throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute");
  if (isDriveRelative(raw)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed");
  if (raw.includes("\\")) throw pathError("ERR_INVALID_PATH", "relative path must use slash separators");

  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw pathError("ERR_OUTSIDE_ROOT", "relative path escapes root");
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) throw pathError("ERR_EMPTY_PATH", "relative path is empty after cleaning");
  return parts.join("/") as CanonicalRelativePath;
}
