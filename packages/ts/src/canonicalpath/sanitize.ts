import { createHash } from "node:crypto";
import { pathError } from "./errors.js";
import { isReservedDeviceBase, trimBoundaryCharacters } from "./internal.js";

export function sanitizeComponent(name: string, profile: "portable" | "win32" | "posix"): string {
  if (name === "") throw pathError("ERR_INVALID_COMPONENT", "component is empty");
  if (name.includes("\0")) throw pathError("ERR_NUL_BYTE", "component contains NUL");
  let value = trimBoundaryCharacters(name.replace(/[\\/:\t\n\r]+/g, "-"), " ._-");
  if (value === "") value = "component";
  if (profile === "win32") value = escapeReservedWin32Component(value);
  return value;
}

export function encodeComponent(name: string, profile: "portable" | "win32" | "posix"): string {
  return sanitizeComponent(name, profile);
}

export function encodeGitRef(raw: string): string {
  if (raw === "") throw pathError("ERR_INVALID_COMPONENT", "git ref is empty");
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "git ref contains NUL");
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = raw.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
  }
  const slug = trimBoundaryCharacters(raw.replace(/[^A-Za-z0-9._-]+/g, "-"), "._-") || "ref";
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 12);
  return `${slug}--${hash}`;
}

function escapeReservedWin32Component(value: string): string {
  const dot = value.indexOf(".");
  const base = dot >= 0 ? value.slice(0, dot) : value;
  const suffix = dot >= 0 ? value.slice(dot) : "";
  if (isReservedDeviceBase(base.toUpperCase())) return `${base}-${suffix}`;
  return value;
}
