import haxe.Exception;
import haxe.crypto.Sha256;
import haxe.io.BytesBuffer;

class CanonicalPathError extends Exception {
  public final code: String;

  public function new(code: String, message: String) {
    super(message);
    this.code = code;
  }

  public override function toString(): String {
    return code + ": " + message;
  }
}

class CanonicalPathWSLOptions {
  public var enabled: Bool = false;
  public var mountRoot: String = "/mnt";

  public function new() {}
}

class CanonicalPathURIOptions {
  public var allowFileUri: Bool = false;
  public var allowVSCodeFileUri: Bool = false;
  public var rejectEncodedSlash: Null<Bool> = null;

  public function new() {}
}

class CanonicalPathWindowsOptions {
  public var preserveExtendedLength: Bool = false;
  public var rejectDeviceNames: Bool = false;
  public var rejectADS: Bool = false;

  public function new() {}
}

class CanonicalPathNormalizeOptions {
  public var sourceHost: String = "";
  public var targetProfile: String = "";
  public var wsl: CanonicalPathWSLOptions = new CanonicalPathWSLOptions();
  public var uri: CanonicalPathURIOptions = new CanonicalPathURIOptions();
  public var windows: CanonicalPathWindowsOptions = new CanonicalPathWindowsOptions();
  public var trimOuterWhitespace: Bool = false;

  public function new() {}
}

private class RootParts {
  public final prefix: String;
  public final rest: String;

  public function new(prefix: String, rest: String) {
    this.prefix = prefix;
    this.rest = rest;
  }
}

private class CanonicalParts {
  public final prefix: String;
  public final parts: Array<String>;

  public function new(prefix: String, parts: Array<String>) {
    this.prefix = prefix;
    this.parts = parts;
  }
}

