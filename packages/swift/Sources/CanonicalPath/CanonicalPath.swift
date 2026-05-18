import Foundation

public struct CanonicalPathError: Error, Equatable, CustomStringConvertible {
    public let code: String
    public let message: String

    public init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }

    public var description: String {
        "\(code): \(message)"
    }
}

public struct CanonicalPathWSLOptions: Equatable {
    public var enabled: Bool
    public var mountRoot: String

    public init(enabled: Bool = false, mountRoot: String = "/mnt") {
        self.enabled = enabled
        self.mountRoot = mountRoot
    }
}

public struct CanonicalPathURIOptions: Equatable {
    public var allowFileUri: Bool
    public var allowVSCodeFileUri: Bool
    public var rejectEncodedSlash: Bool?

    public init(allowFileUri: Bool = false, allowVSCodeFileUri: Bool = false, rejectEncodedSlash: Bool? = nil) {
        self.allowFileUri = allowFileUri
        self.allowVSCodeFileUri = allowVSCodeFileUri
        self.rejectEncodedSlash = rejectEncodedSlash
    }
}

public struct CanonicalPathWindowsOptions: Equatable {
    public var preserveExtendedLength: Bool
    public var rejectDeviceNames: Bool
    public var rejectADS: Bool

    public init(preserveExtendedLength: Bool = false, rejectDeviceNames: Bool = false, rejectADS: Bool = false) {
        self.preserveExtendedLength = preserveExtendedLength
        self.rejectDeviceNames = rejectDeviceNames
        self.rejectADS = rejectADS
    }
}

public struct CanonicalPathNormalizeOptions: Equatable {
    public var sourceHost: String
    public var targetProfile: String
    public var wsl: CanonicalPathWSLOptions
    public var uri: CanonicalPathURIOptions
    public var windows: CanonicalPathWindowsOptions
    public var trimOuterWhitespace: Bool

    public init(
        sourceHost: String = "",
        targetProfile: String = "",
        wsl: CanonicalPathWSLOptions = CanonicalPathWSLOptions(),
        uri: CanonicalPathURIOptions = CanonicalPathURIOptions(),
        windows: CanonicalPathWindowsOptions = CanonicalPathWindowsOptions(),
        trimOuterWhitespace: Bool = false
    ) {
        self.sourceHost = sourceHost
        self.targetProfile = targetProfile
        self.wsl = wsl
        self.uri = uri
        self.windows = windows
        self.trimOuterWhitespace = trimOuterWhitespace
    }
}

private struct RootParts {
    let prefix: String
    let rest: String
}

private struct CanonicalParts {
    let prefix: String
    let parts: [String]
}

public enum CanonicalPath {
    public static func normalize(_ raw: String) throws -> String {
        try normalize(raw, options: CanonicalPathNormalizeOptions())
    }

    public static func normalize(_ raw: String, options: CanonicalPathNormalizeOptions) throws -> String {
        var value = options.trimOuterWhitespace ? raw.trimmingCharacters(in: .whitespacesAndNewlines) : raw
        if value.isEmpty { throw pathError("ERR_EMPTY_PATH", "path is empty") }
        if hasNul(value) { throw pathError("ERR_NUL_BYTE", "path contains NUL") }

        if hasUriScheme(value) || options.sourceHost == "vscode-file-uri" {
            value = try parseFileUri(value, options: options)
        }
        if hasNul(value) { throw pathError("ERR_NUL_BYTE", "path contains NUL") }
        if !options.windows.preserveExtendedLength {
            value = unwrapWindowsExtendedPrefix(value)
        }
        value = value.replacingOccurrences(of: "\\", with: "/")

        if options.targetProfile != "posix" {
            value = mapWSLDrive(value, options: options.wsl)
        }
        if isUriWindowsDrivePath(value) {
            value = String(value.dropFirst())
        }
        if isDriveRelative(value) {
            throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
        }
        if hasDriveRoot(value) {
            value = lowercaseDriveRoot(value)
        }

        if options.windows.rejectADS && hasWindowsADS(value) {
            throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
        }
        if options.windows.rejectDeviceNames && hasReservedDeviceName(value) {
            throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")
        }

        let cleaned = try cleanCanonical(value)
        try validateTargetProfile(cleaned, options.targetProfile)
        return cleaned
    }

