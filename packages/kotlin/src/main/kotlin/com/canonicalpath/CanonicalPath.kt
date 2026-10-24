package com.canonicalpath

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

class CanonicalPathException(val code: String, message: String) : IllegalArgumentException(message) {
    override fun toString(): String = "$code: ${message ?: ""}"
}

data class CanonicalPathWSLOptions(
    var enabled: Boolean = false,
    var mountRoot: String = "/mnt",
)

data class CanonicalPathURIOptions(
    var allowFileUri: Boolean = false,
    var allowVSCodeFileUri: Boolean = false,
    var rejectEncodedSlash: Boolean? = null,
)

data class CanonicalPathWindowsOptions(
    var preserveExtendedLength: Boolean = false,
    var rejectDeviceNames: Boolean = false,
    var rejectADS: Boolean = false,
)

data class CanonicalPathNormalizeOptions(
    var sourceHost: String = "",
    var targetProfile: String = "",
    var wsl: CanonicalPathWSLOptions = CanonicalPathWSLOptions(),
    var uri: CanonicalPathURIOptions = CanonicalPathURIOptions(),
    var windows: CanonicalPathWindowsOptions = CanonicalPathWindowsOptions(),
    var trimOuterWhitespace: Boolean = false,
)

private data class RootParts(val prefix: String, val rest: String)

private data class CanonicalParts(val prefix: String, val parts: List<String>)

object CanonicalPath {
    @JvmStatic
    fun normalize(raw: String): String = normalize(raw, CanonicalPathNormalizeOptions())

