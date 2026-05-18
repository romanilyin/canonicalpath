import type { CanonicalPath } from "./types.js";
import { pathError } from "./errors.js";
import { hasDriveRoot } from "./internal.js";

export function toWin32(canonical: CanonicalPath): string {
  if (canonical.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  if (hasDriveRoot(canonical)) return `${canonical[0]?.toUpperCase()}:\\${canonical.slice(3).replaceAll("/", "\\")}`;
  if (canonical.startsWith("//")) return `\\\\${canonical.slice(2).replaceAll("/", "\\")}`;
  return canonical.replaceAll("/", "\\");
}
