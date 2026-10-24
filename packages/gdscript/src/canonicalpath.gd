class_name CanonicalPath

static func normalize(raw: String, options: Dictionary = {}) -> Dictionary:
    return normalize_result(raw, options)


static func relative(root: String, target: String) -> Dictionary:
    return relative_result(root, target)


static func join(root: String, relative_path: String) -> Dictionary:
    return join_result(root, relative_path)


static func normalize_result(raw: String, options: Dictionary = {}) -> Dictionary:
    var value := raw.strip_edges() if _option_bool(options, "trimOuterWhitespace", false) else raw
    if value.is_empty():
        return _err("ERR_EMPTY_PATH", "path is empty")
    if _has_nul(value):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    var wsl := _nested(options, "wsl")
    var mount := _mount_from_options(wsl)
    if not mount.ok:
        return mount
    var host := str(options.get("sourceHost", ""))
    var cleaned: Dictionary
    if host == "posix":
        if _option_bool(wsl, "enabled", false):
            return _err("ERR_INVALID_PATH", "native POSIX input cannot enable WSL mapping")
        var native_checked := _validate_windows_components(value, options, true)
        if not native_checked.ok:
            return native_checked
        cleaned = _clean_canonical(value, true)
    elif host == "canonical":
        var checked := _validate_windows_components(value, options)
        if not checked.ok:
            return checked
        cleaned = _clean_canonical(value)
    else:
        var uri_input := _has_uri_scheme(value)
        if uri_input or host == "vscode-file-uri":
            var decoded := _parse_file_uri(value, options)
            if not decoded.ok:
                return decoded
            value = decoded.value
        var candidate := _option_bool(wsl, "enabled", false) and value.begins_with("/") and (not value.begins_with("//") or value.begins_with("///")) and not (uri_input and _is_uri_windows_drive_path(value))
        if candidate:
            var checked := _validate_windows_components(value, options, true)
            if not checked.ok:
                return checked
            cleaned = _clean_canonical(value, true)
            if not cleaned.ok:
                return cleaned
            value = cleaned.value
            var prefix := "/" if mount.value == "/" else str(mount.value) + "/"
            if str(options.get("targetProfile", "")) != "posix" and value.begins_with(prefix):
                var tail := value.substr(prefix.length())
                if not tail.is_empty() and _is_ascii_letter(tail.substr(0, 1)) and (tail.length() == 1 or tail.substr(1, 1) == "/"):
                    value = _lowercase_ascii(tail.substr(0, 1)) + ":/" + ("" if tail.length() == 1 else tail.substr(2))
            cleaned = _clean_canonical(value)
        else:
            value = value.replace("\\", "/")
            if _is_uri_windows_drive_path(value):
                value = value.substr(1)
            var parsed := _split_root(value)
            if not parsed.ok:
                return parsed
            if not _option_bool(_nested(options, "windows"), "preserveExtendedLength", false):
                if parsed.kind == "extended-drive":
                    value = value.substr(4)
                elif parsed.kind == "extended-unc":
                    value = "//" + value.substr(8)
            var checked := _validate_windows_components(value, options)
            if not checked.ok:
                return checked
            cleaned = _clean_canonical(value)
    if not cleaned.ok:
        return cleaned
    var profile := _validate_target_profile(cleaned.value, str(options.get("targetProfile", "")))
    return cleaned if profile.ok else profile


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
    return _ok(_mark_relative(_join_strings(target_parts.parts.slice(root_parts.parts.size()), "/")))


static func join_result(root: String, relative_path: String) -> Dictionary:
    var parsed_root := _require_canonical(root)
    if not parsed_root.ok:
        return parsed_root
    var parsed_relative := _split_root(relative_path)
    if not parsed_relative.ok:
        return parsed_relative
    if not str(parsed_relative.prefix).is_empty():
        return _err("ERR_ABSOLUTE_PATH", "join argument must be relative")
    if _is_windows_root(parsed_root) and relative_path.contains("\\"):
        return _err("ERR_INVALID_PATH", "backslash data is not representable under a Windows root")
    var clean := _clean_canonical(relative_path, false, "ERR_OUTSIDE_ROOT")
    if not clean.ok:
        return clean
    if clean.value == ".":
        return _ok(root)
    var tail := str(clean.value)
    if tail.begins_with("./"):
        tail = tail.substr(2)
    return _clean_canonical(tail if root == "." else _trim_right_slashes(root) + "/" + tail, parsed_root.kind == "relative")


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
    var parsed := _require_canonical(canonical, true)
    if not parsed.ok:
        return parsed
    if parsed.kind == "posix" or canonical.contains("\\") or canonical.begins_with("./"):
        return _err("ERR_INVALID_PATH", "canonical path is not representable as Windows")
    var value := canonical
    if parsed.kind == "drive":
        value = _uppercase_ascii(value.substr(0, 1)) + value.substr(1)
    if parsed.kind == "extended-drive":
        value = value.substr(0, 4) + _uppercase_ascii(value.substr(4, 1)) + value.substr(5)
    return _ok(value.replace("/", "\\"))