    public static func relative(_ root: String, _ target: String) throws -> String {
        let rootParts = try canonicalParts(root)
        let targetParts = try canonicalParts(target)
        if rootParts.prefix != targetParts.prefix || targetParts.parts.count < rootParts.parts.count {
            throw pathError("ERR_OUTSIDE_ROOT", "target is outside root")
        }
        for index in 0..<rootParts.parts.count {
            if rootParts.parts[index] != targetParts.parts[index] {
                throw pathError("ERR_OUTSIDE_ROOT", "target is outside root")
            }
        }
        if targetParts.parts.count == rootParts.parts.count { return "." }
        return targetParts.parts[rootParts.parts.count...].joined(separator: "/")
    }

    public static func join(_ root: String, _ relativePath: String) throws -> String {
        let cleanRelative = try normalizeRelative(relativePath)
        if hasNul(root) { throw pathError("ERR_NUL_BYTE", "root contains NUL") }
        if cleanRelative == "." { return root }
        if root == "/" || root.hasSuffix("/") { return root + cleanRelative }
        return root + "/" + cleanRelative
    }

    public static func join(parts: String...) throws -> String {
        try joinParts(parts)
    }

    public static func joinParts(_ parts: [String]) throws -> String {
        var result = ""
        for part in parts where !part.isEmpty {
            result = result.isEmpty ? part : try join(result, part)
        }
        if result.isEmpty { throw pathError("ERR_EMPTY_PATH", "join parts are empty") }
        return result
    }

