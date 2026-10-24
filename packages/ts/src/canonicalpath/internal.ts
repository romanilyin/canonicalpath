import { pathError } from "./errors.js";
import type { WSLOptions } from "./types.js";

export type RootKind = "relative" | "posix" | "drive" | "unc" | "extended-drive" | "extended-unc";
export interface ParsedRoot { kind: RootKind; prefix: string; rest: string }

export function isAsciiLetter(value: string): boolean {
  if (value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function hasUriScheme(value: string): boolean {
  const index = value.indexOf("://");
  if (index <= 0) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value.slice(0, index));
}

export function hasDriveRoot(value: string): boolean {
  return value.length >= 3 && isAsciiLetter(value[0] ?? "") && value[1] === ":" && value[2] === "/";
}

export function needsRelativeMarker(value: string): boolean {
  return value.length >= 2 && isAsciiLetter(value[0] ?? "") && value[1] === ":";
}

export function isDriveRelative(value: string): boolean {
  return needsRelativeMarker(value) && (value.length === 2 || value[2] !== "/");
}

export function isUriWindowsDrivePath(value: string): boolean {
  return value.length >= 4 && value[0] === "/" && isAsciiLetter(value[1] ?? "") && value[2] === ":" && value[3] === "/";
}

export function isAbsolutePathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || hasDriveRoot(value.replaceAll("\\", "/"));
}

export function isWindowsRoot(kind: RootKind): boolean {
  return kind !== "posix" && kind !== "relative";
}

// Parse only canonical syntax. Raw host separators and URI transport are handled
// once by normalize; canonical operations must never infer them again.
export function splitRoot(value: string): ParsedRoot {
  if (value.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  let result: ParsedRoot;
  if (value.startsWith("//?/")) {
    const suffix = value.slice(4);
    if (hasDriveRoot(suffix)) {
      result = { kind: "extended-drive", prefix: `//?/${suffix[0]?.toLowerCase()}:/`, rest: suffix.slice(3) };
    } else if (suffix.startsWith("UNC/")) {
      const parts = suffix.slice(4).split("/");
      requireUNCParts(parts);
      result = { kind: "extended-unc", prefix: `//?/UNC/${parts[0]}/${parts[1]}`, rest: parts.slice(2).join("/") };
    } else {
      throw pathError("ERR_INVALID_PATH", "unsupported or malformed extended root");
    }
  } else if (hasDriveRoot(value)) {
    result = { kind: "drive", prefix: `${value[0]?.toLowerCase()}:/`, rest: value.slice(3) };
  } else if (value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    requireUNCParts(parts);
    result = { kind: "unc", prefix: `//${parts[0]}/${parts[1]}`, rest: parts.slice(2).join("/") };
  } else if (value.startsWith("/")) {
    result = { kind: "posix", prefix: "/", rest: value.slice(1) };
  } else {
    if (isDriveRelative(value)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "unmarked drive-relative path");
    result = { kind: "relative", prefix: "", rest: value };
  }
  if (isWindowsRoot(result.kind) && value.includes("\\")) {
    throw pathError("ERR_INVALID_PATH", "canonical Windows components cannot contain backslash");
  }
  return result;
}

function requireUNCParts(parts: string[]): void {
  if (parts.length < 2 || !parts[0] || !parts[1] || parts.slice(0, 2).some((part) => part === "." || part === "..")) {
    throw pathError("ERR_INVALID_PATH", "UNC path requires a server and share");
  }
}

export function unwrapWindowsExtendedPrefix(value: string): string {
  if (!value.startsWith("//?/")) return value;
  const root = splitRoot(value);
  if (root.kind === "extended-drive") return root.prefix.slice(4) + root.rest;
  if (root.kind === "extended-unc") return "//" + root.prefix.slice(8) + (root.rest ? `/${root.rest}` : "");
  throw pathError("ERR_INVALID_PATH", "unsupported extended root");
}

export function markRelative(value: string): string {
  return value === "" ? "." : needsRelativeMarker(value) ? `./${value}` : value;
}

function cleanComponents(rest: string, absolute: boolean, outsideCode: "ERR_INVALID_PATH" | "ERR_OUTSIDE_ROOT"): string[] {
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) parts.pop();
      else if (!absolute) throw pathError(outsideCode, "relative path escapes above its root");
    } else parts.push(part);
  }
  return parts;
}