static func to_wsl_result(canonical: String, options: Dictionary = {}) -> Dictionary:
    var mount := _mount_from_options(options)
    if not mount.ok:
        return mount
    var parsed := _require_canonical(canonical, true)
    if not parsed.ok:
        return parsed
    if parsed.kind == "posix" or parsed.kind == "relative":
        return _ok(canonical)
    if parsed.kind != "drive":
        return _err("ERR_INVALID_PATH", "WSL serialization requires an ordinary drive")
    return _ok(("" if mount.value == "/" else str(mount.value)) + "/" + str(parsed.prefix).substr(0, 1) + ("" if str(parsed.rest).is_empty() else "/" + str(parsed.rest)))


static func to_posix_result(canonical: String) -> Dictionary:
    var parsed := _require_canonical(canonical)
    if not parsed.ok:
        return parsed
    if _is_windows_root(parsed):
        return _err("ERR_INVALID_PATH", "Windows root requires explicit host mapping")
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
    for index in range(raw.length()):
        var scalar := raw.unicode_at(index)
        if scalar > 0x10ffff or (scalar >= 0xd800 and scalar <= 0xdfff):
            return _err("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode")
    var slug := _trim_component_edges(_trim_component_edges(_slug_git_ref(raw)).substr(0, 80))
    if slug.is_empty():
        slug = "ref"
    return _ok("v2-" + slug + "--" + raw.sha256_text())


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
    if str(decoded_path.value).contains(String.chr(0)) or str(decoded_authority.value).contains(String.chr(0)):
        return _err("ERR_NUL_BYTE", "decoded URI contains NUL")
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
        if ((high << 4) | low) == 0:
            return _err("ERR_NUL_BYTE", "decoded URI contains NUL")
        bytes.append((high << 4) | low)
        index += 3
    return from_utf8(bytes)


static func from_utf8(bytes: PackedByteArray) -> Dictionary:
    # Godot String conversion can replace NUL. Validate bytes before conversion;
    # the URI decoder and byte-oriented adapters share this production boundary.
    if bytes.has(0):
        return _err("ERR_NUL_BYTE", "input contains NUL before String conversion")
    var i := 0
    while i < bytes.size():
        var first := bytes[i]
        i += 1
        if first < 0x80:
            continue
        var count: int
        var code: int
        var minimum: int
        if first >= 0xc2 and first <= 0xdf:
            count = 1; code = first & 0x1f; minimum = 0x80
        elif first >= 0xe0 and first <= 0xef:
            count = 2; code = first & 0x0f; minimum = 0x800
        elif first >= 0xf0 and first <= 0xf4:
            count = 3; code = first & 0x07; minimum = 0x10000
        else:
            return _err("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8")
        if bytes.size() - i < count:
            return _err("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8")
        for _unused in range(count):
            var next := bytes[i]
            i += 1
            if (next & 0xc0) != 0x80:
                return _err("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8")
            code = (code << 6) | (next & 0x3f)
        if code < minimum or code > 0x10ffff or (code >= 0xd800 and code <= 0xdfff):
            return _err("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8")
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
    var compact_root := "/".join(mount_root.split("/", false))
    if mount_root.begins_with("/"):
        compact_root = "/" + compact_root
    var prefix := compact_root + "/"
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


static func _clean_canonical(value: String, native_posix: bool = false, escape_code: String = "ERR_INVALID_PATH") -> Dictionary:
    if value.is_empty():
        return _err("ERR_EMPTY_PATH", "path is empty")
    var root := _split_root(value, native_posix)
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
            return _err(escape_code, "relative path escapes above its root")
        parts.append(part)
    var joined := _join_strings(parts, "/")
    if str(root.prefix).is_empty():
        return _ok("." if joined.is_empty() else _mark_relative(joined))
    if root.prefix == "/":
        return _ok("/" if joined.is_empty() else "/" + joined)
    if str(root.prefix).ends_with("/"):
        return _ok(str(root.prefix) if joined.is_empty() else str(root.prefix) + joined)
    return _ok(str(root.prefix) if joined.is_empty() else str(root.prefix) + "/" + joined)


static func _validate_target_profile(value: String, target_profile: String) -> Dictionary:
    var parsed := _split_root(value)
    if not parsed.ok:
        return parsed
    if target_profile.is_empty() or target_profile == "portable":
        return _ok(true)
    if target_profile == "posix" and not _is_windows_root(parsed):
        return _ok(true)
    if target_profile == "win32-drive" and (parsed.kind == "relative" or parsed.kind == "drive" or parsed.kind == "extended-drive"):
        return _ok(true)
    return _err("ERR_INVALID_PATH", "canonical root is incompatible with target profile")


static func _canonical_parts(value: String) -> Dictionary:
    if _has_nul(value):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    var root := _require_canonical(value)
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


