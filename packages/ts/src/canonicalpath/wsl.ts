import type { CanonicalPath } from "./types.js";
import { pathError } from "./errors.js";
import { hasDriveRoot } from "./internal.js";

export function toWSL(canonical: CanonicalPath, options: { mountRoot?: string } = {}): string {
  if (canonical.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  if (!hasDriveRoot(canonical)) return canonical;
  const mountRoot = (options.mountRoot ?? "/mnt").replace(/\/+$/, "");
  const drive = canonical[0]?.toLowerCase();
  const rest = canonical.slice(3);
  if (rest === "") return `${mountRoot}/${drive}`;
  return `${mountRoot}/${drive}/${rest}`;
}
