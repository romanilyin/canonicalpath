import type { CanonicalPath } from "./types.js";
import { pathError } from "./errors.js";
import { validateCanonical } from "./internal.js";

export function toWin32(canonical: CanonicalPath): string {
  const root = validateCanonical(canonical, true);
  if (root.kind === "posix" || (root.kind === "relative" && (canonical.includes("\\") || canonical.startsWith("./")))) {
    throw pathError("ERR_INVALID_PATH", "path requires an explicit Windows host mapping");
  }
  if (root.kind === "drive") return `${root.prefix[0]?.toUpperCase()}:\\${root.rest.replaceAll("/", "\\")}`;
  if (root.kind === "extended-drive") return `\\\\?\\${root.prefix[4]?.toUpperCase()}:\\${root.rest.replaceAll("/", "\\")}`;
  return canonical.replaceAll("/", "\\");
}