static func _split_root(value: String, native_posix: bool = false) -> Dictionary:
    if value.is_empty():
        return _err("ERR_EMPTY_PATH", "path is empty")
    if _has_nul(value):
        return _err("ERR_NUL_BYTE", "path contains NUL")
    if native_posix:
        if value.begins_with("//") and not value.begins_with("///"):
            return _err("ERR_INVALID_PATH", "double-leading-slash POSIX path is unsupported")
        return _grammar_root("/", value.substr(1)) if value.begins_with("/") else _grammar_root("", value)
    var parsed: Dictionary
    if value.begins_with("//?/"):
        var tail := value.substr(4)
        if _has_drive_root(tail):
            parsed = _grammar_root("//?/" + _lowercase_ascii(tail.substr(0, 1)) + ":/", tail.substr(3))
        elif tail.begins_with("UNC/"):
            parsed = _split_unc(tail.substr(4), "//?/UNC/")
        else:
            return _err("ERR_INVALID_PATH", "unsupported or incomplete extended root")
    elif _has_drive_root(value):
        parsed = _grammar_root(_lowercase_ascii(value.substr(0, 1)) + ":/", value.substr(3))
    elif _is_drive_relative(value):
        return _err("ERR_DRIVE_RELATIVE_PATH", "unmarked drive-relative path")
    elif value.begins_with("//"):
        parsed = _split_unc(value.substr(2), "//")
    elif value.begins_with("/"):
        parsed = _grammar_root("/", value.substr(1))
    else:
        parsed = _grammar_root("", value)
    if not parsed.ok:
        return parsed
    if _is_windows_root(parsed) and value.contains("\\"):
        return _err("ERR_INVALID_PATH", "Windows canonical components cannot contain backslash")
    return parsed


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
    for index in range(value.length()):
        if value.unicode_at(index) == 0:
            return true
    return false


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


static func _grammar_root(prefix: String, rest: String) -> Dictionary:
    var kind := "relative" if prefix.is_empty() else "posix" if prefix == "/" else "extended-unc" if prefix.begins_with("//?/UNC/") else "extended-drive" if prefix.begins_with("//?/") else "unc" if prefix.begins_with("//") else "drive"
    return {"ok": true, "prefix": prefix, "rest": rest, "kind": kind}


static func _split_unc(value: String, prefix: String) -> Dictionary:
    var parts := value.split("/", true)
    if parts.size() < 2 or parts[0].is_empty() or parts[1].is_empty() or parts[0] == "." or parts[0] == ".." or parts[1] == "." or parts[1] == "..":
        return _err("ERR_INVALID_PATH", "UNC requires server and share")
    return _grammar_root(prefix + parts[0] + "/" + parts[1], "/".join(parts.slice(2)))


static func _is_windows_root(parsed: Dictionary) -> bool:
    return parsed.kind != "relative" and parsed.kind != "posix"


static func _mark_relative(value: String) -> String:
    return "./" + value if value.length() >= 2 and _is_ascii_letter(value.substr(0, 1)) and value.substr(1, 1) == ":" else value


static func _require_canonical(value: String, allow_drive_case: bool = false) -> Dictionary:
    var parsed := _split_root(value)
    if not parsed.ok:
        return parsed
    var clean := _clean_canonical(value)
    if not clean.ok:
        return clean
    var expected := value
    if allow_drive_case and parsed.kind == "drive":
        expected = _lowercase_ascii(value.substr(0, 1)) + value.substr(1)
    elif allow_drive_case and parsed.kind == "extended-drive":
        expected = value.substr(0, 4) + _lowercase_ascii(value.substr(4, 1)) + value.substr(5)
    if clean.value != expected:
        return _err("ERR_INVALID_PATH", "path must be lexically cleaned canonical data")
    return parsed


static func _mount_from_options(options: Dictionary) -> Dictionary:
    # Byte-oriented callers must retain the original bytes until this boundary.
    var value: Variant = options.get("mountRoot", "")
    if value is PackedByteArray:
        var decoded := from_utf8(value)
        if not decoded.ok:
            return decoded
        return _normalize_mount(decoded.value)
    if not value is String:
        return _err("ERR_INVALID_PATH", "WSL mount root must be String or PackedByteArray")
    return _normalize_mount(value)


static func _normalize_mount(value: String) -> Dictionary:
    if value.is_empty():
        value = "/mnt"
    var parsed := _split_root(value, true)
    if not parsed.ok:
        return parsed
    if parsed.kind != "posix":
        return _err("ERR_INVALID_PATH", "WSL mount root must be absolute POSIX")
    return _clean_canonical(value, true)


static func _validate_windows_components(value: String, options: Dictionary, native_posix: bool = false) -> Dictionary:
    var parsed := _split_root(value, native_posix)
    if not parsed.ok:
        return parsed
    var windows := _nested(options, "windows")
    var rest := str(parsed.rest)
    if _option_bool(windows, "rejectADS", false) and rest.contains(":"):
        return _err("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
    if _option_bool(windows, "rejectDeviceNames", false):
        for part in rest.split("/", true):
            var base := part.split(".", true)[0].split(":", true)[0]
            if _is_reserved_device_base(base):
                return _err("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")
    return _ok(true)
