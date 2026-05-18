export type CanonicalPath = string & { readonly __canonicalPath: unique symbol };
export type CanonicalRelativePath = string & { readonly __canonicalRelativePath: unique symbol };

export type HostKind = "posix" | "win32" | "wsl" | "vscode-file-uri" | "dev-container" | "ssh-remote";
export type TargetProfile = "portable" | "win32-drive" | "posix";

export interface NormalizeOptions {
  sourceHost?: HostKind;
  targetProfile?: TargetProfile;
  trimOuterWhitespace?: boolean;
  uri?: {
    allowFileUri?: boolean;
    allowVSCodeFileUri?: boolean;
    rejectEncodedSlash?: boolean;
  };
  windows?: {
    preserveExtendedLength?: boolean;
    rejectDeviceNames?: boolean;
    rejectADS?: boolean;
  };
  wsl?: {
    enabled?: boolean;
    mountRoot?: string;
  };
}

export class CanonicalPathError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CanonicalPathError";
    this.code = code;
  }
}

export function errorCode(error: unknown): string {
  if (error instanceof CanonicalPathError) return error.code;
  return "ERR_INVALID_PATH";
}

export function normalize(raw: string, options: NormalizeOptions = {}): CanonicalPath {
  if (options.trimOuterWhitespace) raw = raw.trim();
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "path is empty");
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");

  let value = raw;
  if (hasUriScheme(value) || options.sourceHost === "vscode-file-uri") value = parseFileUri(value, options);
  if (!options.windows?.preserveExtendedLength) value = unwrapWindowsExtendedPrefix(value);
  value = value.replaceAll("\\", "/");

  if (options.targetProfile !== "posix") value = mapWSLDrive(value, options.wsl) ?? value;
  if (isUriWindowsDrivePath(value)) value = value.slice(1);

  if (isDriveRelative(value)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical");
  if (hasDriveRoot(value)) value = `${value[0]?.toLowerCase()}${value.slice(1)}`;

  if (options.windows?.rejectADS && hasWindowsADS(value)) throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
  if (options.windows?.rejectDeviceNames && hasReservedDeviceName(value)) throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");

  const cleaned = cleanCanonical(value);
  validateTargetProfile(cleaned, options.targetProfile);
  return cleaned as CanonicalPath;
}

export function relative(root: CanonicalPath, target: CanonicalPath): CanonicalRelativePath {
  const rootParts = canonicalParts(root);
  const targetParts = canonicalParts(target);
  if (rootParts.prefix !== targetParts.prefix || targetParts.parts.length < rootParts.parts.length) {
    throw pathError("ERR_OUTSIDE_ROOT", "target is outside root");
  }
  for (let index = 0; index < rootParts.parts.length; index += 1) {
    if (targetParts.parts[index] !== rootParts.parts[index]) throw pathError("ERR_OUTSIDE_ROOT", "target is outside root");
  }
  if (targetParts.parts.length === rootParts.parts.length) return "." as CanonicalRelativePath;
  return targetParts.parts.slice(rootParts.parts.length).join("/") as CanonicalRelativePath;
}

export function join(root: CanonicalPath, rel: CanonicalRelativePath): CanonicalPath {
  const cleanRelative = normalizeRelative(rel);
  if (root.includes("\0")) throw pathError("ERR_NUL_BYTE", "root contains NUL");
  if (cleanRelative === ".") return root;
  if (root === "/" || root.endsWith("/")) return `${root}${cleanRelative}` as CanonicalPath;
  return `${root}/${cleanRelative}` as CanonicalPath;
}

export function normalizeRelative(raw: string): CanonicalRelativePath {
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "relative path is empty");
  if (raw === ".") return "." as CanonicalRelativePath;
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "relative path contains NUL");
  if (isAbsolutePathLike(raw)) throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute");
  if (isDriveRelative(raw)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed");
  if (raw.includes("\\")) throw pathError("ERR_INVALID_PATH", "relative path must use slash separators");

  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw pathError("ERR_OUTSIDE_ROOT", "relative path escapes root");
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) throw pathError("ERR_EMPTY_PATH", "relative path is empty after cleaning");
  return parts.join("/") as CanonicalRelativePath;
}

