from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any


class CanonicalPathError(ValueError):
    """Lexical CanonicalPath error with a stable shared-vector code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def error_code(error: BaseException) -> str:
    if isinstance(error, CanonicalPathError):
        return error.code
    return "ERR_INVALID_PATH"


def normalize(raw: str, options: Mapping[str, Any] | None = None) -> str:
    opts = _as_mapping(options)
    if _option(opts, "trimOuterWhitespace", False):
        raw = raw.strip()
    if raw == "":
        raise _path_error("ERR_EMPTY_PATH", "path is empty")
    if _has_nul(raw):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")

    value = raw
    if _has_uri_scheme(value) or _option(opts, "sourceHost") == "vscode-file-uri":
        value = _parse_file_uri(value, opts)
    if _has_nul(value):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")
    if not _option(_nested(opts, "windows"), "preserveExtendedLength", False):
        value = _unwrap_windows_extended_prefix(value)
    value = value.replace("\\", "/")

    target_profile = _option(opts, "targetProfile")
    if target_profile != "posix":
        value = _map_wsl_drive(value, _nested(opts, "wsl"))
    if _is_uri_windows_drive_path(value):
        value = value[1:]

    if _is_drive_relative(value):
        raise _path_error("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
    if _has_drive_root(value):
        value = value[0].lower() + value[1:]

    windows = _nested(opts, "windows")
    if _option(windows, "rejectADS", False) and _has_windows_ads(value):
        raise _path_error("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
    if _option(windows, "rejectDeviceNames", False) and _has_reserved_device_name(value):
        raise _path_error("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")

    cleaned = _clean_canonical(value)
    _validate_target_profile(cleaned, target_profile)
    return cleaned


def relative(root: str, target: str) -> str:
    root_prefix, root_parts = _canonical_parts(root)
    target_prefix, target_parts = _canonical_parts(target)
    if root_prefix != target_prefix or len(target_parts) < len(root_parts):
        raise _path_error("ERR_OUTSIDE_ROOT", "target is outside root")
    for index, part in enumerate(root_parts):
        if target_parts[index] != part:
            raise _path_error("ERR_OUTSIDE_ROOT", "target is outside root")
    if len(target_parts) == len(root_parts):
        return "."
    return "/".join(target_parts[len(root_parts) :])


def join(root: str, relative_path: str) -> str:
    clean_relative = normalize_relative(relative_path)
    if _has_nul(root):
        raise _path_error("ERR_NUL_BYTE", "root contains NUL")
    if clean_relative == ".":
        return root
    if root == "/" or root.endswith("/"):
        return root + clean_relative
    return f"{root}/{clean_relative}"


def join_parts(parts: list[str] | tuple[str, ...]) -> str:
    result = ""
    for part in parts:
        if part == "":
            continue
        result = part if result == "" else join(result, part)
    if result == "":
        raise _path_error("ERR_EMPTY_PATH", "join parts are empty")
    return result


def normalize_relative(raw: str) -> str:
    if raw == "":
        raise _path_error("ERR_EMPTY_PATH", "relative path is empty")
    if raw == ".":
        return "."
    if _has_nul(raw):
        raise _path_error("ERR_NUL_BYTE", "relative path contains NUL")
    if _is_absolute_path_like(raw):
        raise _path_error("ERR_ABSOLUTE_PATH", "relative path must not be absolute")
    if _is_drive_relative(raw):
        raise _path_error("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed")
    if "\\" in raw:
        raise _path_error("ERR_INVALID_PATH", "relative path must use slash separators")

    parts: list[str] = []
    for part in raw.split("/"):
        if part == "" or part == ".":
            continue
        if part == "..":
            if len(parts) == 0:
                raise _path_error("ERR_OUTSIDE_ROOT", "relative path escapes root")
            parts.pop()
            continue
        parts.append(part)
    if len(parts) == 0:
        raise _path_error("ERR_EMPTY_PATH", "relative path is empty after cleaning")
    return "/".join(parts)


def is_equal(left: str, right: str, options: Mapping[str, Any] | None = None) -> bool:
    return normalize(left, options) == normalize(right, options)


def to_win32(canonical: str) -> str:
    if _has_nul(canonical):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")
    if _has_drive_root(canonical):
        return canonical[0].upper() + ":\\" + canonical[3:].replace("/", "\\")
    if canonical.startswith("//"):
        return "\\\\" + canonical[2:].replace("/", "\\")
    return canonical.replace("/", "\\")


def to_wsl(canonical: str, options: Mapping[str, Any] | None = None) -> str:
    opts = _as_mapping(options)
    if _has_nul(canonical):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")
    if not _has_drive_root(canonical):
        return canonical
    mount_root = str(_option(opts, "mountRoot", "/mnt") or "/mnt").rstrip("/")
    result = f"{mount_root}/{canonical[0].lower()}"
    rest = canonical[3:]
    if rest != "":
        result += f"/{rest}"
    return result


def to_posix(canonical: str) -> str:
    if _has_nul(canonical):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")
    if _has_drive_root(canonical):
        raise _path_error("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as to_wsl")
    if "\\" in canonical:
        raise _path_error("ERR_INVALID_PATH", "canonical paths must use slash separators")
    return canonical


def sanitize_component(name: str, profile: str) -> str:
    if name == "":
        raise _path_error("ERR_INVALID_COMPONENT", "component is empty")
    if _has_nul(name):
        raise _path_error("ERR_NUL_BYTE", "component contains NUL")
    value = re.sub(r"[\\/:\t\n\r]+", "-", name).strip(" ._-")
    if value == "":
        value = "component"
    if profile == "win32":
        value = _escape_reserved_win32_component(value)
    return value


def encode_component(name: str, profile: str) -> str:
    return sanitize_component(name, profile)


def encode_git_ref(raw: str) -> str:
    if raw == "":
        raise _path_error("ERR_INVALID_COMPONENT", "git ref is empty")
    if _has_nul(raw):
        raise _path_error("ERR_NUL_BYTE", "git ref contains NUL")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("._-") or "ref"
    return f"{slug}--{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:12]}"


def _path_error(code: str, message: str) -> CanonicalPathError:
    return CanonicalPathError(code, message)


def _as_mapping(value: Mapping[str, Any] | None) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _nested(options: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = options.get(key)
    return value if isinstance(value, Mapping) else {}


def _option(options: Mapping[str, Any], key: str, default: Any = None) -> Any:
    return options.get(key, default)


def _has_nul(value: str) -> bool:
    return "\0" in value


def _is_ascii_letter(value: str) -> bool:
    return len(value) == 1 and (("A" <= value <= "Z") or ("a" <= value <= "z"))


def _has_drive_root(value: str) -> bool:
    return len(value) >= 3 and _is_ascii_letter(value[0]) and value[1] == ":" and value[2] == "/"


def _is_drive_relative(value: str) -> bool:
    return len(value) >= 2 and _is_ascii_letter(value[0]) and value[1] == ":" and (len(value) == 2 or value[2] != "/")


def _is_uri_windows_drive_path(value: str) -> bool:
    return len(value) >= 4 and value[0] == "/" and _is_ascii_letter(value[1]) and value[2] == ":" and value[3] == "/"


def _is_absolute_path_like(value: str) -> bool:
    return value.startswith("/") or value.startswith("\\\\") or _has_drive_root(value.replace("\\", "/"))


def _has_uri_scheme(value: str) -> bool:
    index = value.find("://")
    if index <= 0:
        return False
    return re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*", value[:index]) is not None


def _unwrap_windows_extended_prefix(value: str) -> str:
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[len("\\\\?\\UNC\\") :]
    if value.startswith("\\\\?\\"):
        return value[len("\\\\?\\") :]
    return value


def _percent_decode(value: str) -> str:
    result = bytearray()
    index = 0
    while index < len(value):
        char = value[index]
        if char != "%":
            result.extend(char.encode("utf-8"))
            index += 1
            continue
        if index + 2 >= len(value):
            raise _path_error("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
        pair = value[index + 1 : index + 3]
        if re.fullmatch(r"[0-9A-Fa-f]{2}", pair) is None:
            raise _path_error("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid")
        result.append(int(pair, 16))
        index += 3
    try:
        return result.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise _path_error("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid") from exc


def _has_encoded_separator(value: str) -> bool:
    return re.search(r"%(?:2[fF]|5[cC])", value) is not None


def _parse_hierarchical_uri_path(raw: str, prefix: str, options: Mapping[str, Any]) -> str:
    uri = _nested(options, "uri")
    if _option(uri, "rejectEncodedSlash", True) and _has_encoded_separator(raw):
        raise _path_error("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator")

    rest = raw[len(prefix) :]
    slash = rest.find("/")
    if slash < 0:
        raise _path_error("ERR_INVALID_URI", "URI path is empty")
    decoded_authority = _percent_decode(rest[:slash])
    decoded_path = _percent_decode(rest[slash:])
    if decoded_path == "":
        raise _path_error("ERR_INVALID_URI", "URI path is empty")
    if prefix == "file://" and decoded_authority != "" and decoded_authority.lower() != "localhost":
        return f"//{decoded_authority}{decoded_path}"
    return decoded_path


def _parse_file_uri(uri: str, options: Mapping[str, Any]) -> str:
    if _has_nul(uri):
        raise _path_error("ERR_NUL_BYTE", "URI contains NUL")
    uri_options = _nested(options, "uri")
    if uri.startswith("file://"):
        if not _option(uri_options, "allowFileUri", False):
            raise _path_error("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed")
        return _parse_hierarchical_uri_path(uri, "file://", options)
    if uri.startswith("vscode-file://"):
        if not _option(uri_options, "allowVSCodeFileUri", False):
            raise _path_error("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed")
        return _parse_hierarchical_uri_path(uri, "vscode-file://", options)
    if _has_uri_scheme(uri):
        raise _path_error("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme")
    return uri


def _map_wsl_drive(value: str, options: Mapping[str, Any]) -> str:
    if not _option(options, "enabled", False):
        return value
    mount_root = str(_option(options, "mountRoot", "/mnt") or "/mnt").rstrip("/")
    prefix = f"{mount_root}/"
    if not value.startswith(prefix):
        return value
    rest = value[len(prefix) :]
    if len(rest) < 1 or not _is_ascii_letter(rest[0]):
        return value
    if len(rest) > 1 and rest[1] != "/":
        return value
    if len(rest) == 1:
        return f"{rest[0].lower()}:/"
    return f"{rest[0].lower()}:/{rest[2:]}"


def _split_root(value: str) -> tuple[str, str]:
    if _has_drive_root(value):
        return value[:3], value[3:]
    if value.startswith("//"):
        rest = value[2:]
        first = rest.find("/")
        if first <= 0:
            raise _path_error("ERR_INVALID_PATH", "UNC path requires server and share")
        server = rest[:first]
        after_first = rest[first + 1 :]
        second = after_first.find("/")
        if second >= 0:
            share = after_first[:second]
            tail = after_first[second + 1 :]
        else:
            share = after_first
            tail = ""
        if share == "":
            raise _path_error("ERR_INVALID_PATH", "UNC path requires server and share")
        return f"//{server}/{share}", tail
    if value.startswith("/"):
        return "/", value[1:]
    return "", value


def _clean_canonical(value: str) -> str:
    if value == "":
        raise _path_error("ERR_EMPTY_PATH", "path is empty")
    prefix, rest = _split_root(value)
    parts: list[str] = []
    for part in rest.split("/"):
        if part == "" or part == ".":
            continue
        if part == "..":
            if len(parts) > 0:
                parts.pop()
                continue
            if prefix != "":
                continue
            raise _path_error("ERR_INVALID_PATH", "relative path escapes above its root")
        parts.append(part)

    joined = "/".join(parts)
    if prefix == "":
        return "." if joined == "" else joined
    if prefix == "/":
        return "/" if joined == "" else f"/{joined}"
    if prefix.endswith("/"):
        return prefix if joined == "" else f"{prefix}{joined}"
    return prefix if joined == "" else f"{prefix}/{joined}"


def _validate_target_profile(value: str, target_profile: Any) -> None:
    if target_profile is None or target_profile == "portable":
        return
    if target_profile == "posix":
        if _has_drive_root(value) or value.startswith("//"):
            raise _path_error("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots")
        return
    if target_profile == "win32-drive":
        if value.startswith("/"):
            raise _path_error("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots")
        return
    raise _path_error("ERR_INVALID_PATH", "unsupported targetProfile")


def _canonical_parts(value: str) -> tuple[str, list[str]]:
    if _has_nul(value):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")
    prefix, rest = _split_root(value)
    if prefix == "":
        raise _path_error("ERR_INVALID_PATH", "path must be canonical absolute")
    parts = [part for part in rest.split("/") if part != ""]
    if any(part == "." or part == ".." for part in parts):
        raise _path_error("ERR_INVALID_PATH", "path is not lexically cleaned")
    return prefix, parts


def _has_windows_ads(value: str) -> bool:
    start = 3 if _has_drive_root(value) else 0
    if value.startswith("//"):
        try:
            start = len(_split_root(value)[0])
        except CanonicalPathError:
            start = 0
    return ":" in value[start:]


def _has_reserved_device_name(value: str) -> bool:
    try:
        rest = _split_root(value)[1]
    except CanonicalPathError:
        return False
    for part in rest.split("/"):
        if part == "" or part == "." or part == "..":
            continue
        match = re.split(r"[.:]", part, maxsplit=1)
        base = match[0] if len(match) > 0 else ""
        if _is_reserved_device_base(base):
            return True
    return False


def _is_reserved_device_base(base: str) -> bool:
    upper = base.upper()
    if upper in {"CON", "PRN", "AUX", "NUL"}:
        return True
    return re.fullmatch(r"(?:COM|LPT)[1-9]", upper) is not None


def _escape_reserved_win32_component(value: str) -> str:
    dot = value.find(".")
    base = value[:dot] if dot >= 0 else value
    suffix = value[dot:] if dot >= 0 else ""
    if _is_reserved_device_base(base):
        return f"{base}-{suffix}"
    return value
