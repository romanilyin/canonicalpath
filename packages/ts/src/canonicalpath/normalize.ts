import type { CanonicalPath, NormalizeOptions } from "./types.js";
import { pathError } from "./errors.js";
import {
  cleanCanonical,
  hasDriveRoot,
  hasReservedDeviceName,
  hasUriScheme,
  hasWindowsADS,
  isDriveRelative,
  isUriWindowsDrivePath,
  mapWSLDrive,
  unwrapWindowsExtendedPrefix,
} from "./internal.js";
import { parseFileUri } from "./uri.js";

export function normalize(raw: string, options: NormalizeOptions = {}): CanonicalPath {
  if (options.trimOuterWhitespace) raw = raw.trim();
  if (raw === "") throw pathError("ERR_EMPTY_PATH", "path is empty");
  if (raw.includes("\0")) throw pathError("ERR_NUL_BYTE", "path contains NUL");

  let value = raw;
  if (hasUriScheme(value) || options.sourceHost === "vscode-file-uri") {
    value = parseFileUri(value, options);
  }

  if (!options.windows?.preserveExtendedLength) value = unwrapWindowsExtendedPrefix(value);
  value = value.replaceAll("\\", "/");

  if (options.targetProfile !== "posix") value = mapWSLDrive(value, options.wsl) ?? value;
  if (isUriWindowsDrivePath(value)) value = value.slice(1);

  if (isDriveRelative(value)) {
    throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical");
  }
  if (hasDriveRoot(value)) value = `${value[0]?.toLowerCase()}${value.slice(1)}`;

  if (options.windows?.rejectADS && hasWindowsADS(value)) {
    throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
  }
  if (options.windows?.rejectDeviceNames && hasReservedDeviceName(value)) {
    throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
  }

  const cleaned = cleanCanonical(value);
  validateTargetProfile(cleaned, options.targetProfile);
  return cleaned as CanonicalPath;
}

function validateTargetProfile(value: string, targetProfile: NormalizeOptions["targetProfile"]): void {
  switch (targetProfile) {
    case undefined:
    case "portable":
      return;
    case "posix":
      if (hasDriveRoot(value) || value.startsWith("//")) {
        throw pathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots");
      }
      return;
    case "win32-drive":
      if (value.startsWith("/")) {
        throw pathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots");
      }
      return;
    default:
      throw pathError("ERR_INVALID_PATH", "unsupported targetProfile");
  }
}