export function isEqual(left: string, right: string, options: NormalizeOptions = {}): boolean {
  return normalize(left, options) === normalize(right, options);
}

export function toWin32(canonical: CanonicalPath): string {
  if (canonical.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  if (hasDriveRoot(canonical)) return `${canonical[0]?.toUpperCase()}:\\${canonical.slice(3).replaceAll("/", "\\")}`;
  if (canonical.startsWith("//")) return `\\\\${canonical.slice(2).replaceAll("/", "\\")}`;
  return canonical.replaceAll("/", "\\");
}

export function toWSL(canonical: CanonicalPath, options: { mountRoot?: string } = {}): string {
  if (canonical.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  if (!hasDriveRoot(canonical)) return canonical;
  const mountRoot = (options.mountRoot ?? "/mnt").replace(/\/+$/, "");
  const drive = canonical[0]?.toLowerCase();
  const rest = canonical.slice(3);
  if (rest === "") return `${mountRoot}/${drive}`;
  return `${mountRoot}/${drive}/${rest}`;
}

export function toPOSIX(canonical: CanonicalPath): string {
  if (canonical.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  if (hasDriveRoot(canonical)) throw pathError("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as toWSL");
  if (canonical.includes("\\")) throw pathError("ERR_INVALID_PATH", "canonical paths must use slash separators");
  return canonical;
}

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
  return `${slug}--${sha256Hex(raw).slice(0, 12)}`;
}

function pathError(code: string, message: string): CanonicalPathError {
  return new CanonicalPathError(code, message);
}

function parseFileUri(uri: string, options: NormalizeOptions): string {
  if (uri.includes("\0")) throw pathError("ERR_NUL_BYTE", "URI contains NUL");
  if (uri.startsWith("file://")) {
    if (!options.uri?.allowFileUri) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed");
    return parseHierarchicalURIPath(uri, "file://", options);
  }
  if (uri.startsWith("vscode-file://")) {
    if (!options.uri?.allowVSCodeFileUri) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed");
    return parseHierarchicalURIPath(uri, "vscode-file://", options);
  }
  if (hasUriScheme(uri)) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme");
  return uri;
}

function parseHierarchicalURIPath(raw: string, prefix: string, options: NormalizeOptions): string {
  if (options.uri?.rejectEncodedSlash !== false && /%(2f|2F|5c|5C)/.test(raw)) throw pathError("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator");
  const rest = raw.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) throw pathError("ERR_INVALID_URI", "URI path is empty");
  const authority = rest.slice(0, slash);
  const pathPart = rest.slice(slash);
  try {
    const decoded = decodeURIComponent(pathPart);
    const decodedAuthority = decodeURIComponent(authority);
    if (decoded === "") throw pathError("ERR_INVALID_URI", "URI path is empty");
    if (prefix === "file://" && decodedAuthority !== "" && decodedAuthority.toLowerCase() !== "localhost") return `//${decodedAuthority}${decoded}`;
    return decoded;
  } catch (error) {
    if (error instanceof CanonicalPathError) throw error;
    throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
  }
}

function validateTargetProfile(value: string, targetProfile: NormalizeOptions["targetProfile"]): void {
  switch (targetProfile) {
    case undefined:
    case "portable":
      return;
    case "posix":
      if (hasDriveRoot(value) || value.startsWith("//")) throw pathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots");
      return;
    case "win32-drive":
      if (value.startsWith("/")) throw pathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots");
      return;
    default:
      throw pathError("ERR_INVALID_PATH", "unsupported targetProfile");
  }
}

function isAsciiLetter(value: string): boolean {
  if (value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function hasUriScheme(value: string): boolean {
  const index = value.indexOf("://");
  if (index <= 0) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value.slice(0, index));
}

function hasDriveRoot(value: string): boolean {
  return value.length >= 3 && isAsciiLetter(value[0] ?? "") && value[1] === ":" && value[2] === "/";
}

function isDriveRelative(value: string): boolean {
  return value.length >= 2 && isAsciiLetter(value[0] ?? "") && value[1] === ":" && (value.length === 2 || value[2] !== "/");
}

function isUriWindowsDrivePath(value: string): boolean {
  return value.length >= 4 && value[0] === "/" && isAsciiLetter(value[1] ?? "") && value[2] === ":" && value[3] === "/";
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || hasDriveRoot(value.replaceAll("\\", "/"));
}

function unwrapWindowsExtendedPrefix(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice("\\\\?\\UNC\\".length)}`;
  if (value.startsWith("\\\\?\\")) return value.slice("\\\\?\\".length);
  return value;
}

function mapWSLDrive(value: string, options: NormalizeOptions["wsl"]): string | undefined {
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

function splitRoot(value: string): { prefix: string; rest: string } {
  if (hasDriveRoot(value)) return { prefix: value.slice(0, 3), rest: value.slice(3) };
  if (value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) throw pathError("ERR_INVALID_PATH", "UNC path requires server and share");
    return { prefix: `//${parts[0]}/${parts[1]}`, rest: parts.slice(2).join("/") };
  }
  if (value.startsWith("/")) return { prefix: "/", rest: value.slice(1) };
  return { prefix: "", rest: value };
}

