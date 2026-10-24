import type { CanonicalPath } from "./types.js";
import { pathError } from "./errors.js";
import { normalizeMountRoot, validateCanonical } from "./internal.js";

export function toWSL(canonical: CanonicalPath, options: { mountRoot?: string } = {}): string {
  const mountRoot = normalizeMountRoot(options.mountRoot);
  const root = validateCanonical(canonical, true);
  if (root.kind === "posix" || root.kind === "relative") return canonical;
  if (root.kind !== "drive") throw pathError("ERR_INVALID_PATH", "UNC and preserved roots require an explicit WSL host mapping");
  const prefix = mountRoot === "/" ? "" : mountRoot;
  return `${prefix}/${root.prefix[0]}${root.rest === "" ? "" : `/${root.rest}`}`;
}
