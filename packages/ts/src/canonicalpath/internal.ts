import { pathError } from "./errors.js";
import type { WSLOptions } from "./types.js";

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

export function isDriveRelative(value: string): boolean {
  return value.length >= 2 && isAsciiLetter(value[0] ?? "") && value[1] === ":" && (value.length === 2 || value[2] !== "/");
}

export function isUriWindowsDrivePath(value: string): boolean {
  return value.length >= 4 && value[0] === "/" && isAsciiLetter(value[1] ?? "") && value[2] === ":" && value[3] === "/";
}

export function isAbsolutePathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || hasDriveRoot(value.replaceAll("\\", "/"));
}

export function unwrapWindowsExtendedPrefix(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice("\\\\?\\UNC\\".length)}`;
  if (value.startsWith("\\\\?\\")) return value.slice("\\\\?\\".length);
  return value;
}

export function mapWSLDrive(value: string, options: WSLOptions | undefined): string | undefined {
  if (!options?.enabled) return undefined;
  const mountRoot = (options.mountRoot ?? "/mnt").replace(/\/+$/, "");
  const prefix = `${mountRoot}/`;
  if (!value.startsWith(prefix)) return undefined;

  const rest = value.slice(prefix.length);
  if (rest.length < 1 || !isAsciiLetter(rest[0] ?? "")) return undefined;
  if (rest.length > 1 && rest[1] !== "/") return undefined;

  const drive = rest[0]?.toLowerCase();
  if (rest.length === 1) return `${drive}:/`;
  return `${drive}:/${rest.slice(2)}`;
}

export function splitRoot(value: string): { prefix: string; rest: string } {
  if (hasDriveRoot(value)) return { prefix: value.slice(0, 3), rest: value.slice(3) };
  if (value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw pathError("ERR_INVALID_PATH", "UNC path requires server and share");
    }
    return { prefix: `//${parts[0]}/${parts[1]}`, rest: parts.slice(2).join("/") };
  }
  if (value.startsWith("/")) return { prefix: "/", rest: value.slice(1) };
  return { prefix: "", rest: value };
}

export function cleanCanonical(value: string): string {
  if (value === "") throw pathError("ERR_EMPTY_PATH", "path is empty");
  const { prefix, rest } = splitRoot(value);
  const parts: string[] = [];

  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) {
        parts.pop();
        continue;
      }
      if (prefix !== "") continue;
      throw pathError("ERR_INVALID_PATH", "relative path escapes above its root");
    }
    parts.push(part);
  }

  const joined = parts.join("/");
  if (prefix === "") return joined === "" ? "." : joined;
  if (prefix === "/") return joined === "" ? "/" : `/${joined}`;
  if (prefix.endsWith("/")) return joined === "" ? prefix : `${prefix}${joined}`;
  return joined === "" ? prefix : `${prefix}/${joined}`;
}

export function canonicalParts(value: string): { prefix: string; parts: string[] } {
  if (value.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  const { prefix, rest } = splitRoot(value);
  if (prefix === "") throw pathError("ERR_INVALID_PATH", "path must be canonical absolute");

  const parts = rest.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === "..")) {
    throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned");
  }
  return { prefix, parts };
}

export function hasWindowsADS(value: string): boolean {
  let start = 0;
  if (hasDriveRoot(value)) start = 3;
  else if (value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    if (parts.length >= 2) start = `//${parts[0]}/${parts[1]}`.length;
  }
  return value.slice(start).includes(":");
}

export function hasReservedDeviceName(value: string): boolean {
  let rest: string;
  try {
    rest = splitRoot(value).rest;
  } catch {
    return false;
  }
  return rest.split("/").some((part) => {
    if (part === "" || part === "." || part === "..") return false;
    const base = part.split(/[.:]/, 1)[0]?.toUpperCase() ?? "";
    return isReservedDeviceBase(base);
  });
}

export function isReservedDeviceBase(base: string): boolean {
  if (["CON", "PRN", "AUX", "NUL"].includes(base)) return true;
  return /^(COM|LPT)[1-9]$/.test(base);
}
