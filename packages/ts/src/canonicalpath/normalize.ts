import type { CanonicalPath, NormalizeOptions } from "./types.js";
import { pathError } from "./errors.js";
import {
  cleanCanonical,
  hasReservedDeviceName,
  hasUriScheme,
  hasWindowsADS,
  isUriWindowsDrivePath,
  isWindowsRoot,
  mapWSLDrive,
  nativePOSIXRepresentation,
  normalizeMountRoot,
  splitRoot,
  unwrapWindowsExtendedPrefix,
} from "./internal.js";
import { parseFileUri } from "./uri.js";

export function normalize(raw: string, options: NormalizeOptions = {}): CanonicalPath {
  if (options.trimOuterWhitespace) raw = raw.trim();
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "path is empty");
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");

  if (options.wsl?.mountRoot !== undefined || options.wsl?.enabled) normalizeMountRoot(options.wsl?.mountRoot);

  let value = raw;
  if (options.sourceHost === "posix") {
    if (options.wsl?.enabled) throw pathError("ERR_INVALID_PATH", "native POSIX input cannot enable cross-host WSL mapping");
    value = nativePOSIXRepresentation(value);
  } else if (options.sourceHost !== "canonical") {
    const uriInput = hasUriScheme(value);
    if (uriInput) value = parseFileUri(value, options);
    const posixMountCandidate = options.wsl?.enabled && value.startsWith("/") && (!value.startsWith("//") || value.startsWith("///")) && !(uriInput && isUriWindowsDrivePath(value));
    if (posixMountCandidate) {
      // Check prohibited components before cleanup, then choose a drive only
      // after POSIX traversal has resolved across mount/drive boundaries.
      value = nativePOSIXRepresentation(value);
      validateWindowsPolicy(value, options);
      value = cleanCanonical(value);
      if (options.targetProfile !== "posix") value = mapWSLDrive(value, options.wsl) ?? value;
    } else {
      value = value.replaceAll("\\", "/");
      if (!options.windows?.preserveExtendedLength) value = unwrapWindowsExtendedPrefix(value);
      if (isUriWindowsDrivePath(value)) value = value.slice(1);
    }
  }
  validateWindowsPolicy(value, options);

  const cleaned = cleanCanonical(value);
  validateTargetProfile(cleaned, options.targetProfile);
  return cleaned as CanonicalPath;
}

function validateWindowsPolicy(value: string, options: NormalizeOptions): void {
  if (options.windows?.rejectADS && hasWindowsADS(value)) throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
  if (options.windows?.rejectDeviceNames && hasReservedDeviceName(value)) throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
}

function validateTargetProfile(value: string, targetProfile: NormalizeOptions["targetProfile"]): void {
  const kind = splitRoot(value).kind;
  switch (targetProfile) {
    case undefined:
    case "portable":
      return;
    case "posix":
      if (isWindowsRoot(kind)) {
        throw pathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots");
      }
      return;
    case "win32-drive":
      if (kind === "posix" || kind === "unc" || kind === "extended-unc") {
        throw pathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots");
      }
      return;
    default:
      throw pathError("ERR_INVALID_PATH", "unsupported targetProfile");
  }
}
