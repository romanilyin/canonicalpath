class_name CanonicalPath

static func normalize(raw: String, options: Dictionary = {}) -> String:
    return normalize_result(raw, options).get("value", "")


static func relative(root: String, target: String) -> String:
    return relative_result(root, target).get("value", "")


static func join(root: String, relative_path: String) -> String:
    return join_result(root, relative_path).get("value", "")


static func normalize_result(raw: String, options: Dictionary = {}) -> Dictionary:
    var value := raw.strip_edges() if _option_bool(options, "trimOuterWhitespace", false) else raw
    if value.is_empty():
        return _err("ERR_EMPTY_PATH", "path is empty")
    if _has_nul(value):
        return _err("ERR_NUL_BYTE", "path contains NUL")

    if _has_uri_scheme(value) or str(options.get("sourceHost", "")) == "vscode-file-uri":
        var parsed := _parse_file_uri(value, options)
        if not parsed.ok:
            return parsed
        value = parsed.value
    if _has_nul(value):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    if not _option_bool(_nested(options, "windows"), "preserveExtendedLength", false):
        value = _unwrap_windows_extended_prefix(value)
    value = value.replace("\\", "/")

    var target_profile := str(options.get("targetProfile", ""))
    if target_profile != "posix":
        value = _map_wsl_drive(value, _nested(options, "wsl"))
    if _is_uri_windows_drive_path(value):
        value = value.substr(1)
    if _is_drive_relative(value):
        return _err("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
    if _has_drive_root(value):
        value = _lowercase_drive_root(value)

    var windows := _nested(options, "windows")
    if _option_bool(windows, "rejectADS", false) and _has_windows_ads(value):
        return _err("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
    if _option_bool(windows, "rejectDeviceNames", false) and _has_reserved_device_name(value):
        return _err("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")

    var cleaned := _clean_canonical(value)
    if not cleaned.ok:
        return cleaned
    var profile_result := _validate_target_profile(cleaned.value, target_profile)
    if not profile_result.ok:
        return profile_result
    return _ok(cleaned.value)


static func relative_result(root: String, target: String) -> Dictionary:
    var root_parts := _canonical_parts(root)
    if not root_parts.ok:
        return root_parts
    var target_parts := _canonical_parts(target)
    if not target_parts.ok:
        return target_parts
    if root_parts.prefix != target_parts.prefix or target_parts.parts.size() < root_parts.parts.size():
        return _err("ERR_OUTSIDE_ROOT", "target is outside root")
    for index in range(root_parts.parts.size()):
        if root_parts.parts[index] != target_parts.parts[index]:
            return _err("ERR_OUTSIDE_ROOT", "target is outside root")
    if target_parts.parts.size() == root_parts.parts.size():
        return _ok(".")
    return _ok(_join_strings(target_parts.parts.slice(root_parts.parts.size()), "/"))


static func join_result(root: String, relative_path: String) -> Dictionary:
    var clean_relative := normalize_relative_result(relative_path)
    if not clean_relative.ok:
        return clean_relative
    if _has_nul(root):
        return _err("ERR_NUL_BYTE", "root contains NUL")
    if clean_relative.value == ".":
        return _ok(root)
    if root == "/" or root.ends_with("/"):
        return _ok(root + clean_relative.value)
    return _ok(root + "/" + clean_relative.value)


static func normalize_relative_result(raw: String) -> Dictionary:
    if raw.is_empty():
        return _err("ERR_EMPTY_PATH", "relative path is empty")
    if raw == ".":
        return _ok(".")
    if _has_nul(raw):
        return _err("ERR_NUL_BYTE", "relative path contains NUL")
    if _is_absolute_path_like(raw):
        return _err("ERR_ABSOLUTE_PATH", "relative path must not be absolute")
    if _is_drive_relative(raw):
        return _err("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed")
    if raw.contains("\\"):
        return _err("ERR_INVALID_PATH", "relative path must use slash separators")

    var parts: Array[String] = []
    for part in raw.split("/", true):
        if part.is_empty() or part == ".":
            continue
        if part == "..":
            if parts.is_empty():
                return _err("ERR_OUTSIDE_ROOT", "relative path escapes root")
            parts.remove_at(parts.size() - 1)
            continue
        parts.append(part)
    if parts.is_empty():
        return _err("ERR_EMPTY_PATH", "relative path is empty after cleaning")
    return _ok(_join_strings(parts, "/"))


static func is_equal_result(left: String, right: String, options: Dictionary = {}) -> Dictionary:
    var left_result := normalize_result(left, options)
    if not left_result.ok:
        return left_result
    var right_result := normalize_result(right, options)
    if not right_result.ok:
        return right_result
    return _ok(left_result.value == right_result.value)


static func to_win32_result(canonical: String) -> Dictionary:
    if _has_nul(canonical):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    if _has_drive_root(canonical):
        return _ok(_uppercase_ascii(canonical.substr(0, 1)) + ":\\" + canonical.substr(3).replace("/", "\\"))
    if canonical.begins_with("//"):
        return _ok("\\\\" + canonical.substr(2).replace("/", "\\"))
    return _ok(canonical.replace("/", "\\"))


static func to_wsl_result(canonical: String, options: Dictionary = {}) -> Dictionary:
    if _has_nul(canonical):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    if not _has_drive_root(canonical):
        return _ok(canonical)
    var mount_root := _trim_right_slashes(str(options.get("mountRoot", "/mnt")))
    if mount_root.is_empty():
        mount_root = "/mnt"
    var rest := canonical.substr(3)
    var drive := _lowercase_ascii(canonical.substr(0, 1))
    if rest.is_empty():
        return _ok(mount_root + "/" + drive)
    return _ok(mount_root + "/" + drive + "/" + rest)


static func to_posix_result(canonical: String) -> Dictionary:
    if _has_nul(canonical):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    if _has_drive_root(canonical):
        return _err("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as to_wsl")
    if canonical.contains("\\"):
        return _err("ERR_INVALID_PATH", "canonical paths must use slash separators")
    return _ok(canonical)


static func sanitize_component_result(name: String, profile: String) -> Dictionary:
    if name.is_empty():
        return _err("ERR_INVALID_COMPONENT", "component is empty")
    if _has_nul(name):
        return _err("ERR_NUL_BYTE", "component contains NUL")
    var value := _trim_component_edges(_replace_unsafe_component_chars(name))
    if value.is_empty():
        value = "component"
    if profile == "win32":
        value = _escape_reserved_win32_component(value)
    return _ok(value)


static func encode_component_result(name: String, profile: String) -> Dictionary:
    return sanitize_component_result(name, profile)


static func encode_git_ref_result(raw: String) -> Dictionary:
    if raw.is_empty():
        return _err("ERR_INVALID_COMPONENT", "git ref is empty")
    if _has_nul(raw):
        return _err("ERR_NUL_BYTE", "git ref contains NUL")
    var slug := _trim_component_edges(_slug_git_ref(raw))
    if slug.is_empty():
        slug = "ref"
    return _ok(slug + "--" + raw.sha256_text().substr(0, 12))


static func _parse_file_uri(uri: String, options: Dictionary) -> Dictionary:
    if _has_nul(uri):
        return _err("ERR_NUL_BYTE", "URI contains NUL")
    var uri_options := _nested(options, "uri")
    if uri.begins_with("file://"):
        if not _option_bool(uri_options, "allowFileUri", false):
            return _err("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed")
        return _parse_hierarchical_uri_path(uri, "file://", options)
    if uri.begins_with("vscode-file://"):
        if not _option_bool(uri_options, "allowVSCodeFileUri", false):
            return _err("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed")
        return _parse_hierarchical_uri_path(uri, "vscode-file://", options)
    if _has_uri_scheme(uri):
        return _err("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme")
    return _ok(uri)


static func _parse_hierarchical_uri_path(raw: String, prefix: String, options: Dictionary) -> Dictionary:
    var uri_options := _nested(options, "uri")
    var reject_encoded_slash := bool(uri_options.get("rejectEncodedSlash", true))
    if reject_encoded_slash and _has_encoded_separator(raw):
        return _err("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator")
    var rest := raw.substr(prefix.length())
    var slash := rest.find("/")
    if slash < 0:
        return _err("ERR_INVALID_URI", "URI path is empty")
    var decoded_authority := _percent_decode(rest.substr(0, slash))
    if not decoded_authority.ok:
        return decoded_authority
    var decoded_path := _percent_decode(rest.substr(slash))
    if not decoded_path.ok:
        return decoded_path
    if str(decoded_path.value).is_empty():
        return _err("ERR_INVALID_URI", "URI path is empty")
    if prefix == "file://" and not str(decoded_authority.value).is_empty() and str(decoded_authority.value).to_lower() != "localhost":
        return _ok("//" + str(decoded_authority.value) + str(decoded_path.value))
    return decoded_path


static func _percent_decode(value: String) -> Dictionary:
    var bytes := PackedByteArray()
    var index := 0
    while index < value.length():
        if value.substr(index, 1) != "%":
            bytes.append_array(value.substr(index, 1).to_utf8_buffer())
            index += 1
            continue
        if index + 2 >= value.length():
            return _err("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
        var high := _hex_value(value.substr(index + 1, 1))
        var low := _hex_value(value.substr(index + 2, 1))
        if high < 0 or low < 0:
            return _err("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
        bytes.append((high << 4) | low)
        index += 3
    return _ok(bytes.get_string_from_utf8())


static func _has_encoded_separator(value: String) -> bool:
    if value.length() < 3:
        return false
    for index in range(value.length() - 2):
        if value.substr(index, 1) != "%":
            continue
        var high := _lowercase_ascii(value.substr(index + 1, 1))
        var low := _lowercase_ascii(value.substr(index + 2, 1))
        if (high == "2" and low == "f") or (high == "5" and low == "c"):
            return true
    return false


static func _unwrap_windows_extended_prefix(value: String) -> String:
    if value.begins_with("\\\\?\\UNC\\"):
        return "\\\\" + value.substr("\\\\?\\UNC\\".length())
    if value.begins_with("\\\\?\\"):
        return value.substr("\\\\?\\".length())
    return value


static func _map_wsl_drive(value: String, options: Dictionary) -> String:
    if not _option_bool(options, "enabled", false):
        return value
    var mount_root := _trim_right_slashes(str(options.get("mountRoot", "/mnt")))
    if mount_root.is_empty():
        mount_root = "/mnt"
    var prefix := mount_root + "/"
    if not value.begins_with(prefix):
        return value
    var rest := value.substr(prefix.length())
    if rest.is_empty() or not _is_ascii_letter(rest.substr(0, 1)):
        return value
    if rest.length() > 1 and rest.substr(1, 1) != "/":
        return value
    var drive := _lowercase_ascii(rest.substr(0, 1))
    if rest.length() == 1:
        return drive + ":/"
    return drive + ":/" + rest.substr(2)


static func _clean_canonical(value: String) -> Dictionary:
    if value.is_empty():
        return _err("ERR_EMPTY_PATH", "path is empty")
    var root := _split_root(value)
    if not root.ok:
        return root
    var parts: Array[String] = []
    for part in str(root.rest).split("/", true):
        if part.is_empty() or part == ".":
            continue
        if part == "..":
            if not parts.is_empty():
                parts.remove_at(parts.size() - 1)
                continue
            if not str(root.prefix).is_empty():
                continue
            return _err("ERR_INVALID_PATH", "relative path escapes above its root")
        parts.append(part)
    var joined := _join_strings(parts, "/")
    if str(root.prefix).is_empty():
        return _ok("." if joined.is_empty() else joined)
    if root.prefix == "/":
        return _ok("/" if joined.is_empty() else "/" + joined)
    if str(root.prefix).ends_with("/"):
        return _ok(str(root.prefix) if joined.is_empty() else str(root.prefix) + joined)
    return _ok(str(root.prefix) if joined.is_empty() else str(root.prefix) + "/" + joined)


static func _validate_target_profile(value: String, target_profile: String) -> Dictionary:
    if target_profile.is_empty() or target_profile == "portable":
        return _ok(true)
    if target_profile == "posix":
        if _has_drive_root(value) or value.begins_with("//"):
            return _err("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots")
        return _ok(true)
    if target_profile == "win32-drive":
        if value.begins_with("/"):
            return _err("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots")
        return _ok(true)
    return _err("ERR_INVALID_PATH", "unsupported targetProfile")


static func _canonical_parts(value: String) -> Dictionary:
    if _has_nul(value):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    var root := _split_root(value)
    if not root.ok:
        return root
    if str(root.prefix).is_empty():
        return _err("ERR_INVALID_PATH", "path must be canonical absolute")
    var parts: Array[String] = []
    for part in str(root.rest).split("/", true):
        if part.is_empty():
            continue
        if part == "." or part == "..":
            return _err("ERR_INVALID_PATH", "path is not lexically cleaned")
        parts.append(part)
    return {"ok": true, "prefix": root.prefix, "parts": parts}


static func _split_root(value: String) -> Dictionary:
    if _has_drive_root(value):
        return {"ok": true, "prefix": value.substr(0, 3), "rest": value.substr(3)}
    if value.begins_with("//"):
        var rest := value.substr(2)
        var first := rest.find("/")
        if first <= 0:
            return _err("ERR_INVALID_PATH", "UNC path requires server and share")
        var server := rest.substr(0, first)
        var after_first := rest.substr(first + 1)
        var second := after_first.find("/")
        var share := after_first.substr(0, second) if second >= 0 else after_first
        var tail := after_first.substr(second + 1) if second >= 0 else ""
        if share.is_empty():
            return _err("ERR_INVALID_PATH", "UNC path requires server and share")
        return {"ok": true, "prefix": "//" + server + "/" + share, "rest": tail}
    if value.begins_with("/"):
        return {"ok": true, "prefix": "/", "rest": value.substr(1)}
    return {"ok": true, "prefix": "", "rest": value}


static func _has_windows_ads(value: String) -> bool:
    var start := 0
    if _has_drive_root(value):
        start = 3
    elif value.begins_with("//"):
        var root := _split_root(value)
        start = str(root.get("prefix", "")).length() if root.ok else 0
    return value.substr(start).contains(":")


static func _has_reserved_device_name(value: String) -> bool:
    var root := _split_root(value)
    if not root.ok:
        return false
    for part in str(root.rest).split("/", true):
        if part.is_empty() or part == "." or part == "..":
            continue
        var split_at := _index_of_any(part, [".", ":"])
        var base := part.substr(0, split_at) if split_at >= 0 else part
        if _is_reserved_device_base(base):
            return true
    return false


static func _replace_unsafe_component_chars(input: String) -> String:
    var result := ""
    var previous_unsafe := false
    for index in range(input.length()):
        var ch := input.substr(index, 1)
        var unsafe := ch == "/" or ch == "\\" or ch == ":" or ch == "\t" or ch == "\n" or ch == "\r"
        if unsafe:
            if not previous_unsafe:
                result += "-"
            previous_unsafe = true
        else:
            result += ch
            previous_unsafe = false
    return result


static func _escape_reserved_win32_component(value: String) -> String:
    var dot := value.find(".")
    var base := value.substr(0, dot) if dot >= 0 else value
    var suffix := value.substr(dot) if dot >= 0 else ""
    if _is_reserved_device_base(base):
        return base + "-" + suffix
    return value


static func _is_reserved_device_base(value: String) -> bool:
    var upper := value.to_upper()
    if upper == "CON" or upper == "PRN" or upper == "AUX" or upper == "NUL":
        return true
    if upper.length() != 4:
        return false
    if not (upper.begins_with("COM") or upper.begins_with("LPT")):
        return false
    var digit := upper.substr(3, 1).unicode_at(0)
    return digit >= "1".unicode_at(0) and digit <= "9".unicode_at(0)


static func _slug_git_ref(raw: String) -> String:
    var result := ""
    var previous_unsafe := false
    for index in range(raw.length()):
        var ch := raw.substr(index, 1)
        if _is_git_ref_slug_char(ch):
            result += ch
            previous_unsafe = false
        elif not previous_unsafe:
            result += "-"
            previous_unsafe = true
    return result


static func _is_git_ref_slug_char(value: String) -> bool:
    if value.is_empty():
        return false
    var code := value.unicode_at(0)
    return (code >= "A".unicode_at(0) and code <= "Z".unicode_at(0)) or (code >= "a".unicode_at(0) and code <= "z".unicode_at(0)) or (code >= "0".unicode_at(0) and code <= "9".unicode_at(0)) or value == "." or value == "_" or value == "-"


static func _has_uri_scheme(value: String) -> bool:
    var index := value.find("://")
    if index <= 0:
        return false
    if not _is_ascii_letter(value.substr(0, 1)):
        return false
    for position in range(1, index):
        var ch := value.substr(position, 1)
        var code := ch.unicode_at(0)
        if not (_is_ascii_letter(ch) or (code >= "0".unicode_at(0) and code <= "9".unicode_at(0)) or ch == "+" or ch == "." or ch == "-"):
            return false
    return true


static func _has_drive_root(value: String) -> bool:
    return value.length() >= 3 and _is_ascii_letter(value.substr(0, 1)) and value.substr(1, 1) == ":" and value.substr(2, 1) == "/"


static func _is_drive_relative(value: String) -> bool:
    return value.length() >= 2 and _is_ascii_letter(value.substr(0, 1)) and value.substr(1, 1) == ":" and (value.length() == 2 or value.substr(2, 1) != "/")


static func _is_uri_windows_drive_path(value: String) -> bool:
    return value.length() >= 4 and value.substr(0, 1) == "/" and _is_ascii_letter(value.substr(1, 1)) and value.substr(2, 1) == ":" and value.substr(3, 1) == "/"


static func _is_absolute_path_like(value: String) -> bool:
    return value.begins_with("/") or value.begins_with("\\\\") or _has_drive_root(value.replace("\\", "/"))


static func _lowercase_drive_root(value: String) -> String:
    return _lowercase_ascii(value.substr(0, 1)) + value.substr(1)


static func _has_nul(value: String) -> bool:
    return value.contains(String.chr(0))


static func _is_ascii_letter(value: String) -> bool:
    if value.is_empty():
        return false
    var code := value.unicode_at(0)
    return (code >= "A".unicode_at(0) and code <= "Z".unicode_at(0)) or (code >= "a".unicode_at(0) and code <= "z".unicode_at(0))


static func _lowercase_ascii(value: String) -> String:
    if value.is_empty():
        return value
    var code := value.unicode_at(0)
    if code >= "A".unicode_at(0) and code <= "Z".unicode_at(0):
        return String.chr(code + 32)
    return value


static func _uppercase_ascii(value: String) -> String:
    if value.is_empty():
        return value
    var code := value.unicode_at(0)
    if code >= "a".unicode_at(0) and code <= "z".unicode_at(0):
        return String.chr(code - 32)
    return value


static func _hex_value(value: String) -> int:
    if value.is_empty():
        return -1
    var code := value.unicode_at(0)
    if code >= "0".unicode_at(0) and code <= "9".unicode_at(0):
        return code - "0".unicode_at(0)
    if code >= "A".unicode_at(0) and code <= "F".unicode_at(0):
        return code - "A".unicode_at(0) + 10
    if code >= "a".unicode_at(0) and code <= "f".unicode_at(0):
        return code - "a".unicode_at(0) + 10
    return -1


static func _trim_right_slashes(value: String) -> String:
    var result := value
    while result.ends_with("/"):
        result = result.substr(0, result.length() - 1)
    return result


static func _trim_component_edges(value: String) -> String:
    var start := 0
    var end := value.length()
    while start < end and _is_component_edge_char(value.substr(start, 1)):
        start += 1
    while start < end and _is_component_edge_char(value.substr(end - 1, 1)):
        end -= 1
    return value.substr(start, end - start)


static func _is_component_edge_char(value: String) -> bool:
    return value == " " or value == "." or value == "_" or value == "-"


static func _index_of_any(value: String, needles: Array) -> int:
    var result := -1
    for needle in needles:
        var index := value.find(str(needle))
        if index >= 0 and (result < 0 or index < result):
            result = index
    return result


static func _join_strings(parts: Array, separator: String) -> String:
    var result := ""
    for index in range(parts.size()):
        if index > 0:
            result += separator
        result += str(parts[index])
    return result


static func _nested(options: Dictionary, key: String) -> Dictionary:
    var value = options.get(key, {})
    return value if typeof(value) == TYPE_DICTIONARY else {}


static func _option_bool(options: Dictionary, key: String, default_value: bool) -> bool:
    var value = options.get(key, default_value)
    return value if typeof(value) == TYPE_BOOL else default_value


static func _ok(value) -> Dictionary:
    return {"ok": true, "value": value}


static func _err(code: String, message: String) -> Dictionary:
    return {"ok": false, "error": code, "message": message}