    public static func normalizeRelative(_ raw: String) throws -> String {
        if raw.isEmpty { throw pathError("ERR_EMPTY_PATH", "relative path is empty") }
        if raw == "." { return "." }
        if hasNul(raw) { throw pathError("ERR_NUL_BYTE", "relative path contains NUL") }
        if isAbsolutePathLike(raw) { throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute") }
        if isDriveRelative(raw) { throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed") }
        if raw.contains("\\") { throw pathError("ERR_INVALID_PATH", "relative path must use slash separators") }

        var parts: [String] = []
        for part in splitKeepingEmpty(raw, separator: "/") {
            if part.isEmpty || part == "." { continue }
            if part == ".." {
                if parts.isEmpty { throw pathError("ERR_OUTSIDE_ROOT", "relative path escapes root") }
                parts.removeLast()
                continue
            }
            parts.append(part)
        }
        if parts.isEmpty { throw pathError("ERR_EMPTY_PATH", "relative path is empty after cleaning") }
        return parts.joined(separator: "/")
    }

    public static func isEqual(_ left: String, _ right: String, options: CanonicalPathNormalizeOptions = CanonicalPathNormalizeOptions()) throws -> Bool {
        try normalize(left, options: options) == normalize(right, options: options)
    }

    public static func toWin32(_ canonical: String) throws -> String {
        if hasNul(canonical) { throw pathError("ERR_NUL_BYTE", "path contains NUL") }
        if hasDriveRoot(canonical), let drive = asciiByte(canonical, at: 0) {
            let upperDrive = String(UnicodeScalar(Int(toUpperASCII(drive)))!)
            let rest = String(canonical.dropFirst(3)).replacingOccurrences(of: "/", with: "\\")
            return upperDrive + ":\\" + rest
        }
        if canonical.hasPrefix("//") {
            return "\\\\" + String(canonical.dropFirst(2)).replacingOccurrences(of: "/", with: "\\")
        }
        return canonical.replacingOccurrences(of: "/", with: "\\")
    }

    public static func toWSL(_ canonical: String, options: CanonicalPathWSLOptions = CanonicalPathWSLOptions()) throws -> String {
        if hasNul(canonical) { throw pathError("ERR_NUL_BYTE", "path contains NUL") }
        if !hasDriveRoot(canonical) { return canonical }
        let mountRoot = trimRightSlashes(options.mountRoot.isEmpty ? "/mnt" : options.mountRoot)
        let drive = String(canonical.prefix(1)).lowercased()
        let rest = String(canonical.dropFirst(3))
        if rest.isEmpty { return mountRoot + "/" + drive }
        return mountRoot + "/" + drive + "/" + rest
    }

    public static func toPOSIX(_ canonical: String) throws -> String {
        if hasNul(canonical) { throw pathError("ERR_NUL_BYTE", "path contains NUL") }
        if hasDriveRoot(canonical) {
            throw pathError("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as to_wsl")
        }
        if canonical.contains("\\") { throw pathError("ERR_INVALID_PATH", "canonical paths must use slash separators") }
        return canonical
    }

    public static func sanitizeComponent(_ name: String, profile: String) throws -> String {
        if name.isEmpty { throw pathError("ERR_INVALID_COMPONENT", "component is empty") }
        if hasNul(name) { throw pathError("ERR_NUL_BYTE", "component contains NUL") }
        var value = replaceUnsafeComponentChars(name)
        value = trim(value, characters: Set(" ._-"))
        if value.isEmpty { value = "component" }
        if profile == "win32" { value = escapeReservedWin32Component(value) }
        return value
    }

    public static func encodeComponent(_ name: String, profile: String) throws -> String {
        try sanitizeComponent(name, profile: profile)
    }

    public static func encodeGitRef(_ raw: String) throws -> String {
        if raw.isEmpty { throw pathError("ERR_INVALID_COMPONENT", "git ref is empty") }
        if hasNul(raw) { throw pathError("ERR_NUL_BYTE", "git ref contains NUL") }
        var slug = slugGitRef(raw)
        slug = trim(slug, characters: Set("._-"))
        if slug.isEmpty { slug = "ref" }
        return slug + "--" + String(sha256Hex(Array(raw.utf8)).prefix(12))
    }

    private static func parseFileUri(_ uri: String, options: CanonicalPathNormalizeOptions) throws -> String {
        if hasNul(uri) { throw pathError("ERR_NUL_BYTE", "URI contains NUL") }
        if uri.hasPrefix("file://") {
            if !options.uri.allowFileUri { throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed") }
            return try parseHierarchicalURIPath(uri, prefix: "file://", options: options)
        }
        if uri.hasPrefix("vscode-file://") {
            if !options.uri.allowVSCodeFileUri { throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed") }
            return try parseHierarchicalURIPath(uri, prefix: "vscode-file://", options: options)
        }
        if hasUriScheme(uri) { throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme") }
        return uri
    }

    private static func parseHierarchicalURIPath(_ raw: String, prefix: String, options: CanonicalPathNormalizeOptions) throws -> String {
        let rejectEncodedSlash = options.uri.rejectEncodedSlash ?? true
        if rejectEncodedSlash && hasEncodedSeparator(raw) {
            throw pathError("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator")
        }

        let rest = String(raw.dropFirst(prefix.count))
        guard let slash = rest.firstIndex(of: "/") else {
            throw pathError("ERR_INVALID_URI", "URI path is empty")
        }
        let authority = String(rest[..<slash])
        let pathPart = String(rest[slash...])
        let decodedAuthority = try percentDecode(authority)
        let decodedPath = try percentDecode(pathPart)
        if decodedPath.isEmpty { throw pathError("ERR_INVALID_URI", "URI path is empty") }
        if prefix == "file://" && !decodedAuthority.isEmpty && decodedAuthority.lowercased() != "localhost" {
            return "//" + decodedAuthority + decodedPath
        }
        return decodedPath
    }

    private static func percentDecode(_ value: String) throws -> String {
        let input = Array(value.utf8)
        var output: [UInt8] = []
        var index = 0
        while index < input.count {
            if input[index] != 0x25 {
                output.append(input[index])
                index += 1
                continue
            }
            if index + 2 >= input.count {
                throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
            }
            guard let high = hexValue(input[index + 1]), let low = hexValue(input[index + 2]) else {
                throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
            }
            output.append((high << 4) | low)
            index += 3
        }
        guard let decoded = String(bytes: output, encoding: .utf8) else {
            throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
        }
        return decoded
    }

    private static func hasEncodedSeparator(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        if bytes.count < 3 { return false }
        for index in 0..<(bytes.count - 2) {
            if bytes[index] != 0x25 { continue }
            let high = toLowerASCII(bytes[index + 1])
            let low = toLowerASCII(bytes[index + 2])
            if (high == 0x32 && low == 0x66) || (high == 0x35 && low == 0x63) { return true }
        }
        return false
    }

    private static func unwrapWindowsExtendedPrefix(_ value: String) -> String {
        if value.hasPrefix("\\\\?\\UNC\\") { return "\\\\" + String(value.dropFirst("\\\\?\\UNC\\".count)) }
        if value.hasPrefix("\\\\?\\") { return String(value.dropFirst("\\\\?\\".count)) }
        return value
    }

    private static func mapWSLDrive(_ value: String, options: CanonicalPathWSLOptions) -> String {
        if !options.enabled { return value }
        let mountRoot = trimRightSlashes(options.mountRoot.isEmpty ? "/mnt" : options.mountRoot)
        let prefix = mountRoot + "/"
        if !value.hasPrefix(prefix) { return value }
        let rest = String(value.dropFirst(prefix.count))
        guard let first = rest.utf8.first, isASCIILetter(first) else { return value }
        if rest.utf8.count > 1, asciiByte(rest, at: 1) != 0x2f { return value }
        let drive = String(UnicodeScalar(Int(toLowerASCII(first)))!)
        if rest.utf8.count == 1 { return drive + ":/" }
        return drive + ":/" + String(rest.dropFirst(2))
    }

    private static func cleanCanonical(_ value: String) throws -> String {
        if value.isEmpty { throw pathError("ERR_EMPTY_PATH", "path is empty") }
        let root = try splitRoot(value)
        var parts: [String] = []
        for part in splitKeepingEmpty(root.rest, separator: "/") {
            if part.isEmpty || part == "." { continue }
            if part == ".." {
                if !parts.isEmpty {
                    parts.removeLast()
                    continue
                }
                if !root.prefix.isEmpty { continue }
                throw pathError("ERR_INVALID_PATH", "relative path escapes above its root")
            }
            parts.append(part)
        }

        let joined = parts.joined(separator: "/")
        if root.prefix.isEmpty { return joined.isEmpty ? "." : joined }
        if root.prefix == "/" { return joined.isEmpty ? "/" : "/" + joined }
        if root.prefix.hasSuffix("/") { return joined.isEmpty ? root.prefix : root.prefix + joined }
        return joined.isEmpty ? root.prefix : root.prefix + "/" + joined
    }

    private static func validateTargetProfile(_ value: String, _ targetProfile: String) throws {
        if targetProfile.isEmpty || targetProfile == "portable" { return }
        if targetProfile == "posix" {
            if hasDriveRoot(value) || value.hasPrefix("//") {
                throw pathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots")
            }
            return
        }
        if targetProfile == "win32-drive" {
            if value.hasPrefix("/") {
                throw pathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots")
            }
            return
        }
        throw pathError("ERR_INVALID_PATH", "unsupported targetProfile")
    }

    private static func canonicalParts(_ value: String) throws -> CanonicalParts {
        if hasNul(value) { throw pathError("ERR_NUL_BYTE", "path contains NUL") }
        let root = try splitRoot(value)
        if root.prefix.isEmpty { throw pathError("ERR_INVALID_PATH", "path must be canonical absolute") }
        let parts = splitKeepingEmpty(root.rest, separator: "/").filter { !$0.isEmpty }
        if parts.contains(where: { $0 == "." || $0 == ".." }) {
            throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned")
        }
        return CanonicalParts(prefix: root.prefix, parts: parts)
    }

    private static func splitRoot(_ value: String) throws -> RootParts {
        if hasDriveRoot(value) {
            return RootParts(prefix: String(value.prefix(3)), rest: String(value.dropFirst(3)))
        }
        if value.hasPrefix("//") {
            let rest = String(value.dropFirst(2))
            guard let first = rest.firstIndex(of: "/"), first != rest.startIndex else {
                throw pathError("ERR_INVALID_PATH", "UNC path requires server and share")
            }
            let server = String(rest[..<first])
            let afterFirst = String(rest[rest.index(after: first)...])
            let share: String
            let tail: String
            if let second = afterFirst.firstIndex(of: "/") {
                share = String(afterFirst[..<second])
                tail = String(afterFirst[afterFirst.index(after: second)...])
            } else {
                share = afterFirst
                tail = ""
            }
            if share.isEmpty { throw pathError("ERR_INVALID_PATH", "UNC path requires server and share") }
            return RootParts(prefix: "//" + server + "/" + share, rest: tail)
        }
        if value.hasPrefix("/") { return RootParts(prefix: "/", rest: String(value.dropFirst())) }
        return RootParts(prefix: "", rest: value)
    }

    private static func hasWindowsADS(_ value: String) -> Bool {
        var rest = value
        if hasDriveRoot(value) {
            rest = String(value.dropFirst(3))
        } else if value.hasPrefix("//"), let root = try? splitRoot(value) {
            rest = String(value.dropFirst(root.prefix.count))
        }
        return rest.contains(":")
    }

    private static func hasReservedDeviceName(_ value: String) -> Bool {
        guard let root = try? splitRoot(value) else { return false }
        for part in splitKeepingEmpty(root.rest, separator: "/") {
            if part.isEmpty || part == "." || part == ".." { continue }
            let base = splitComponentBase(part).uppercased()
            if isReservedDeviceBase(base) { return true }
        }
        return false
    }

    private static func splitComponentBase(_ value: String) -> String {
        var end = value.endIndex
        if let dot = value.firstIndex(of: "."), dot < end { end = dot }
        if let colon = value.firstIndex(of: ":"), colon < end { end = colon }
        return String(value[..<end])
    }

    private static func replaceUnsafeComponentChars(_ input: String) -> String {
        var result = ""
        var previousUnsafe = false
        for ch in input {
            if ch == "/" || ch == "\\" || ch == ":" || ch == "\t" || ch == "\n" || ch == "\r" {
                if !previousUnsafe { result.append("-") }
                previousUnsafe = true
            } else {
                result.append(ch)
                previousUnsafe = false
            }
        }
        return result
    }

    private static func escapeReservedWin32Component(_ value: String) -> String {
        let base: String
        let suffix: String
        if let dot = value.firstIndex(of: ".") {
            base = String(value[..<dot])
            suffix = String(value[dot...])
        } else {
            base = value
            suffix = ""
        }
        if isReservedDeviceBase(base.uppercased()) { return base + "-" + suffix }
        return value
    }

    private static func isReservedDeviceBase(_ value: String) -> Bool {
        if value == "CON" || value == "PRN" || value == "AUX" || value == "NUL" { return true }
        if value.count != 4 { return false }
        if !(value.hasPrefix("COM") || value.hasPrefix("LPT")) { return false }
        guard let digit = value.utf8.last else { return false }
        return digit >= 0x31 && digit <= 0x39
    }

    private static func slugGitRef(_ raw: String) -> String {
        var result = ""
        var previousUnsafe = false
        for ch in raw {
            if isGitRefSlugChar(ch) {
                result.append(ch)
                previousUnsafe = false
            } else if !previousUnsafe {
                result.append("-")
                previousUnsafe = true
            }
        }
        return result
    }

    private static func isGitRefSlugChar(_ value: Character) -> Bool {
        guard value.unicodeScalars.count == 1, let scalar = value.unicodeScalars.first else { return false }
        let byte = scalar.value
        return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte == 0x2e || byte == 0x5f || byte == 0x2d
    }

    private static func hasUriScheme(_ value: String) -> Bool {
        guard let range = value.range(of: "://") else { return false }
        let scheme = String(value[..<range.lowerBound])
        if scheme.isEmpty { return false }
        guard let first = scheme.utf8.first, isASCIILetter(first) else { return false }
        for byte in scheme.utf8.dropFirst() {
            if !(isASCIILetter(byte) || (byte >= 0x30 && byte <= 0x39) || byte == 0x2b || byte == 0x2e || byte == 0x2d) {
                return false
            }
        }
        return true
    }

    private static func hasDriveRoot(_ value: String) -> Bool {
        guard value.utf8.count >= 3, let first = asciiByte(value, at: 0), let second = asciiByte(value, at: 1), let third = asciiByte(value, at: 2) else { return false }
        return isASCIILetter(first) && second == 0x3a && third == 0x2f
    }

    private static func isDriveRelative(_ value: String) -> Bool {
        guard value.utf8.count >= 2, let first = asciiByte(value, at: 0), let second = asciiByte(value, at: 1) else { return false }
        let third = asciiByte(value, at: 2)
        return isASCIILetter(first) && second == 0x3a && (third == nil || third != 0x2f)
    }

    private static func isUriWindowsDrivePath(_ value: String) -> Bool {
        guard value.utf8.count >= 4, let first = asciiByte(value, at: 0), let second = asciiByte(value, at: 1), let third = asciiByte(value, at: 2), let fourth = asciiByte(value, at: 3) else { return false }
        return first == 0x2f && isASCIILetter(second) && third == 0x3a && fourth == 0x2f
    }

    private static func isAbsolutePathLike(_ value: String) -> Bool {
        value.hasPrefix("/") || value.hasPrefix("\\\\") || hasDriveRoot(value.replacingOccurrences(of: "\\", with: "/"))
    }

    private static func lowercaseDriveRoot(_ value: String) -> String {
        guard let drive = asciiByte(value, at: 0) else { return value }
        return String(UnicodeScalar(Int(toLowerASCII(drive)))!) + String(value.dropFirst())
    }

    private static func hasNul(_ value: String) -> Bool {
        value.utf8.contains(0)
    }

    private static func isASCIILetter(_ value: UInt8) -> Bool {
        (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a)
    }

    private static func toLowerASCII(_ value: UInt8) -> UInt8 {
        value >= 0x41 && value <= 0x5a ? value + 0x20 : value
    }

    private static func toUpperASCII(_ value: UInt8) -> UInt8 {
        value >= 0x61 && value <= 0x7a ? value - 0x20 : value
    }

    private static func hexValue(_ value: UInt8) -> UInt8? {
        if value >= 0x30 && value <= 0x39 { return value - 0x30 }
        if value >= 0x41 && value <= 0x46 { return value - 0x41 + 10 }
        if value >= 0x61 && value <= 0x66 { return value - 0x61 + 10 }
        return nil
    }

    private static func asciiByte(_ value: String, at offset: Int) -> UInt8? {
        guard offset >= 0 && offset < value.utf8.count else { return nil }
        let index = value.utf8.index(value.utf8.startIndex, offsetBy: offset)
        return value.utf8[index]
    }

    private static func splitKeepingEmpty(_ value: String, separator: Character) -> [String] {
        value.split(separator: separator, omittingEmptySubsequences: false).map(String.init)
    }

    private static func trimRightSlashes(_ value: String) -> String {
        var result = value
        while result.hasSuffix("/") { result.removeLast() }
        return result
    }

    private static func trim(_ value: String, characters: Set<Character>) -> String {
        var start = value.startIndex
        var end = value.endIndex
        while start < end && characters.contains(value[start]) {
            start = value.index(after: start)
        }
        while start < end {
            let beforeEnd = value.index(before: end)
            if !characters.contains(value[beforeEnd]) { break }
            end = beforeEnd
        }
        return String(value[start..<end])
    }

    private static func pathError(_ code: String, _ message: String) -> CanonicalPathError {
        CanonicalPathError(code, message)
    }

    private static func sha256Hex(_ input: [UInt8]) -> String {
        sha256(input).map { String(format: "%02x", $0) }.joined()
    }

    private static func sha256(_ input: [UInt8]) -> [UInt8] {
        let k: [UInt32] = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ]

        var h: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
        var message = input
        let bitLength = UInt64(message.count) * 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        for shift in stride(from: 56, through: 0, by: -8) {
            message.append(UInt8((bitLength >> UInt64(shift)) & 0xff))
        }

        for offset in stride(from: 0, to: message.count, by: 64) {
            var w = [UInt32](repeating: 0, count: 64)
            for index in 0..<16 {
                let base = offset + index * 4
                w[index] = (UInt32(message[base]) << 24) | (UInt32(message[base + 1]) << 16) | (UInt32(message[base + 2]) << 8) | UInt32(message[base + 3])
            }
            for index in 16..<64 {
                let s0 = rotateRight(w[index - 15], by: 7) ^ rotateRight(w[index - 15], by: 18) ^ (w[index - 15] >> 3)
                let s1 = rotateRight(w[index - 2], by: 17) ^ rotateRight(w[index - 2], by: 19) ^ (w[index - 2] >> 10)
                w[index] = w[index - 16] &+ s0 &+ w[index - 7] &+ s1
            }

            var a = h[0]
            var b = h[1]
            var c = h[2]
            var d = h[3]
            var e = h[4]
            var f = h[5]
            var g = h[6]
            var currentH = h[7]

            for index in 0..<64 {
                let s1 = rotateRight(e, by: 6) ^ rotateRight(e, by: 11) ^ rotateRight(e, by: 25)
                let ch = (e & f) ^ ((~e) & g)
                let temp1 = currentH &+ s1 &+ ch &+ k[index] &+ w[index]
                let s0 = rotateRight(a, by: 2) ^ rotateRight(a, by: 13) ^ rotateRight(a, by: 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let temp2 = s0 &+ maj

                currentH = g
                g = f
                f = e
                e = d &+ temp1
                d = c
                c = b
                b = a
                a = temp1 &+ temp2
            }

            h[0] = h[0] &+ a
            h[1] = h[1] &+ b
            h[2] = h[2] &+ c
            h[3] = h[3] &+ d
            h[4] = h[4] &+ e
            h[5] = h[5] &+ f
            h[6] = h[6] &+ g
            h[7] = h[7] &+ currentH
        }

        var output: [UInt8] = []
        for word in h {
            output.append(UInt8((word >> 24) & 0xff))
            output.append(UInt8((word >> 16) & 0xff))
            output.append(UInt8((word >> 8) & 0xff))
            output.append(UInt8(word & 0xff))
        }
        return output
    }

    private static func rotateRight(_ value: UInt32, by bits: UInt32) -> UInt32 {
        (value >> bits) | (value << (32 - bits))
    }
}
