import type { CanonicalPath } from "./types.js";
import { pathError } from "./errors.js";
import { hasDriveRoot } from "./internal.js";

export function toPOSIX(canonical: CanonicalPath): string {
  if (canonical.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  if (hasDriveRoot(canonical)) {
    throw pathError("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as toWSL");
  }
  if (canonical.includes("\\")) throw pathError("ERR_INVALID_PATH", "canonical paths must use slash separators");
  return canonical;
}