    @JvmStatic
    fun normalize(raw: String, options: CanonicalPathNormalizeOptions): String {
        var value = if (options.trimOuterWhitespace) raw.trim() else raw
        if (value.isEmpty()) throw pathError("ERR_EMPTY_PATH", "path is empty")
        if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        val mount = normalizeMountRoot(options.wsl.mountRoot)
        val cleaned = when (options.sourceHost) {
            "posix" -> {
                if (options.wsl.enabled) throw pathError("ERR_INVALID_PATH", "native POSIX input does not allow WSL mapping")
                checkWindowsPolicy(value, options, nativePOSIX = true)
                cleanPOSIX(value)
            }
            "canonical" -> {
                if (isDriveRelative(value)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
                checkWindowsPolicy(value, options)
                cleanCanonical(value)
            }
            else -> {
                val parsedURI = hasUriScheme(value)
                if (parsedURI || options.sourceHost == "vscode-file-uri") value = parseFileUri(value, options)
                val uriDrive = parsedURI && isUriWindowsDrivePath(value)
                val posixCandidate = value.startsWith("/") && (!value.startsWith("//") || value.startsWith("///"))
                if (options.wsl.enabled && posixCandidate && !uriDrive) {
                    checkWindowsPolicy(value, options)
                    val posix = cleanPOSIX(value)
                    if (options.targetProfile == "posix") posix else mapWSLDrive(posix, mount)
                } else {
                    value = value.replace('\\', '/')
                    if (value.startsWith("//?/")) {
                        splitRoot(value)
                        if (!options.windows.preserveExtendedLength) value = unwrapWindowsExtendedPrefix(value)
                    }
                    if (isUriWindowsDrivePath(value)) value = value.substring(1)
                    if (isDriveRelative(value)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
                    checkWindowsPolicy(value, options)
                    cleanCanonical(value)
                }
            }
        }
        validateTargetProfile(cleaned, options.targetProfile)
        return cleaned
    }

    @JvmStatic
    fun relative(root: String, target: String): String {
        val a = canonicalParts(root)
        val b = canonicalParts(target)
        if (a.prefix != b.prefix || b.parts.size < a.parts.size) throw pathError("ERR_OUTSIDE_ROOT", "target is outside root")
        for (index in a.parts.indices) {
            if (a.parts[index] != b.parts[index]) throw pathError("ERR_OUTSIDE_ROOT", "target is outside root")
        }
        return serialize("", b.parts.drop(a.parts.size))
    }

    @JvmStatic
    fun join(root: String, relativePath: String): String {
        val parsed = validatedCanonical(root)
        if (relativePath.isEmpty()) throw pathError("ERR_EMPTY_PATH", "relative path is empty")
        if (hasNul(relativePath)) throw pathError("ERR_NUL_BYTE", "relative path contains NUL")
        if (relativePath.startsWith("/") || hasDriveRoot(relativePath)) throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute")
        if (isDriveRelative(relativePath)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed")
        if (parsed.prefix.isNotEmpty() && parsed.prefix != "/" && relativePath.contains('\\')) throw pathError("ERR_INVALID_PATH", "relative data is not representable under a Windows root")
        return serialize(parsed.prefix, parsed.parts + cleanParts("", relativePath, "ERR_OUTSIDE_ROOT"))
    }

    @JvmStatic
    fun join(vararg parts: String): String {
        return joinParts(parts.asList())
    }

    @JvmStatic
    fun joinParts(parts: List<String>): String {
        var result = ""
        for (part in parts) {
            if (part.isEmpty()) continue
            result = if (result.isEmpty()) part else join(result, part)
        }
        if (result.isEmpty()) throw pathError("ERR_EMPTY_PATH", "join parts are empty")
        return result
    }

    @JvmStatic
    fun normalizeRelative(raw: String): String {
        if (raw.isEmpty()) throw pathError("ERR_EMPTY_PATH", "relative path is empty")
        if (raw == ".") return "."
        if (hasNul(raw)) throw pathError("ERR_NUL_BYTE", "relative path contains NUL")
        if (isAbsolutePathLike(raw)) throw pathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute")
        if (isDriveRelative(raw)) throw pathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed")
        if (raw.contains('\\')) throw pathError("ERR_INVALID_PATH", "relative path must use slash separators")

        val parts = mutableListOf<String>()
        for (part in raw.split('/')) {
            if (part.isEmpty() || part == ".") continue
            if (part == "..") {
                if (parts.isEmpty()) throw pathError("ERR_OUTSIDE_ROOT", "relative path escapes root")
                parts.removeAt(parts.lastIndex)
                continue
            }
            parts.add(part)
        }
        if (parts.isEmpty()) throw pathError("ERR_EMPTY_PATH", "relative path is empty after cleaning")
        return parts.joinToString("/")
    }

    @JvmStatic
    fun isEqual(left: String, right: String, options: CanonicalPathNormalizeOptions = CanonicalPathNormalizeOptions()): Boolean {
        return normalize(left, options) == normalize(right, options)
    }

    @JvmStatic
    fun toWin32(canonical: String): String {
        val parsed = validatedCanonical(canonical)
        if (parsed.prefix == "/" || (parsed.prefix.isEmpty() && (canonical.contains('\\') || isMarkedRelative(canonical)))) throw pathError("ERR_INVALID_PATH", "canonical path has no lossless Windows representation")
        var value = serialize(parsed.prefix, parsed.parts)
        if (parsed.prefix.startsWith("//?/") && hasDriveRoot(parsed.prefix.substring(4))) {
            value = "//?/" + uppercaseASCII(value[4]) + value.substring(5)
        } else if (hasDriveRoot(parsed.prefix)) {
            value = uppercaseASCII(value[0]) + value.substring(1)
        }
        return value.replace('/', '\\')
    }

    @JvmStatic
    fun toWSL(canonical: String, options: CanonicalPathWSLOptions = CanonicalPathWSLOptions()): String {
        val mount = normalizeMountRoot(options.mountRoot)
        val parsed = validatedCanonical(canonical)
        if (parsed.prefix.startsWith("//")) throw pathError("ERR_INVALID_PATH", "UNC and preserved extended roots require an explicit host mapping")
        if (!hasDriveRoot(parsed.prefix)) return canonical
        val mountPrefix = if (mount == "/") "" else mount
        val tail = if (parsed.parts.isEmpty()) "" else "/" + parsed.parts.joinToString("/")
        return "$mountPrefix/${parsed.prefix[0]}$tail"
    }

    @JvmStatic
    fun toPOSIX(canonical: String): String {
        val parsed = validatedCanonical(canonical)
        if (parsed.prefix.isNotEmpty() && parsed.prefix != "/") throw pathError("ERR_INVALID_PATH", "Windows roots require an explicit host mapping")
        return canonical
    }

    @JvmStatic
    fun sanitizeComponent(name: String, profile: String): String {
        if (name.isEmpty()) throw pathError("ERR_INVALID_COMPONENT", "component is empty")
        if (hasNul(name)) throw pathError("ERR_NUL_BYTE", "component contains NUL")
        var value = replaceUnsafeComponentChars(name)
        value = trimComponentEdges(value)
        if (value.isEmpty()) value = "component"
        if (profile == "win32") value = escapeReservedWin32Component(value)
        return value
    }

    @JvmStatic
    fun encodeComponent(name: String, profile: String): String = sanitizeComponent(name, profile)

    @JvmStatic
    fun encodeGitRef(raw: String): String {
        if (raw.isEmpty()) throw pathError("ERR_INVALID_COMPONENT", "git ref is empty")
        if (hasNul(raw)) throw pathError("ERR_NUL_BYTE", "git ref contains NUL")
        val hash = sha256Hex(raw)
        var slug = slugGitRef(raw)
        slug = trimComponentEdges(trimComponentEdges(slug).take(80))
        if (slug.isEmpty()) slug = "ref"
        return "v2-$slug--$hash"
    }

    private fun parseFileUri(uri: String, options: CanonicalPathNormalizeOptions): String {
        if (hasNul(uri)) throw pathError("ERR_NUL_BYTE", "URI contains NUL")
        if (uri.startsWith("file://")) {
            if (!options.uri.allowFileUri) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed")
            return parseHierarchicalURIPath(uri, "file://", options)
        }
        if (uri.startsWith("vscode-file://")) {
            if (!options.uri.allowVSCodeFileUri) {
                throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed")
            }
            return parseHierarchicalURIPath(uri, "vscode-file://", options)
        }
        if (hasUriScheme(uri)) throw pathError("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme")
        return uri
    }

    private fun parseHierarchicalURIPath(raw: String, prefix: String, options: CanonicalPathNormalizeOptions): String {
        val rejectEncodedSlash = options.uri.rejectEncodedSlash ?: true
        if (rejectEncodedSlash && hasEncodedSeparator(raw)) {
            throw pathError("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator")
        }

        val rest = raw.substring(prefix.length)
        val slash = rest.indexOf('/')
        if (slash < 0) throw pathError("ERR_INVALID_URI", "URI path is empty")
        val decodedAuthority = percentDecode(rest.substring(0, slash))
        val decodedPath = percentDecode(rest.substring(slash))
        if (hasNul(decodedPath) || hasNul(decodedAuthority)) throw pathError("ERR_NUL_BYTE", "decoded URI contains NUL")
        if (decodedPath.isEmpty()) throw pathError("ERR_INVALID_URI", "URI path is empty")
        if (prefix == "file://" && decodedAuthority.isNotEmpty() && lowerASCII(decodedAuthority) != "localhost") {
            return "//$decodedAuthority$decodedPath"
        }
        return decodedPath
    }

    private fun percentDecode(value: String): String {
        val bytes = ArrayList<Byte>(value.length)
        var index = 0
        while (index < value.length) {
            if (value[index] != '%') {
                val codePoint = value.codePointAt(index)
                if (codePoint in 0xD800..0xDFFF) {
                    throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI contains malformed UTF-16")
                }
                val encoded = String(Character.toChars(codePoint)).toByteArray(StandardCharsets.UTF_8)
                for (byte in encoded) bytes.add(byte)
                index += Character.charCount(codePoint)
                continue
            }
            if (index + 2 >= value.length) {
                throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
            }
            val high = hexValue(value[index + 1])
                ?: throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
            val low = hexValue(value[index + 2])
                ?: throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
            bytes.add(((high shl 4) or low).toByte())
            index += 3
        }

        return try {
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            decoder.decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (ignored: Exception) {
            throw pathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
        }
    }

    private fun hasEncodedSeparator(value: String): Boolean {
        for (index in 0..value.length - 3) {
            if (value[index] != '%') continue
            val high = lowercaseASCII(value[index + 1])
            val low = lowercaseASCII(value[index + 2])
            if ((high == '2' && low == 'f') || (high == '5' && low == 'c')) return true
        }
        return false
    }

    private fun unwrapWindowsExtendedPrefix(value: String): String {
        if (value.startsWith("//?/UNC/")) return "//" + value.substring(8)
        if (value.startsWith("//?/")) return value.substring(4)
        return value
    }

    private fun mapWSLDrive(value: String, mountRoot: String): String {
        val prefix = if (mountRoot == "/") "/" else "$mountRoot/"
        if (!value.startsWith(prefix)) return value
        val rest = value.substring(prefix.length)
        if (rest.isEmpty() || !isASCIILetter(rest[0]) || (rest.length > 1 && rest[1] != '/')) return value
        val tail = if (rest.length > 1) rest.substring(2) else ""
        if (tail.contains('\\')) throw pathError("ERR_INVALID_PATH", "literal backslash cannot be mapped to a Windows component")
        return "${lowercaseASCII(rest[0])}:/$tail"
    }

    private fun cleanCanonical(value: String): String {
        if (value.isEmpty()) throw pathError("ERR_EMPTY_PATH", "path is empty")
        val root = splitRoot(value)
        return serialize(root.prefix, cleanParts(root.prefix, root.rest))
    }

    private fun validateTargetProfile(value: String, targetProfile: String) {
        val prefix = splitRoot(value).prefix
        if (targetProfile.isEmpty() || targetProfile == "portable") return
        val drive = hasDriveRoot(prefix) || (prefix.startsWith("//?/") && hasDriveRoot(prefix.substring(4)))
        if (targetProfile == "posix" && (prefix.isEmpty() || prefix == "/")) return
        if (targetProfile == "win32-drive" && (prefix.isEmpty() || drive)) return
        throw pathError("ERR_INVALID_PATH", "path root is not allowed by targetProfile")
    }

    private fun canonicalParts(value: String): CanonicalParts {
        val parsed = validatedCanonical(value)
        if (parsed.prefix.isEmpty()) throw pathError("ERR_INVALID_PATH", "path must be canonical absolute")
        return parsed
    }

    private fun splitRoot(value: String): RootParts {
        if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        val root: RootParts
        if (value.startsWith("//?/")) {
            val inner = value.substring(4)
            root = if (hasDriveRoot(inner)) {
                RootParts("//?/" + lowercaseASCII(inner[0]) + inner.substring(1, 3), inner.substring(3))
            } else if (inner.startsWith("UNC/")) {
                val unc = splitUNC(inner.substring(4))
                RootParts("//?/UNC/${unc.prefix}", unc.rest)
            } else {
                throw pathError("ERR_INVALID_PATH", "unsupported extended Windows root")
            }
        } else if (hasDriveRoot(value)) {
            root = RootParts(lowercaseASCII(value[0]) + value.substring(1, 3), value.substring(3))
        } else if (isDriveRelative(value)) {
            throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
        } else if (value.startsWith("///")) {
            return RootParts("/", value.trimStart('/'))
        } else if (value.startsWith("//")) {
            val unc = splitUNC(value.substring(2))
            root = RootParts("//${unc.prefix}", unc.rest)
        } else if (value.startsWith("/")) {
            return RootParts("/", value.substring(1))
        } else {
            return RootParts("", value)
        }
        if (value.contains('\\')) throw pathError("ERR_INVALID_PATH", "Windows canonical components cannot contain backslash")
        return root
    }

    private fun hasWindowsADS(value: String): Boolean {
        val parsed = try { splitRoot(value) } catch (_: CanonicalPathException) { return value.contains(':') }
        return (if (parsed.prefix.isNotEmpty() && parsed.prefix != "/") parsed.rest else value).contains(':')
    }

    private fun hasReservedDeviceName(value: String, nativePOSIX: Boolean = false): Boolean {
        val rest = try {
            if (nativePOSIX) value else splitRoot(value).rest
        } catch (ignored: CanonicalPathException) {
            return false
        }
        for (part in rest.split('/')) {
            if (part.isEmpty() || part == "." || part == "..") continue
            val splitAt = part.indexOfAny(charArrayOf('.', ':'))
            val base = if (splitAt >= 0) part.substring(0, splitAt) else part
            if (isReservedDeviceBase(base)) return true
        }
        return false
    }

    private fun replaceUnsafeComponentChars(input: String): String {
        val result = StringBuilder(input.length)
        var previousUnsafe = false
        for (ch in input) {
            val unsafe = ch == '/' || ch == '\\' || ch == ':' || ch == '\t' || ch == '\n' || ch == '\r'
            if (unsafe) {
                if (!previousUnsafe) result.append('-')
                previousUnsafe = true
            } else {
                result.append(ch)
                previousUnsafe = false
            }
        }
        return result.toString()
    }

    private fun escapeReservedWin32Component(value: String): String {
        val dot = value.indexOf('.')
        val base = if (dot >= 0) value.substring(0, dot) else value
        val suffix = if (dot >= 0) value.substring(dot) else ""
        if (isReservedDeviceBase(base)) return "$base-$suffix"
        return value
    }

    private fun isReservedDeviceBase(value: String): Boolean {
        val upper = value.uppercase()
        if (upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL") return true
        if (upper.length != 4) return false
        if (!(upper.startsWith("COM") || upper.startsWith("LPT"))) return false
        val digit = upper[3]
        return digit in '1'..'9'
    }

    private fun slugGitRef(raw: String): String {
        val result = StringBuilder(raw.length)
        var previousUnsafe = false
        for (ch in raw) {
            if (isGitRefSlugChar(ch)) {
                result.append(ch)
                previousUnsafe = false
            } else if (!previousUnsafe) {
                result.append('-')
                previousUnsafe = true
            }
        }
        return result.toString()
    }

    private fun isGitRefSlugChar(value: Char): Boolean {
        return value in 'A'..'Z' || value in 'a'..'z' || value in '0'..'9' || value == '.' || value == '_' || value == '-'
    }

    private fun hasUriScheme(value: String): Boolean {
        val index = value.indexOf("://")
        if (index <= 0) return false
        if (!isASCIILetter(value[0])) return false
        for (position in 1 until index) {
            val ch = value[position]
            if (!(isASCIILetter(ch) || ch in '0'..'9' || ch == '+' || ch == '.' || ch == '-')) return false
        }
        return true
    }

    private fun hasDriveRoot(value: String): Boolean {
        return value.length >= 3 && isASCIILetter(value[0]) && value[1] == ':' && value[2] == '/'
    }

    private fun isDriveRelative(value: String): Boolean {
        return value.length >= 2 && isASCIILetter(value[0]) && value[1] == ':' && (value.length == 2 || value[2] != '/')
    }

    private fun isUriWindowsDrivePath(value: String): Boolean {
        return value.length >= 4 && value[0] == '/' && isASCIILetter(value[1]) && value[2] == ':' && value[3] == '/'
    }

    private fun isAbsolutePathLike(value: String): Boolean {
        return value.startsWith("/") || value.startsWith("\\\\") || hasDriveRoot(value.replace('\\', '/'))
    }

    private fun lowercaseDriveRoot(value: String): String = lowercaseASCII(value[0]) + value.substring(1)

    private fun hasNul(value: String): Boolean = value.indexOf('\u0000') >= 0

    private fun isASCIILetter(value: Char): Boolean = value in 'A'..'Z' || value in 'a'..'z'

    private fun lowercaseASCII(value: Char): Char = if (value in 'A'..'Z') value + 32 else value

    private fun uppercaseASCII(value: Char): Char = if (value in 'a'..'z') value - 32 else value

    private fun lowerASCII(value: String): String = value.map { lowercaseASCII(it) }.joinToString("")

    private fun hexValue(value: Char): Int? {
        if (value in '0'..'9') return value - '0'
        if (value in 'A'..'F') return value - 'A' + 10
        if (value in 'a'..'f') return value - 'a' + 10
        return null
    }

    private fun trimRightSlashes(value: String): String {
        var result = value
        while (result.endsWith("/")) result = result.dropLast(1)
        return result
    }

    private fun trimComponentEdges(value: String): String {
        var start = 0
        var end = value.length
        while (start < end && isComponentEdgeChar(value[start])) start++
        while (start < end && isComponentEdgeChar(value[end - 1])) end--
        return value.substring(start, end)
    }

    private fun isComponentEdgeChar(value: Char): Boolean = value == ' ' || value == '.' || value == '_' || value == '-'

    private fun pathError(code: String, message: String): CanonicalPathException = CanonicalPathException(code, message)

    private fun sha256Hex(input: String): String {
        val bytes = try {
            StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(input))
        } catch (_: CharacterCodingException) { throw pathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode") }
        val sha = MessageDigest.getInstance("SHA-256")
        sha.update(bytes)
        val digest = sha.digest()
        return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun driveComponent(value: String): Boolean = value.length >= 2 && isASCIILetter(value[0]) && value[1] == ':'
    private fun isMarkedRelative(value: String): Boolean = value.startsWith("./") && driveComponent(value.substring(2))

    private fun splitUNC(value: String): RootParts {
        val parts = value.split('/', limit = 3)
        if (parts.size < 2 || parts.take(2).any { it.isEmpty() || it == "." || it == ".." }) throw pathError("ERR_INVALID_PATH", "UNC path requires a valid server and share")
        return RootParts(parts[0] + "/" + parts[1], if (parts.size == 3) parts[2] else "")
    }

    private fun serialize(prefix: String, parts: List<String>): String {
        val joined = parts.joinToString("/")
        if (prefix.isEmpty()) {
            if (parts.isEmpty()) return "."
            return (if (driveComponent(parts[0])) "./" else "") + joined
        }
        if (joined.isEmpty()) return prefix
        return prefix + (if (prefix.endsWith("/")) "" else "/") + joined
    }

    private fun cleanParts(prefix: String, rest: String, escapeCode: String = "ERR_INVALID_PATH"): List<String> {
        val parts = mutableListOf<String>()
        for (part in rest.split('/')) {
            if (part.isEmpty() || part == ".") continue
            if (part == "..") {
                if (parts.isNotEmpty()) parts.removeAt(parts.lastIndex)
                else if (prefix.isEmpty()) throw pathError(escapeCode, "relative path escapes above its root")
            } else parts.add(part)
        }
        return parts
    }

    private fun cleanPOSIX(value: String): String {
        if (value.startsWith("//") && !value.startsWith("///")) throw pathError("ERR_INVALID_PATH", "double-leading-slash POSIX roots are unsupported")
        val prefix = if (value.startsWith("/")) "/" else ""
        return serialize(prefix, cleanParts(prefix, value))
    }

    private fun normalizeMountRoot(raw: String): String {
        val value = raw.ifEmpty { "/mnt" }
        if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "mount root contains NUL")
        if (!value.startsWith("/")) throw pathError("ERR_INVALID_PATH", "mount root must be absolute POSIX")
        return cleanPOSIX(value)
    }

    private fun validatedCanonical(value: String): CanonicalParts {
        if (value.isEmpty()) throw pathError("ERR_EMPTY_PATH", "path is empty")
        val root = splitRoot(value)
        if (root.prefix.isEmpty() && value == ".") return CanonicalParts("", emptyList())
        val rest = if (root.prefix.isEmpty() && isMarkedRelative(root.rest)) root.rest.substring(2) else root.rest
        val parts = if (rest.isEmpty()) emptyList() else rest.split('/')
        if (parts.any { it.isEmpty() || it == "." || it == ".." }) throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned")
        return CanonicalParts(root.prefix, parts)
    }

    private fun checkWindowsPolicy(value: String, options: CanonicalPathNormalizeOptions, nativePOSIX: Boolean = false) {
        if (options.windows.rejectADS && (if (nativePOSIX) value.contains(':') else hasWindowsADS(value))) throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
        if (options.windows.rejectDeviceNames && hasReservedDeviceName(value, nativePOSIX)) throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")
    }

}
