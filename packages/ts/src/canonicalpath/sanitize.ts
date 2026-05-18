import { createHash } from "node:crypto";
import { pathError } from "./errors.js";
import { isReservedDeviceBase } from "./internal.js";

export function sanitizeComponent(name: string, profile: "portable" | "win32" | "posix"): string {
  if (name === "") throw pathError("ERR_INVALID_COMPONENT", "component is empty");
  if (name.includes("\0")) throw pathError("ERR_NUL_BYTE", "component contains NUL");
  let value = name.replace(/[\\/:\t\n\r]+/g, "-").replace(/^[ ._-]+|[ ._-]+$/g, "");
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
  const slug = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "ref";
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