export function cleanCanonical(value: string): string {
  if (value === "") throw pathError("ERR_EMPTY_PATH", "path is empty");
  const root = splitRoot(value);
  const joined = cleanComponents(root.rest, root.kind !== "relative", "ERR_INVALID_PATH").join("/");
  if (root.kind === "relative") return markRelative(joined);
  if (joined === "") return root.prefix;
  return root.prefix.endsWith("/") ? root.prefix + joined : `${root.prefix}/${joined}`;
}

export function nativePOSIXRepresentation(value: string): string {
  if (value.startsWith("//") && !value.startsWith("///")) {
    throw pathError("ERR_INVALID_PATH", "implementation-defined POSIX double root is unsupported");
  }
  if (!value.startsWith("/")) return `./${value}`;
  let firstComponent = 0;
  while (value[firstComponent] === "/") firstComponent++;
  return "/" + value.slice(firstComponent);
}

export function normalizeMountRoot(value: string | undefined): string {
  const mount = value === undefined || value === "" ? "/mnt" : value;
  if (mount.includes("\0")) throw pathError("ERR_NUL_BYTE", "mountRoot contains NUL");
  if (!mount.startsWith("/")) throw pathError("ERR_INVALID_PATH", "mountRoot must be an absolute POSIX path");
  return cleanCanonical(nativePOSIXRepresentation(mount));
}

export function mapWSLDrive(value: string, options: WSLOptions | undefined): string | undefined {
  if (!options?.enabled) return undefined;
  const mountRoot = normalizeMountRoot(options.mountRoot);
  const prefix = mountRoot === "/" ? "/" : `${mountRoot}/`;
  if (!value.startsWith(prefix)) return undefined;
  const rest = value.slice(prefix.length);
  if (!isAsciiLetter(rest[0] ?? "") || (rest.length > 1 && rest[1] !== "/")) return undefined;
  if (rest.includes("\\")) throw pathError("ERR_INVALID_PATH", "WSL tail cannot preserve a literal backslash in a Windows identity");
  return `${rest[0]?.toLowerCase()}:/${rest.length === 1 ? "" : rest.slice(2)}`;
}

export function validateCanonical(value: string, allowDriveCase = false): ParsedRoot {
  const root = splitRoot(value);
  // Preserve the existing host-serializer compatibility for uppercase drives;
  // do not apply any raw path conversion or accept uncleaned components.
  const comparable = allowDriveCase && root.kind === "drive" ? value[0]?.toLowerCase() + value.slice(1)
    : allowDriveCase && root.kind === "extended-drive" ? value.slice(0, 4) + value[4]?.toLowerCase() + value.slice(5)
    : value;
  if (cleanCanonical(value) !== comparable) throw pathError("ERR_INVALID_PATH", "path is not lexically canonical");
  return root;
}

export function canonicalParts(value: string): { prefix: string; parts: string[] } {
  const root = validateCanonical(value);
  if (root.kind === "relative") throw pathError("ERR_INVALID_PATH", "path must be canonical absolute");
  return { prefix: root.prefix, parts: root.rest === "" ? [] : root.rest.split("/") };
}

export function cleanCanonicalRelative(value: string): string {
  if (value === "") throw pathError("ERR_EMPTY_PATH", "relative path is empty");
  const root = splitRoot(value);
  if (root.kind !== "relative") throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be rooted");
  return markRelative(cleanComponents(root.rest, false, "ERR_OUTSIDE_ROOT").join("/"));
}

export function hasWindowsADS(value: string): boolean {
  return splitRoot(value).rest.includes(":");
}

export function hasReservedDeviceName(value: string): boolean {
  return splitRoot(value).rest.split("/").some((part) => {
    if (part === "" || part === "." || part === "..") return false;
    const base = part.split(/[.:]/, 1)[0]?.toUpperCase() ?? "";
    return isReservedDeviceBase(base);
  });
}

export function isReservedDeviceBase(base: string): boolean {
  if (["CON", "PRN", "AUX", "NUL"].includes(base)) return true;
  return /^(COM|LPT)[1-9]$/.test(base);
}

// Strip boundary characters in one pass, without regex backtracking.
export function trimBoundaryCharacters(value: string, characters: string, trimStart = true): string {
  let start = 0;
  let end = value.length;
  if (trimStart) while (start < end && characters.includes(value.charAt(start))) start++;
  while (end > start && characters.includes(value.charAt(end - 1))) end--;
  return value.slice(start, end);
}
