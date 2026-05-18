import type { NormalizeOptions } from "./types.js";
import { pathError } from "./errors.js";
import { hasUriScheme } from "./internal.js";

export function parseFileUri(uri: string, options: NormalizeOptions = {}): string {
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
  if (options.uri?.rejectEncodedSlash !== false && hasEncodedSeparator(raw)) {
    throw pathError("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator");
  }

  const rest = raw.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) throw pathError("ERR_INVALID_URI", "URI path is empty");

  const authority = rest.slice(0, slash);
  const pathPart = rest.slice(slash);
  try {
    const decoded = decodeURIComponent(pathPart);
    const decodedAuthority = decodeURIComponent(authority);
    if (decoded === "") throw pathError("ERR_INVALID_URI", "URI path is empty");
    if (prefix === "file://" && decodedAuthority !== "" && decodedAuthority.toLowerCase() !== "localhost") {
      return `//${decodedAuthority}${decoded}`;
    }
    return decoded;
  } catch (error) {
    if (error instanceof Error && error.name === "CanonicalPathError") throw error;
    throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
  }
}

function hasEncodedSeparator(value: string): boolean {
  return /%(2f|2F|5c|5C)/.test(value);
}
