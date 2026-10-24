import haxe.Exception;
import haxe.crypto.Sha256;
import haxe.io.Bytes;
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
  public final kind: String;

  public function new(prefix: String, rest: String) {
    this.prefix = prefix;
    this.rest = rest;
    this.kind = prefix == "" ? "relative" : prefix == "/" ? "posix" : StringTools.startsWith(prefix, "//?/UNC/") ? "extended-unc" : StringTools.startsWith(prefix, "//?/") ? "extended-drive" : StringTools.startsWith(prefix, "//") ? "unc" : "drive";
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
    var mount = normalizeMount(opts.wsl.mountRoot);
    if (opts.sourceHost == "posix") {
      if (opts.wsl.enabled) throw pathError("ERR_INVALID_PATH", "native POSIX input cannot enable WSL mapping");
      validateWindowsComponents(value, opts, true);
      value = cleanCanonical(value, true);
    } else if (opts.sourceHost == "canonical") {
      validateWindowsComponents(value, opts);
      value = cleanCanonical(value);
    } else {
      var uriInput = hasUriScheme(value);
      if (uriInput || opts.sourceHost == "vscode-file-uri") value = parseFileUri(value, opts);
      var candidate = opts.wsl.enabled && StringTools.startsWith(value, "/") && (!StringTools.startsWith(value, "//") || StringTools.startsWith(value, "///")) && !(uriInput && isUriWindowsDrivePath(value));
      if (candidate) {
        validateWindowsComponents(value, opts, true);
        value = cleanCanonical(value, true);
        var prefix = mount == "/" ? "/" : mount + "/";
        if (opts.targetProfile != "posix" && StringTools.startsWith(value, prefix)) {
          var tail = value.substr(prefix.length);
          if (tail.length > 0 && isASCIILetter(tail.charAt(0)) && (tail.length == 1 || tail.charAt(1) == "/")) value = lowercaseASCII(tail.charAt(0)) + ":/" + (tail.length == 1 ? "" : tail.substr(2));
        }
        value = cleanCanonical(value);
      } else {
        value = StringTools.replace(value, "\\", "/");
        if (isUriWindowsDrivePath(value)) value = value.substr(1);
        var parsed = splitRoot(value);
        if (!opts.windows.preserveExtendedLength) {
          if (parsed.kind == "extended-drive") value = value.substr(4);
          else if (parsed.kind == "extended-unc") value = "//" + value.substr(8);
        }
        validateWindowsComponents(value, opts);
        value = cleanCanonical(value);
      }
    }
    validateTargetProfile(value, opts.targetProfile);
    return value;
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
    return markRelative(targetParts.parts.slice(rootParts.parts.length).join("/"));
  }

  public static function join(root: String, relativePath: String): String {
    var parsedRoot = requireCanonical(root);
    if (splitRoot(relativePath).prefix.length != 0) throw pathError("ERR_ABSOLUTE_PATH", "join argument must be relative");
    if (isWindowsRoot(parsedRoot) && relativePath.indexOf("\\") >= 0) throw pathError("ERR_INVALID_PATH", "backslash data is not representable under a Windows root");
    var clean = cleanCanonical(relativePath, false, "ERR_OUTSIDE_ROOT");
    if (clean == ".") return root;
    if (StringTools.startsWith(clean, "./")) clean = clean.substr(2);
    return cleanCanonical(root == "." ? clean : trimRightSlashes(root) + "/" + clean, parsedRoot.kind == "relative");
  }

  public static function joinParts(parts: Array<String>): String {
    if (parts == null || parts.length == 0) throw pathError("ERR_EMPTY_PATH", "join requires at least one path part");
    requireCanonical(parts[0]);
    var value = parts[0];
    for (i in 1...parts.length) value = join(value, parts[i]);
    return value;
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
    var root = requireCanonical(canonical, true);
    if (root.kind == "posix" || canonical.indexOf("\\") >= 0 || StringTools.startsWith(canonical, "./")) throw pathError("ERR_INVALID_PATH", "canonical path is not representable as Windows");
    var value = canonical;
    if (root.kind == "drive") value = uppercaseASCII(value.charAt(0)) + value.substr(1);
    if (root.kind == "extended-drive") value = value.substr(0, 4) + uppercaseASCII(value.charAt(4)) + value.substr(5);
    return StringTools.replace(value, "/", "\\");
  }

  public static function toWSL(canonical: String, ?options: CanonicalPathWSLOptions): String {
    var mount = normalizeMount(options == null ? null : options.mountRoot);
    var root = requireCanonical(canonical, true);
    if (root.kind == "relative" || root.kind == "posix") return canonical;
    if (root.kind != "drive") throw pathError("ERR_INVALID_PATH", "WSL serialization requires an ordinary drive");
    return (mount == "/" ? "" : mount) + "/" + root.prefix.charAt(0) + (root.rest.length == 0 ? "" : "/" + root.rest);
  }

  public static function toPOSIX(canonical: String): String {
    if (isWindowsRoot(requireCanonical(canonical))) throw pathError("ERR_INVALID_PATH", "Windows root requires explicit host mapping");
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
    var utf8 = validateGitRefUnicode(raw);
    var slug = trimComponentEdges(trimComponentEdges(slugGitRef(raw)).substr(0, 80));
    if (slug.length == 0) slug = "ref";
    // Hash the validated UTF-8 bytes, independently of the target's String length.
    return "v2-" + slug + "--" + Sha256.make(utf8).toHex();
  }

  private static function validateGitRefUnicode(raw: String): Bytes {
    var decoded: Bytes;
    try { decoded = Bytes.ofString(raw); }
    catch (_: Dynamic) { throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode"); }
    var i = 0;
    while (i < decoded.length) {
      var first = decoded.get(i++);
      if (first < 0x80) continue;
      var count: Int; var code: Int; var minimum: Int;
      if (first >= 0xc2 && first <= 0xdf) { count = 1; code = first & 0x1f; minimum = 0x80; }
      else if (first >= 0xe0 && first <= 0xef) { count = 2; code = first & 0x0f; minimum = 0x800; }
      else if (first >= 0xf0 && first <= 0xf4) { count = 3; code = first & 0x07; minimum = 0x10000; }
      else throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
      if (decoded.length - i < count) throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
      for (_ in 0...count) {
        var next = decoded.get(i++);
        if ((next & 0xc0) != 0x80) throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
        code = (code << 6) | (next & 0x3f);
      }
      if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
    }
    if (decoded.toString() != raw) throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
    return decoded;
  }

  private static function markRelative(value: String): String {
    return value.length >= 2 && isASCIILetter(value.charAt(0)) && value.charAt(1) == ":" ? "./" + value : value;
  }

  private static function isWindowsRoot(root: RootParts): Bool {
    return root.kind != "relative" && root.kind != "posix";
  }

  private static function splitUNC(value: String, prefix: String): RootParts {
    var parts = value.split("/");
    if (parts.length < 2 || parts[0] == "" || parts[1] == "" || parts[0] == "." || parts[0] == ".." || parts[1] == "." || parts[1] == "..") throw pathError("ERR_INVALID_PATH", "UNC requires server and share");
    return new RootParts(prefix + parts[0] + "/" + parts[1], parts.slice(2).join("/"));
  }

  private static function requireCanonical(value: String, allowDriveCase: Bool = false): RootParts {
    var parsed = splitRoot(value);
    var expected = value;
    if (allowDriveCase && parsed.kind == "drive") expected = lowercaseASCII(value.charAt(0)) + value.substr(1);
    else if (allowDriveCase && parsed.kind == "extended-drive") expected = value.substr(0, 4) + lowercaseASCII(value.charAt(4)) + value.substr(5);
    if (cleanCanonical(value) != expected) throw pathError("ERR_INVALID_PATH", "path must be lexically cleaned canonical data");
    return parsed;
  }

  private static function normalizeMount(value: String): String {
    if (value == null || value.length == 0) value = "/mnt";
    if (splitRoot(value, true).kind != "posix") throw pathError("ERR_INVALID_PATH", "WSL mount root must be absolute POSIX");
    return cleanCanonical(value, true);
  }

  private static function validateWindowsComponents(value: String, opts: CanonicalPathNormalizeOptions, nativePosix: Bool = false): Void {
    var rest = splitRoot(value, nativePosix).rest;
    if (opts.windows.rejectADS && rest.indexOf(":") >= 0) throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
    if (opts.windows.rejectDeviceNames) for (part in rest.split("/")) {
      var end = indexOfAny(part, [".", ":"]);
      if (isReservedDeviceBase(end < 0 ? part : part.substr(0, end))) throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
    }
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
    if (decodedPath.indexOf(String.fromCharCode(0)) >= 0 || decodedAuthority.indexOf(String.fromCharCode(0)) >= 0) throw pathError("ERR_NUL_BYTE", "decoded URI contains NUL");
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
    var decoded = bytes.getBytes();
    var i = 0;
    while (i < decoded.length) {
      var first = decoded.get(i++);
      if (first < 0x80) continue;
      var count: Int; var code: Int; var minimum: Int;
      if (first >= 0xc2 && first <= 0xdf) { count = 1; code = first & 0x1f; minimum = 0x80; }
      else if (first >= 0xe0 && first <= 0xef) { count = 2; code = first & 0x0f; minimum = 0x800; }
      else if (first >= 0xf0 && first <= 0xf4) { count = 3; code = first & 0x07; minimum = 0x10000; }
      else throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8");
      if (decoded.length - i < count) throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8");
      for (_ in 0...count) {
        var next = decoded.get(i++);
        if ((next & 0xc0) != 0x80) throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8");
        code = (code << 6) | (next & 0x3f);
      }
      if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8");
    }
    return decoded.toString();
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
    var prefix = (~/\/+/g).replace(mountRoot, "/") + "/";
    if (!StringTools.startsWith(value, prefix)) return value;
    var rest = value.substr(prefix.length);
    if (rest.length == 0 || !isASCIILetter(rest.charAt(0))) return value;
    if (rest.length > 1 && rest.charAt(1) != "/") return value;
    var drive = lowercaseASCII(rest.charAt(0));
    if (rest.length == 1) return drive + ":/";
    return drive + ":/" + rest.substr(2);
  }

  private static function cleanCanonical(value: String, nativePosix: Bool = false, escapeCode: String = "ERR_INVALID_PATH"): String {
    if (value.length == 0) throw pathError("ERR_EMPTY_PATH", "path is empty");
    var root = splitRoot(value, nativePosix);
    var parts: Array<String> = [];
    for (part in root.rest.split("/")) {
      if (part.length == 0 || part == ".") continue;
      if (part == "..") {
        if (parts.length != 0) {
          parts.pop();
          continue;
        }
        if (root.prefix.length != 0) continue;
        throw pathError(escapeCode, "relative path escapes above its root");
      }
      parts.push(part);
    }

    var joined = parts.join("/");
    if (root.prefix.length == 0) return joined.length == 0 ? "." : markRelative(joined);
    if (root.prefix == "/") return joined.length == 0 ? "/" : "/" + joined;
    if (StringTools.endsWith(root.prefix, "/")) return joined.length == 0 ? root.prefix : root.prefix + joined;
    return joined.length == 0 ? root.prefix : root.prefix + "/" + joined;
  }

  private static function validateTargetProfile(value: String, targetProfile: String): Void {
    var root = splitRoot(value);
    if (targetProfile.length == 0 || targetProfile == "portable") return;
    if (targetProfile == "posix" && !isWindowsRoot(root)) return;
    if (targetProfile == "win32-drive" && (root.kind == "relative" || root.kind == "drive" || root.kind == "extended-drive")) return;
    throw pathError("ERR_INVALID_PATH", "canonical root is incompatible with target profile");
  }

  private static function canonicalParts(value: String): CanonicalParts {
    if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    var root = requireCanonical(value);
    if (root.prefix.length == 0) throw pathError("ERR_INVALID_PATH", "path must be canonical absolute");
    var parts: Array<String> = [];
    for (part in root.rest.split("/")) {
      if (part.length == 0) continue;
      if (part == "." || part == "..") throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned");
      parts.push(part);
    }
    return new CanonicalParts(root.prefix, parts);
  }

  private static function splitRoot(value: String, nativePosix: Bool = false): RootParts {
    if (value.length == 0) throw pathError("ERR_EMPTY_PATH", "path is empty");
    if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL");
    if (nativePosix) {
      if (StringTools.startsWith(value, "//") && !StringTools.startsWith(value, "///")) throw pathError("ERR_INVALID_PATH", "double-leading-slash POSIX path is unsupported");
      return StringTools.startsWith(value, "/") ? new RootParts("/", value.substr(1)) : new RootParts("", value);
    }
    var parsed: RootParts;
    if (StringTools.startsWith(value, "//?/")) {
      var tail = value.substr(4);
      if (hasDriveRoot(tail)) parsed = new RootParts("//?/" + lowercaseASCII(tail.charAt(0)) + ":/", tail.substr(3));
      else if (StringTools.startsWith(tail, "UNC/")) parsed = splitUNC(tail.substr(4), "//?/UNC/");
      else throw pathError("ERR_INVALID_PATH", "unsupported or incomplete extended root");
    } else if (hasDriveRoot(value)) parsed = new RootParts(lowercaseASCII(value.charAt(0)) + ":/", value.substr(3));
    else if (isDriveRelative(value)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "unmarked drive-relative path");
    else if (StringTools.startsWith(value, "//")) parsed = splitUNC(value.substr(2), "//");
    else if (StringTools.startsWith(value, "/")) parsed = new RootParts("/", value.substr(1));
    else parsed = new RootParts("", value);
    if (isWindowsRoot(parsed) && value.indexOf("\\") >= 0) throw pathError("ERR_INVALID_PATH", "Windows canonical components cannot contain backslash");
    return parsed;
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
