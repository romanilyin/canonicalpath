package com.canonicalpath

import java.nio.ByteBuffer
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

        if (hasUriScheme(value) || options.sourceHost == "vscode-file-uri") {
            value = parseFileUri(value, options)
        }
        if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        if (!options.windows.preserveExtendedLength) value = unwrapWindowsExtendedPrefix(value)
        value = value.replace('\\', '/')

        if (options.targetProfile != "posix") value = mapWSLDrive(value, options.wsl)
        if (isUriWindowsDrivePath(value)) value = value.substring(1)
        if (isDriveRelative(value)) {
            throw pathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
        }
        if (hasDriveRoot(value)) value = lowercaseDriveRoot(value)

        if (options.windows.rejectADS && hasWindowsADS(value)) {
            throw pathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
        }
        if (options.windows.rejectDeviceNames && hasReservedDeviceName(value)) {
            throw pathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")
        }

        val cleaned = cleanCanonical(value)
        validateTargetProfile(cleaned, options.targetProfile)
        return cleaned
    }

    @JvmStatic
    fun relative(root: String, target: String): String {
        val rootParts = canonicalParts(root)
        val targetParts = canonicalParts(target)
        if (rootParts.prefix != targetParts.prefix || targetParts.parts.size < rootParts.parts.size) {
            throw pathError("ERR_OUTSIDE_ROOT", "target is outside root")
        }
        for (index in rootParts.parts.indices) {
            if (rootParts.parts[index] != targetParts.parts[index]) {
                throw pathError("ERR_OUTSIDE_ROOT", "target is outside root")
            }
        }
        if (targetParts.parts.size == rootParts.parts.size) return "."
        return targetParts.parts.drop(rootParts.parts.size).joinToString("/")
    }

    @JvmStatic
    fun join(root: String, relativePath: String): String {
        val cleanRelative = normalizeRelative(relativePath)
        if (hasNul(root)) throw pathError("ERR_NUL_BYTE", "root contains NUL")
        if (cleanRelative == ".") return root
        if (root == "/" || root.endsWith("/")) return root + cleanRelative
        return "$root/$cleanRelative"
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
        if (hasNul(canonical)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        if (hasDriveRoot(canonical)) {
            return "${uppercaseASCII(canonical[0])}:\\${canonical.substring(3).replace('/', '\\')}"
        }
        if (canonical.startsWith("//")) return "\\\\" + canonical.substring(2).replace('/', '\\')
        return canonical.replace('/', '\\')
    }

    @JvmStatic
    fun toWSL(canonical: String, options: CanonicalPathWSLOptions = CanonicalPathWSLOptions()): String {
        if (hasNul(canonical)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        if (!hasDriveRoot(canonical)) return canonical
        val mountRoot = trimRightSlashes(options.mountRoot.ifEmpty { "/mnt" })
        val rest = canonical.substring(3)
        return if (rest.isEmpty()) {
            "$mountRoot/${lowercaseASCII(canonical[0])}"
        } else {
            "$mountRoot/${lowercaseASCII(canonical[0])}/$rest"
        }
    }

    @JvmStatic
    fun toPOSIX(canonical: String): String {
        if (hasNul(canonical)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        if (hasDriveRoot(canonical)) {
            throw pathError("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as to_wsl")
        }
        if (canonical.contains('\\')) throw pathError("ERR_INVALID_PATH", "canonical paths must use slash separators")
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
        var slug = slugGitRef(raw)
        slug = trimComponentEdges(slug)
        if (slug.isEmpty()) slug = "ref"
        return "$slug--${sha256Hex(raw).substring(0, 12)}"
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
        if (value.startsWith("\\\\?\\UNC\\")) return "\\\\" + value.substring("\\\\?\\UNC\\".length)
        if (value.startsWith("\\\\?\\")) return value.substring("\\\\?\\".length)
        return value
    }

    private fun mapWSLDrive(value: String, options: CanonicalPathWSLOptions): String {
        if (!options.enabled) return value
        val mountRoot = trimRightSlashes(options.mountRoot.ifEmpty { "/mnt" })
        val prefix = "$mountRoot/"
        if (!value.startsWith(prefix)) return value
        val rest = value.substring(prefix.length)
        if (rest.isEmpty() || !isASCIILetter(rest[0])) return value
        if (rest.length > 1 && rest[1] != '/') return value
        val drive = lowercaseASCII(rest[0])
        if (rest.length == 1) return "$drive:/"
        return "$drive:/${rest.substring(2)}"
    }

    private fun cleanCanonical(value: String): String {
        if (value.isEmpty()) throw pathError("ERR_EMPTY_PATH", "path is empty")
        val root = splitRoot(value)
        val parts = mutableListOf<String>()
        for (part in root.rest.split('/')) {
            if (part.isEmpty() || part == ".") continue
            if (part == "..") {
                if (parts.isNotEmpty()) {
                    parts.removeAt(parts.lastIndex)
                    continue
                }
                if (root.prefix.isNotEmpty()) continue
                throw pathError("ERR_INVALID_PATH", "relative path escapes above its root")
            }
            parts.add(part)
        }

        val joined = parts.joinToString("/")
        if (root.prefix.isEmpty()) return if (joined.isEmpty()) "." else joined
        if (root.prefix == "/") return if (joined.isEmpty()) "/" else "/$joined"
        if (root.prefix.endsWith("/")) return if (joined.isEmpty()) root.prefix else root.prefix + joined
        return if (joined.isEmpty()) root.prefix else "${root.prefix}/$joined"
    }

    private fun validateTargetProfile(value: String, targetProfile: String) {
        if (targetProfile.isEmpty() || targetProfile == "portable") return
        if (targetProfile == "posix") {
            if (hasDriveRoot(value) || value.startsWith("//")) {
                throw pathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots")
            }
            return
        }
        if (targetProfile == "win32-drive") {
            if (value.startsWith("/")) {
                throw pathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots")
            }
            return
        }
        throw pathError("ERR_INVALID_PATH", "unsupported targetProfile")
    }

    private fun canonicalParts(value: String): CanonicalParts {
        if (hasNul(value)) throw pathError("ERR_NUL_BYTE", "path contains NUL")
        val root = splitRoot(value)
        if (root.prefix.isEmpty()) throw pathError("ERR_INVALID_PATH", "path must be canonical absolute")
        val parts = root.rest.split('/').filter { it.isNotEmpty() }
        if (parts.any { it == "." || it == ".." }) {
            throw pathError("ERR_INVALID_PATH", "path is not lexically cleaned")
        }
        return CanonicalParts(root.prefix, parts)
    }

    private fun splitRoot(value: String): RootParts {
        if (hasDriveRoot(value)) return RootParts(value.substring(0, 3), value.substring(3))
        if (value.startsWith("//")) {
            val rest = value.substring(2)
            val first = rest.indexOf('/')
            if (first <= 0) throw pathError("ERR_INVALID_PATH", "UNC path requires server and share")
            val server = rest.substring(0, first)
            val afterFirst = rest.substring(first + 1)
            val second = afterFirst.indexOf('/')
            val share = if (second >= 0) afterFirst.substring(0, second) else afterFirst
            val tail = if (second >= 0) afterFirst.substring(second + 1) else ""
            if (share.isEmpty()) throw pathError("ERR_INVALID_PATH", "UNC path requires server and share")
            return RootParts("//$server/$share", tail)
        }
        if (value.startsWith("/")) return RootParts("/", value.substring(1))
        return RootParts("", value)
    }

    private fun hasWindowsADS(value: String): Boolean {
        val start = if (hasDriveRoot(value)) {
            3
        } else if (value.startsWith("//")) {
            try {
                splitRoot(value).prefix.length
            } catch (ignored: CanonicalPathException) {
                0
            }
        } else {
            0
        }
        return value.substring(start).contains(':')
    }

    private fun hasReservedDeviceName(value: String): Boolean {
        val root = try {
            splitRoot(value)
        } catch (ignored: CanonicalPathException) {
            return false
        }
        for (part in root.rest.split('/')) {
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
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(StandardCharsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
