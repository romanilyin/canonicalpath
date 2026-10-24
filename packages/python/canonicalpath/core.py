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
    source = _option(opts, "sourceHost")
    wsl = _nested(opts, "wsl")
    enabled = bool(_option(wsl, "enabled", False))
    mount = _normalize_mount_root(_option(wsl, "mountRoot"))
    profile = _option(opts, "targetProfile")
    if source == "posix":
        if enabled:
            raise _path_error("ERR_INVALID_PATH", "native POSIX input does not allow WSL mapping")
        _check_windows_policy(raw, opts, native_posix=True)
        cleaned = _clean_posix(raw)
    elif source == "canonical":
        if _is_drive_relative(raw):
            raise _path_error("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
        _check_windows_policy(raw, opts)
        cleaned = _clean_canonical(raw)
    else:
        value = raw
        parsed_uri = _has_uri_scheme(value)
        if parsed_uri or source == "vscode-file-uri":
            value = _parse_file_uri(value, opts)
        uri_drive = parsed_uri and _is_uri_windows_drive_path(value)
        posix_candidate = value.startswith("/") and (not value.startswith("//") or value.startswith("///"))
        if enabled and posix_candidate and not uri_drive:
            # The configured WSL input mode uses POSIX components before mapping.
            _check_windows_policy(value, opts)
            cleaned = _clean_posix(value)
            if profile != "posix":
                cleaned = _map_wsl_drive(cleaned, mount)
        else:
            value = value.replace("\\", "/")
            if value.startswith("//?/"):
                _split_root(value)  # Reject unsupported namespaces before unwrapping.
                if not _option(_nested(opts, "windows"), "preserveExtendedLength", False):
                    value = _unwrap_windows_extended_prefix(value)
            if _is_uri_windows_drive_path(value):
                value = value[1:]
            if _is_drive_relative(value):
                raise _path_error("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
            _check_windows_policy(value, opts)
            cleaned = _clean_canonical(value)
    _validate_target_profile(cleaned, profile)
    return cleaned

def relative(root: str, target: str) -> str:
    root_prefix, root_parts = _canonical_parts(root)
    target_prefix, target_parts = _canonical_parts(target)
    if root_prefix != target_prefix or len(target_parts) < len(root_parts):
        raise _path_error("ERR_OUTSIDE_ROOT", "target is outside root")
    if target_parts[:len(root_parts)] != root_parts:
        raise _path_error("ERR_OUTSIDE_ROOT", "target is outside root")
    return _serialize("", target_parts[len(root_parts):])

def join(root: str, relative_path: str) -> str:
    prefix, root_parts = _validated_canonical(root)
    if relative_path == "":
        raise _path_error("ERR_EMPTY_PATH", "relative path is empty")
    if _has_nul(relative_path):
        raise _path_error("ERR_NUL_BYTE", "relative path contains NUL")
    if relative_path.startswith("/") or _has_drive_root(relative_path):
        raise _path_error("ERR_ABSOLUTE_PATH", "relative path must not be absolute")
    if _is_drive_relative(relative_path):
        raise _path_error("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed")
    if prefix not in ("", "/") and "\\" in relative_path:
        raise _path_error("ERR_INVALID_PATH", "relative data is not representable under a Windows root")
    parts = _clean_parts("", relative_path, "ERR_OUTSIDE_ROOT")
    return _serialize(prefix, root_parts + parts)

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
    prefix, parts = _validated_canonical(canonical)
    if prefix == "/" or (prefix == "" and ("\\" in canonical or _is_marked_relative(canonical))):
        raise _path_error("ERR_INVALID_PATH", "canonical path has no lossless Windows representation")
    value = _serialize(prefix, parts)
    if prefix.startswith("//?/") and _has_drive_root(prefix[4:]):
        value = "//?/" + value[4].upper() + value[5:]
    elif _has_drive_root(prefix):
        value = value[0].upper() + value[1:]
    return value.replace("/", "\\")

def to_wsl(canonical: str, options: Mapping[str, Any] | None = None) -> str:
    opts = _as_mapping(options)
    mount = _normalize_mount_root(_option(opts, "mountRoot"))
    prefix, parts = _validated_canonical(canonical)
    if prefix.startswith("//"):
        raise _path_error("ERR_INVALID_PATH", "UNC and preserved extended roots require an explicit host mapping")
    if not _has_drive_root(prefix):
        return canonical
    mount_prefix = "" if mount == "/" else mount
    return mount_prefix + "/" + prefix[0] + ("/" + "/".join(parts) if parts else "")

def to_posix(canonical: str) -> str:
    prefix, _ = _validated_canonical(canonical)
    if prefix not in ("", "/"):
        raise _path_error("ERR_INVALID_PATH", "Windows roots require an explicit host mapping")
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
    try:
        raw_bytes = raw.encode("utf-8", errors="strict")
    except UnicodeEncodeError:
        raise _path_error("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode") from None
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("._-")[:80].strip("._-") or "ref"
    return f"v2-{slug}--{hashlib.sha256(raw_bytes).hexdigest()}"


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
    if value.startswith("//?/UNC/"):
        return "//" + value[8:]
    if value.startswith("//?/"):
        return value[4:]
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
    if "\x00" in decoded_path or "\x00" in decoded_authority:
        raise _path_error("ERR_NUL_BYTE", "decoded URI contains NUL")
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


def _map_wsl_drive(value: str, mount_root: str) -> str:
    prefix = "/" if mount_root == "/" else mount_root + "/"
    if not value.startswith(prefix):
        return value
    rest = value[len(prefix):]
    if not rest or not _is_ascii_letter(rest[0]) or (len(rest) > 1 and rest[1] != "/"):
        return value
    tail = rest[2:] if len(rest) > 1 else ""
    if "\\" in tail:
        raise _path_error("ERR_INVALID_PATH", "literal backslash cannot be mapped to a Windows component")
    return rest[0].lower() + ":/" + tail

def _split_root(value: str) -> tuple[str, str]:
    if _has_nul(value):
        raise _path_error("ERR_NUL_BYTE", "path contains NUL")
    if value.startswith("//?/"):
        inner = value[4:]
        if _has_drive_root(inner):
            prefix, rest = "//?/" + inner[0].lower() + inner[1:3], inner[3:]
        elif inner.startswith("UNC/"):
            unc_prefix, rest = _split_unc(inner[4:])
            prefix = "//?/UNC/" + unc_prefix
        else:
            raise _path_error("ERR_INVALID_PATH", "unsupported extended Windows root")
    elif _has_drive_root(value):
        prefix, rest = value[0].lower() + value[1:3], value[3:]
    elif _is_drive_relative(value):
        raise _path_error("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical")
    elif value.startswith("///"):
        return "/", value.lstrip("/")
    elif value.startswith("//"):
        unc_prefix, rest = _split_unc(value[2:])
        prefix = "//" + unc_prefix
    elif value.startswith("/"):
        return "/", value[1:]
    else:
        return "", value
    if "\\" in value:
        raise _path_error("ERR_INVALID_PATH", "Windows canonical components cannot contain backslash")
    return prefix, rest

def _clean_canonical(value: str) -> str:
    if value == "":
        raise _path_error("ERR_EMPTY_PATH", "path is empty")
    prefix, rest = _split_root(value)
    return _serialize(prefix, _clean_parts(prefix, rest))

def _validate_target_profile(value: str, target_profile: Any) -> None:
    prefix, _ = _split_root(value)
    if target_profile is None or target_profile == "portable":
        return
    drive = _has_drive_root(prefix) or (prefix.startswith("//?/") and _has_drive_root(prefix[4:]))
    if target_profile == "posix" and prefix in ("", "/"):
        return
    if target_profile == "win32-drive" and (prefix == "" or drive):
        return
    raise _path_error("ERR_INVALID_PATH", "path root is not allowed by targetProfile")

def _canonical_parts(value: str) -> tuple[str, list[str]]:
    prefix, parts = _validated_canonical(value)
    if prefix == "":
        raise _path_error("ERR_INVALID_PATH", "path must be canonical absolute")
    return prefix, parts

def _has_windows_ads(value: str) -> bool:
    try:
        prefix, rest = _split_root(value)
    except CanonicalPathError:
        return ":" in value
    return ":" in (rest if prefix not in ("", "/") else value)

def _has_reserved_device_name(value: str, native_posix: bool = False) -> bool:
    try:
        rest = value if native_posix else _split_root(value)[1]
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


def _drive_component(value: str) -> bool:
    return len(value) >= 2 and _is_ascii_letter(value[0]) and value[1] == ":"


def _is_marked_relative(value: str) -> bool:
    return value.startswith("./") and _drive_component(value[2:])


def _split_unc(value: str) -> tuple[str, str]:
    parts = value.split("/", 2)
    if len(parts) < 2 or any(part in ("", ".", "..") for part in parts[:2]):
        raise _path_error("ERR_INVALID_PATH", "UNC path requires a valid server and share")
    return parts[0] + "/" + parts[1], parts[2] if len(parts) == 3 else ""


def _serialize(prefix: str, parts: list[str]) -> str:
    joined = "/".join(parts)
    if prefix == "":
        if not parts:
            return "."
        return ("./" if _drive_component(parts[0]) else "") + joined
    return prefix + (("" if prefix.endswith("/") else "/") + joined if joined else "")


def _clean_parts(prefix: str, rest: str, escape_code: str = "ERR_INVALID_PATH") -> list[str]:
    parts: list[str] = []
    for part in rest.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            elif not prefix:
                raise _path_error(escape_code, "relative path escapes above its root")
        else:
            parts.append(part)
    return parts


def _clean_posix(value: str) -> str:
    if value.startswith("//") and not value.startswith("///"):
        raise _path_error("ERR_INVALID_PATH", "double-leading-slash POSIX roots are unsupported")
    prefix = "/" if value.startswith("/") else ""
    return _serialize(prefix, _clean_parts(prefix, value))


def _normalize_mount_root(raw: Any) -> str:
    value = "/mnt" if raw is None or raw == "" else str(raw)
    if _has_nul(value):
        raise _path_error("ERR_NUL_BYTE", "mount root contains NUL")
    if not value.startswith("/"):
        raise _path_error("ERR_INVALID_PATH", "mount root must be absolute POSIX")
    return _clean_posix(value)


def _validated_canonical(value: str) -> tuple[str, list[str]]:
    if value == "":
        raise _path_error("ERR_EMPTY_PATH", "path is empty")
    prefix, rest = _split_root(value)
    if prefix == "" and value == ".":
        return "", []
    if prefix == "" and _is_marked_relative(rest):
        rest = rest[2:]
    parts = rest.split("/") if rest else []
    if any(part in ("", ".", "..") for part in parts):
        raise _path_error("ERR_INVALID_PATH", "path is not lexically cleaned")
    return prefix, parts


def _check_windows_policy(value: str, options: Mapping[str, Any], native_posix: bool = False) -> None:
    windows = _nested(options, "windows")
    if _option(windows, "rejectADS", False) and ((":" in value) if native_posix else _has_windows_ads(value)):
        raise _path_error("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed")
    if _option(windows, "rejectDeviceNames", False) and _has_reserved_device_name(value, native_posix):
        raise _path_error("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed")
