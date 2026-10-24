import type { CanonicalPath } from "./types.js";
import { pathError } from "./errors.js";
import { isWindowsRoot, validateCanonical } from "./internal.js";

export function toPOSIX(canonical: CanonicalPath): string {
  if (isWindowsRoot(validateCanonical(canonical).kind)) {
    throw pathError("ERR_INVALID_PATH", "Windows roots require an explicit POSIX host mapping");
  }
  return canonical;
}