function cleanCanonical(value: string): string {
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

function canonicalParts(value: string): { prefix: string; parts: string[] } {
  if (value.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");
  const { prefix, rest } = splitRoot(value);
  if (prefix === "") throw pathError("ERR_INVALID_PATH", "path must be canonical absolute");
  const parts = rest.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === "..")) throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned");
  return { prefix, parts };
}

function hasWindowsADS(value: string): boolean {
  let start = 0;
  if (hasDriveRoot(value)) start = 3;
  else if (value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    if (parts.length >= 2) start = `//${parts[0]}/${parts[1]}`.length;
  }
  return value.slice(start).includes(":");
}

function hasReservedDeviceName(value: string): boolean {
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

function isReservedDeviceBase(base: string): boolean {
  if (["CON", "PRN", "AUX", "NUL"].includes(base)) return true;
  return /^(COM|LPT)[1-9]$/.test(base);
}

function escapeReservedWin32Component(value: string): string {
  const dot = value.indexOf(".");
  const base = dot >= 0 ? value.slice(0, dot) : value;
  const suffix = dot >= 0 ? value.slice(dot) : "";
  if (isReservedDeviceBase(base.toUpperCase())) return `${base}-${suffix}`;
  return value;
}

function sha256Hex(value: string): string {
  const bytes = Array.from(new TextEncoder().encode(value));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const words = new Array<number>(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = ((bytes[start] ?? 0) << 24) | ((bytes[start + 1] ?? 0) << 16) | ((bytes[start + 2] ?? 0) << 8) | (bytes[start + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15] ?? 0, 7) ^ rotr(words[index - 15] ?? 0, 18) ^ ((words[index - 15] ?? 0) >>> 3);
      const s1 = rotr(words[index - 2] ?? 0, 17) ^ rotr(words[index - 2] ?? 0, 19) ^ ((words[index - 2] ?? 0) >>> 10);
      words[index] = (((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0);
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e ?? 0, 6) ^ rotr(e ?? 0, 11) ^ rotr(e ?? 0, 25);
      const ch = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = (((hh ?? 0) + s1 + ch + (k[index] ?? 0) + (words[index] ?? 0)) >>> 0);
      const s0 = rotr(a ?? 0, 2) ^ rotr(a ?? 0, 13) ^ rotr(a ?? 0, 22);
      const maj = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = ((h[0] ?? 0) + (a ?? 0)) >>> 0;
    h[1] = ((h[1] ?? 0) + (b ?? 0)) >>> 0;
    h[2] = ((h[2] ?? 0) + (c ?? 0)) >>> 0;
    h[3] = ((h[3] ?? 0) + (d ?? 0)) >>> 0;
    h[4] = ((h[4] ?? 0) + (e ?? 0)) >>> 0;
    h[5] = ((h[5] ?? 0) + (f ?? 0)) >>> 0;
    h[6] = ((h[6] ?? 0) + (g ?? 0)) >>> 0;
    h[7] = ((h[7] ?? 0) + (hh ?? 0)) >>> 0;
  }

  return h.map((item) => item.toString(16).padStart(8, "0")).join("");
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