class CanonicalPath {
  public static function normalize(raw: String, ?options: CanonicalPathNormalizeOptions): String {
    var opts = optionsOrDefault(options);
    var value = opts.trimOuterWhitespace ? StringTools.trim(raw) : raw;
    if (value.length == 0) throw pathError("ERR_EMPTY_PATH", "path is empty");
    if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL");

    if (hasUriScheme(value) || opts.sourceHost == "vscode-file-uri") value = parseFileUri(value, opts);
    if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    if (!opts.windows.preserveExtendedLength) value = unwrapWindowsExtendedPrefix(value);
    value = StringTools.replace(value, "\\", "/");

    if (opts.targetProfile != "posix") value = mapWSLDrive(value, opts.wsl);
    if (isUriWindowsDrivePath(value)) value = value.substr(1);
    if (isDriveRelative(value)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical");
    if (hasDriveRoot(value)) value = lowercaseDriveRoot(value);

    if (opts.windows.rejectADS && hasWindowsADS(value)) {
      throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
    }
    if (opts.windows.rejectDeviceNames && hasReservedDeviceName(value)) {
      throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
    }

    var cleaned = cleanCanonical(value);
    validateTargetProfile(cleaned, opts.targetProfile);
    return cleaned;
  }

  public static function relative(root: String, target: String): String {
    var rootParts = canonicalParts(root);
    var targetParts = canonicalParts(target);
    if (rootParts.prefix != targetParts.prefix || targetParts.parts.length < rootParts.parts.length) {
      throw pathError("ERR_OUTSIDE_ROOT", "target is outside root");
    }
    for (index in 0...rootParts.parts.length) {
      if (rootParts.parts[index] != targetParts.parts[index]) throw pathError("ERR_OUTSIDE_ROOT", "target is outside root");
    }
    if (targetParts.parts.length == rootParts.parts.length) return ".";
    return targetParts.parts.slice(rootParts.parts.length).join("/");
  }

  public static function join(root: String, relativePath: String): String {
    var cleanRelative = normalizeRelative(relativePath);
    if (hasNul(root)) throw pathError("ERR_NUL_BYTE", "root contains NUL");
    if (cleanRelative == ".") return root;
    if (root == "/" || StringTools.endsWith(root, "/")) return root + cleanRelative;
    return root + "/" + cleanRelative;
  }

  public static function joinParts(parts: Array<String>): String {
    var result = "";
    for (part in parts) {
      if (part.length == 0) continue;
      result = result.length == 0 ? part : join(result, part);
    }
    if (result.length == 0) throw pathError("ERR_EMPTY_PATH", "join parts are empty");
    return result;
  }

  public static function normalizeRelative(raw: String): String {
    if (raw.length == 0) throw pathError("ERR_EMPTY_PATH", "relative path is empty");
    if (raw == ".") return ".";
    if (hasNul(raw)) throw pathError("ERR_NUL_BYTE", "relative path contains NUL");
    if (isAbsolutePathLike(raw)) throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute");
    if (isDriveRelative(raw)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed");
    if (raw.indexOf("\\") >= 0) throw pathError("ERR_INVALID_PATH", "relative path must use slash separators");

    var parts: Array<String> = [];
    for (part in raw.split("/")) {
      if (part.length == 0 || part == ".") continue;
      if (part == "..") {
        if (parts.length == 0) throw pathError("ERR_OUTSIDE_ROOT", "relative path escapes root");
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    if (parts.length == 0) throw pathError("ERR_EMPTY_PATH", "relative path is empty after cleaning");
    return parts.join("/");
  }

  public static function isEqual(left: String, right: String, ?options: CanonicalPathNormalizeOptions): Bool {
    var opts = optionsOrDefault(options);
    return normalize(left, opts) == normalize(right, opts);
  }

  public static function toWin32(canonical: String): String {
    if (hasNul(canonical)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    if (hasDriveRoot(canonical)) {
      return uppercaseASCII(canonical.charAt(0)) + ":\\" + StringTools.replace(canonical.substr(3), "/", "\\");
    }
    if (StringTools.startsWith(canonical, "//")) return "\\\\" + StringTools.replace(canonical.substr(2), "/", "\\");
    return StringTools.replace(canonical, "/", "\\");
  }

  public static function toWSL(canonical: String, ?options: CanonicalPathWSLOptions): String {
    var opts = options == null ? new CanonicalPathWSLOptions() : options;
    if (hasNul(canonical)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    if (!hasDriveRoot(canonical)) return canonical;
    var mountRoot = trimRightSlashes(opts.mountRoot.length == 0 ? "/mnt" : opts.mountRoot);
    var rest = canonical.substr(3);
    var drive = lowercaseASCII(canonical.charAt(0));
    if (rest.length == 0) return mountRoot + "/" + drive;
    return mountRoot + "/" + drive + "/" + rest;
  }

  public static function toPOSIX(canonical: String): String {
    if (hasNul(canonical)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    if (hasDriveRoot(canonical)) throw pathError("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as to_wsl");
    if (canonical.indexOf("\\") >= 0) throw pathError("ERR_INVALID_PATH", "canonical paths must use slash separators");
    return canonical;
  }

  public static function sanitizeComponent(name: String, profile: String): String {
    if (name.length == 0) throw pathError("ERR_INVALID_COMPONENT", "component is empty");
    if (hasNul(name)) throw pathError("ERR_NUL_BYTE", "component contains NUL");
    var value = trimComponentEdges(replaceUnsafeComponentChars(name));
    if (value.length == 0) value = "component";
    if (profile == "win32") value = escapeReservedWin32Component(value);
    return value;
  }

  public static function encodeComponent(name: String, profile: String): String {
    return sanitizeComponent(name, profile);
  }

  public static function encodeGitRef(raw: String): String {
    if (raw.length == 0) throw pathError("ERR_INVALID_COMPONENT", "git ref is empty");
    if (hasNul(raw)) throw pathError("ERR_NUL_BYTE", "git ref contains NUL");
    var slug = trimComponentEdges(slugGitRef(raw));
    if (slug.length == 0) slug = "ref";
    return slug + "--" + Sha256.encode(raw).substr(0, 12);
  }

  private static function optionsOrDefault(options: CanonicalPathNormalizeOptions): CanonicalPathNormalizeOptions {
    return options == null ? new CanonicalPathNormalizeOptions() : options;
  }

  private static function parseFileUri(uri: String, options: CanonicalPathNormalizeOptions): String {
    if (hasNul(uri)) throw pathError("ERR_NUL_BYTE", "URI contains NUL");
    if (StringTools.startsWith(uri, "file://")) {
      if (!options.uri.allowFileUri) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed");
      return parseHierarchicalURIPath(uri, "file://", options);
    }
    if (StringTools.startsWith(uri, "vscode-file://")) {
      if (!options.uri.allowVSCodeFileUri) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed");
      return parseHierarchicalURIPath(uri, "vscode-file://", options);
    }
    if (hasUriScheme(uri)) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme");
    return uri;
  }

  private static function parseHierarchicalURIPath(raw: String, prefix: String, options: CanonicalPathNormalizeOptions): String {
    var rejectEncodedSlash = options.uri.rejectEncodedSlash == null ? true : options.uri.rejectEncodedSlash;
    if (rejectEncodedSlash && hasEncodedSeparator(raw)) throw pathError("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator");

    var rest = raw.substr(prefix.length);
    var slash = rest.indexOf("/");
    if (slash < 0) throw pathError("ERR_INVALID_URI", "URI path is empty");
    var decodedAuthority = percentDecode(rest.substr(0, slash));
    var decodedPath = percentDecode(rest.substr(slash));
    if (decodedPath.length == 0) throw pathError("ERR_INVALID_URI", "URI path is empty");
    if (prefix == "file://" && decodedAuthority.length != 0 && lowerASCII(decodedAuthority) != "localhost") {
      return "//" + decodedAuthority + decodedPath;
    }
    return decodedPath;
  }

  private static function percentDecode(value: String): String {
    var bytes = new BytesBuffer();
    var index = 0;
    while (index < value.length) {
      if (value.charAt(index) != "%") {
        bytes.addString(value.charAt(index));
        index += 1;
        continue;
      }
      if (index + 2 >= value.length) throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
      var high = hexValue(value.charAt(index + 1));
      var low = hexValue(value.charAt(index + 2));
      if (high < 0 || low < 0) throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
      bytes.addByte((high << 4) | low);
      index += 3;
    }
    return bytes.getBytes().toString();
  }

  private static function hasEncodedSeparator(value: String): Bool {
    if (value.length < 3) return false;
    for (index in 0...(value.length - 2)) {
      if (value.charAt(index) != "%") continue;
      var high = lowercaseASCII(value.charAt(index + 1));
      var low = lowercaseASCII(value.charAt(index + 2));
      if ((high == "2" && low == "f") || (high == "5" && low == "c")) return true;
    }
    return false;
  }

  private static function unwrapWindowsExtendedPrefix(value: String): String {
    if (StringTools.startsWith(value, "\\\\?\\UNC\\")) return "\\\\" + value.substr("\\\\?\\UNC\\".length);
    if (StringTools.startsWith(value, "\\\\?\\")) return value.substr("\\\\?\\".length);
    return value;
  }

  private static function mapWSLDrive(value: String, options: CanonicalPathWSLOptions): String {
    if (!options.enabled) return value;
    var mountRoot = trimRightSlashes(options.mountRoot.length == 0 ? "/mnt" : options.mountRoot);
    var prefix = mountRoot + "/";
    if (!StringTools.startsWith(value, prefix)) return value;
    var rest = value.substr(prefix.length);
    if (rest.length == 0 || !isASCIILetter(rest.charAt(0))) return value;
    if (rest.length > 1 && rest.charAt(1) != "/") return value;
    var drive = lowercaseASCII(rest.charAt(0));
    if (rest.length == 1) return drive + ":/";
    return drive + ":/" + rest.substr(2);
  }

  private static function cleanCanonical(value: String): String {
    if (value.length == 0) throw pathError("ERR_EMPTY_PATH", "path is empty");
    var root = splitRoot(value);
    var parts: Array<String> = [];
    for (part in root.rest.split("/")) {
      if (part.length == 0 || part == ".") continue;
      if (part == "..") {
        if (parts.length != 0) {
          parts.pop();
          continue;
        }
        if (root.prefix.length != 0) continue;
        throw pathError("ERR_INVALID_PATH", "relative path escapes above its root");
      }
      parts.push(part);
    }

    var joined = parts.join("/");
    if (root.prefix.length == 0) return joined.length == 0 ? "." : joined;
    if (root.prefix == "/") return joined.length == 0 ? "/" : "/" + joined;
    if (StringTools.endsWith(root.prefix, "/")) return joined.length == 0 ? root.prefix : root.prefix + joined;
    return joined.length == 0 ? root.prefix : root.prefix + "/" + joined;
  }

  private static function validateTargetProfile(value: String, targetProfile: String): Void {
    if (targetProfile.length == 0 || targetProfile == "portable") return;
    if (targetProfile == "posix") {
      if (hasDriveRoot(value) || StringTools.startsWith(value, "//")) {
        throw pathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots");
      }
      return;
    }
    if (targetProfile == "win32-drive") {
      if (StringTools.startsWith(value, "/")) throw pathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots");
      return;
    }
    throw pathError("ERR_INVALID_PATH", "unsupported targetProfile");
  }

  private static function canonicalParts(value: String): CanonicalParts {
    if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    var root = splitRoot(value);
    if (root.prefix.length == 0) throw pathError("ERR_INVALID_PATH", "path must be canonical absolute");
    var parts: Array<String> = [];
    for (part in root.rest.split("/")) {
      if (part.length == 0) continue;
      if (part == "." || part == "..") throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned");
      parts.push(part);
    }
    return new CanonicalParts(root.prefix, parts);
  }

  private static function splitRoot(value: String): RootParts {
    if (hasDriveRoot(value)) return new RootParts(value.substr(0, 3), value.substr(3));
    if (StringTools.startsWith(value, "//")) {
      var rest = value.substr(2);
      var first = rest.indexOf("/");
      if (first <= 0) throw pathError("ERR_INVALID_PATH", "UNC path requires server and share");
      var server = rest.substr(0, first);
      var afterFirst = rest.substr(first + 1);
      var second = afterFirst.indexOf("/");
      var share = second >= 0 ? afterFirst.substr(0, second) : afterFirst;
      var tail = second >= 0 ? afterFirst.substr(second + 1) : "";
      if (share.length == 0) throw pathError("ERR_INVALID_PATH", "UNC path requires server and share");
      return new RootParts("//" + server + "/" + share, tail);
    }
    if (StringTools.startsWith(value, "/")) return new RootParts("/", value.substr(1));
    return new RootParts("", value);
  }

  private static function hasWindowsADS(value: String): Bool {
    var start = 0;
    if (hasDriveRoot(value)) {
      start = 3;
    } else if (StringTools.startsWith(value, "//")) {
      try {
        start = splitRoot(value).prefix.length;
      } catch (_: CanonicalPathError) {
        start = 0;
      }
    }
    return value.substr(start).indexOf(":") >= 0;
  }

  private static function hasReservedDeviceName(value: String): Bool {
    var root: RootParts;
    try {
      root = splitRoot(value);
    } catch (_: CanonicalPathError) {
      return false;
    }
    for (part in root.rest.split("/")) {
      if (part.length == 0 || part == "." || part == "..") continue;
      var splitAt = indexOfAny(part, [".", ":"]);
      var base = splitAt >= 0 ? part.substr(0, splitAt) : part;
      if (isReservedDeviceBase(base)) return true;
    }
    return false;
  }

  private static function replaceUnsafeComponentChars(input: String): String {
    var result = new StringBuf();
    var previousUnsafe = false;
    for (index in 0...input.length) {
      var ch = input.charAt(index);
      var unsafe = ch == "/" || ch == "\\" || ch == ":" || ch == "\t" || ch == "\n" || ch == "\r";
      if (unsafe) {
        if (!previousUnsafe) result.add("-");
        previousUnsafe = true;
      } else {
        result.add(ch);
        previousUnsafe = false;
      }
    }
    return result.toString();
  }

  private static function escapeReservedWin32Component(value: String): String {
    var dot = value.indexOf(".");
    var base = dot >= 0 ? value.substr(0, dot) : value;
    var suffix = dot >= 0 ? value.substr(dot) : "";
    if (isReservedDeviceBase(base)) return base + "-" + suffix;
    return value;
  }

  private static function isReservedDeviceBase(value: String): Bool {
    var upper = value.toUpperCase();
    if (upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL") return true;
    if (upper.length != 4) return false;
    if (!StringTools.startsWith(upper, "COM") && !StringTools.startsWith(upper, "LPT")) return false;
    var digit = upper.charCodeAt(3);
    return digit >= "1".code && digit <= "9".code;
  }

  private static function slugGitRef(raw: String): String {
    var result = new StringBuf();
    var previousUnsafe = false;
    for (index in 0...raw.length) {
      var ch = raw.charAt(index);
      if (isGitRefSlugChar(ch)) {
        result.add(ch);
        previousUnsafe = false;
      } else if (!previousUnsafe) {
        result.add("-");
        previousUnsafe = true;
      }
    }
    return result.toString();
  }

  private static function isGitRefSlugChar(value: String): Bool {
    var code = value.charCodeAt(0);
    return (code >= "A".code && code <= "Z".code) || (code >= "a".code && code <= "z".code) || (code >= "0".code && code <= "9".code) || value == "." || value == "_" || value == "-";
  }

  private static function hasUriScheme(value: String): Bool {
    var index = value.indexOf("://");
    if (index <= 0) return false;
    if (!isASCIILetter(value.charAt(0))) return false;
    for (position in 1...index) {
      var ch = value.charAt(position);
      var code = ch.charCodeAt(0);
      if (!(isASCIILetter(ch) || (code >= "0".code && code <= "9".code) || ch == "+" || ch == "." || ch == "-")) return false;
    }
    return true;
  }

  private static function hasDriveRoot(value: String): Bool {
    return value.length >= 3 && isASCIILetter(value.charAt(0)) && value.charAt(1) == ":" && value.charAt(2) == "/";
  }

  private static function isDriveRelative(value: String): Bool {
    return value.length >= 2 && isASCIILetter(value.charAt(0)) && value.charAt(1) == ":" && (value.length == 2 || value.charAt(2) != "/");
  }

  private static function isUriWindowsDrivePath(value: String): Bool {
    return value.length >= 4 && value.charAt(0) == "/" && isASCIILetter(value.charAt(1)) && value.charAt(2) == ":" && value.charAt(3) == "/";
  }

  private static function isAbsolutePathLike(value: String): Bool {
    return StringTools.startsWith(value, "/") || StringTools.startsWith(value, "\\\\") || hasDriveRoot(StringTools.replace(value, "\\", "/"));
  }

  private static function lowercaseDriveRoot(value: String): String {
    return lowercaseASCII(value.charAt(0)) + value.substr(1);
  }

  private static function hasNul(value: String): Bool {
    return value.indexOf("\x00") >= 0;
  }

  private static function isASCIILetter(value: String): Bool {
    if (value.length == 0) return false;
    var code = value.charCodeAt(0);
    return (code >= "A".code && code <= "Z".code) || (code >= "a".code && code <= "z".code);
  }

  private static function lowercaseASCII(value: String): String {
    var code = value.charCodeAt(0);
    if (code >= "A".code && code <= "Z".code) return String.fromCharCode(code + 32);
    return value;
  }

  private static function uppercaseASCII(value: String): String {
    var code = value.charCodeAt(0);
    if (code >= "a".code && code <= "z".code) return String.fromCharCode(code - 32);
    return value;
  }

  private static function lowerASCII(value: String): String {
    var result = new StringBuf();
    for (index in 0...value.length) result.add(lowercaseASCII(value.charAt(index)));
    return result.toString();
  }

  private static function hexValue(value: String): Int {
    var code = value.charCodeAt(0);
    if (code >= "0".code && code <= "9".code) return code - "0".code;
    if (code >= "A".code && code <= "F".code) return code - "A".code + 10;
    if (code >= "a".code && code <= "f".code) return code - "a".code + 10;
    return -1;
  }

  private static function trimRightSlashes(value: String): String {
    var result = value;
    while (StringTools.endsWith(result, "/")) result = result.substr(0, result.length - 1);
    return result;
  }

  private static function trimComponentEdges(value: String): String {
    var start = 0;
    var end = value.length;
    while (start < end && isComponentEdgeChar(value.charAt(start))) start++;
    while (start < end && isComponentEdgeChar(value.charAt(end - 1))) end--;
    return value.substr(start, end - start);
  }

  private static function isComponentEdgeChar(value: String): Bool {
    return value == " " || value == "." || value == "_" || value == "-";
  }

  private static function indexOfAny(value: String, needles: Array<String>): Int {
    var result = -1;
    for (needle in needles) {
      var index = value.indexOf(needle);
      if (index >= 0 && (result < 0 || index < result)) result = index;
    }
    return result;
  }

  private static function pathError(code: String, message: String): CanonicalPathError {
    return new CanonicalPathError(code, message);
  }
}
