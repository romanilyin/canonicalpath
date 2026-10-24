use std::error::Error;
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WslOptions {
    pub enabled: bool,
    pub mount_root: String,
}

impl Default for WslOptions {
    fn default() -> Self {
        Self {
            enabled: false,
            mount_root: "/mnt".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UriOptions {
    pub allow_file_uri: bool,
    pub allow_vscode_file_uri: bool,
    pub reject_encoded_slash: bool,
}

impl Default for UriOptions {
    fn default() -> Self {
        Self {
            allow_file_uri: false,
            allow_vscode_file_uri: false,
            reject_encoded_slash: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowsOptions {
    pub preserve_extended_length: bool,
    pub reject_device_names: bool,
    pub reject_ads: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NormalizeOptions {
    pub source_host: String,
    pub target_profile: String,
    pub wsl: WslOptions,
    pub uri: UriOptions,
    pub windows: WindowsOptions,
    pub trim_outer_whitespace: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathError {
    code: String,
    message: String,
}

impl PathError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }
}

impl fmt::Display for PathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for PathError {}

#[derive(Debug)]
struct SplitRoot {
    prefix: String,
    rest: String,
}

pub fn normalize(raw: &str) -> Result<String, PathError> {
    normalize_with_options(raw, &NormalizeOptions::default())
}

pub fn normalize_with_options(raw: &str, options: &NormalizeOptions) -> Result<String, PathError> {
    let mut value = if options.trim_outer_whitespace {
        trim_outer_ascii_whitespace(raw)
    } else {
        raw.to_string()
    };
    if value.is_empty() {
        return Err(err("ERR_EMPTY_PATH", "path is empty"));
    }
    if has_nul(&value) {
        return Err(err("ERR_NUL_BYTE", "path contains NUL"));
    }
    let mount_root = normalize_mount_root(&options.wsl.mount_root)?;
    if options.source_host == "posix" && options.wsl.enabled {
        return Err(err(
            "ERR_INVALID_PATH",
            "native POSIX input cannot request WSL drive mapping",
        ));
    }
    if options.source_host == "posix" {
        value = prepare_native_posix(&value)?;
    } else if options.source_host != "canonical" {
        value = normalize_raw_input(&value, options, &mount_root)?;
    }
    split_root(&value)?;
    validate_windows_components(&value, &options.windows)?;
    let cleaned = clean_canonical(&value)?;
    validate_target_profile(&cleaned, &options.target_profile)?;
    Ok(cleaned)
}

fn normalize_raw_input(
    raw: &str,
    options: &NormalizeOptions,
    mount_root: &str,
) -> Result<String, PathError> {
    let uri_input = has_uri_scheme(raw);
    let mut value = if uri_input || options.source_host == "vscode-file-uri" {
        parse_file_uri(raw, options)?
    } else {
        raw.to_string()
    };
    // WSL paths use POSIX components before any Windows separator rewriting.
    if options.wsl.enabled
        && value.starts_with('/')
        && (!value.starts_with("//") || value.starts_with("///"))
        && !(uri_input && is_uri_windows_drive_path(&value))
    {
        let prepared = prepare_native_posix(&value)?;
        validate_windows_components(&prepared, &options.windows)?;
        let cleaned = clean_canonical(&prepared)?;
        if options.target_profile == "posix" {
            return Ok(cleaned);
        }
        return Ok(map_wsl_drive(&cleaned, mount_root).unwrap_or(cleaned));
    }
    value = value.replace('\\', "/");
    if value.starts_with("//?/") {
        split_root(&value)?;
    }
    if !options.windows.preserve_extended_length {
        value = unwrap_windows_extended_prefix(&value);
    }
    if is_uri_windows_drive_path(&value) {
        value = value[1..].to_string();
    }
    Ok(value)
}

fn validate_windows_components(value: &str, options: &WindowsOptions) -> Result<(), PathError> {
    if options.reject_ads && has_windows_ads(value) {
        return Err(err(
            "ERR_ALTERNATE_DATA_STREAM",
            "Windows alternate data stream is not allowed",
        ));
    }
    if options.reject_device_names && has_reserved_device_name(value) {
        return Err(err(
            "ERR_RESERVED_DEVICE_NAME",
            "Windows reserved device name is not allowed",
        ));
    }
    Ok(())
}

pub fn relative(root: &str, target: &str) -> Result<String, PathError> {
    let (root_prefix, root_parts) = canonical_parts(root)?;
    let (target_prefix, target_parts) = canonical_parts(target)?;
    if root_prefix != target_prefix || target_parts.len() < root_parts.len() {
        return Err(err("ERR_OUTSIDE_ROOT", "target is outside root"));
    }
    for (index, root_part) in root_parts.iter().enumerate() {
        if target_parts[index] != *root_part {
            return Err(err("ERR_OUTSIDE_ROOT", "target is outside root"));
        }
    }
    if target_parts.len() == root_parts.len() {
        return Ok(".".to_string());
    }
    Ok(mark_relative(&target_parts[root_parts.len()..].join("/")))
}

pub fn join(root: &str, relative_path: &str) -> Result<String, PathError> {
    let parsed = parse_clean_canonical(root)?;
    if is_windows_root(&parsed.prefix) && relative_path.contains('\\') {
        return Err(err(
            "ERR_INVALID_PATH",
            "Windows canonical components cannot contain a literal backslash",
        ));
    }
    let clean_relative = normalize_canonical_relative(relative_path)?;
    if clean_relative == "." {
        return Ok(root.to_string());
    }
    let relative = without_relative_marker(&clean_relative);
    if parsed.prefix.is_empty() {
        return Ok(mark_relative(&if parsed.rest.is_empty() {
            relative.to_string()
        } else {
            format!("{}/{relative}", parsed.rest)
        }));
    }
    Ok(if root.ends_with('/') {
        format!("{root}{relative}")
    } else {
        format!("{root}/{relative}")
    })
}

pub fn join_parts(parts: &[&str]) -> Result<String, PathError> {
    let mut result = String::new();
    for part in parts.iter().copied().filter(|part| !part.is_empty()) {
        if result.is_empty() {
            parse_clean_canonical(part)?;
            result = part.to_string();
        } else {
            result = join(&result, part)?;
        }
    }
    if result.is_empty() {
        return Err(err("ERR_EMPTY_PATH", "join parts are empty"));
    }
    Ok(result)
}

pub fn is_equal(left: &str, right: &str, options: &NormalizeOptions) -> Result<bool, PathError> {
    Ok(normalize_with_options(left, options)? == normalize_with_options(right, options)?)
}

pub fn to_win32(canonical: &str) -> Result<String, PathError> {
    let root = parse_clean_canonical(canonical)?;
    if root.prefix == "/" || canonical.contains('\\') || has_relative_marker(canonical) {
        return Err(err(
            "ERR_INVALID_PATH",
            "canonical path has no lossless Windows representation",
        ));
    }
    let mut value = canonical.to_string();
    if has_drive_root(&value) {
        value.replace_range(0..1, &value[..1].to_ascii_uppercase());
    } else if value.starts_with("//?/") && has_drive_root(&value[4..]) {
        value.replace_range(4..5, &value[4..5].to_ascii_uppercase());
    }
    Ok(value.replace('/', "\\"))
}

pub fn to_wsl(canonical: &str, options: &WslOptions) -> Result<String, PathError> {
    let mount_root = normalize_mount_root(&options.mount_root)?;
    let root = parse_clean_canonical(canonical)?;
    if is_windows_root(&root.prefix) && !has_drive_root(&root.prefix) {
        return Err(err(
            "ERR_INVALID_PATH",
            "WSL mapping requires an ordinary Windows drive root",
        ));
    }
    if !has_drive_root(&root.prefix) {
        return Ok(canonical.to_string());
    }
    let mut result = format!(
        "{}/{}",
        mount_root.trim_end_matches('/'),
        to_lower_ascii_byte(canonical.as_bytes()[0])
    );
    if !root.rest.is_empty() {
        result.push('/');
        result.push_str(&root.rest);
    }
    Ok(result)
}

pub fn to_posix(canonical: &str) -> Result<String, PathError> {
    let root = parse_clean_canonical(canonical)?;
    if is_windows_root(&root.prefix) {
        return Err(err(
            "ERR_INVALID_PATH",
            "Windows roots require an explicit host mapping",
        ));
    }
    Ok(canonical.to_string())
}

pub fn sanitize_component(name: &str, profile: &str) -> Result<String, PathError> {
    if name.is_empty() {
        return Err(err("ERR_INVALID_COMPONENT", "component is empty"));
    }
    if has_nul(name) {
        return Err(err("ERR_NUL_BYTE", "component contains NUL"));
    }
    let mut value = String::new();
    let mut in_replacement = false;
    for ch in name.chars() {
        let replace = matches!(ch, '/' | '\\' | ':' | '\t' | '\n' | '\r');
        if replace {
            if !in_replacement {
                value.push('-');
            }
            in_replacement = true;
        } else {
            value.push(ch);
            in_replacement = false;
        }
    }
    value = trim_component_edges(&value);
    if value.is_empty() {
        value = "component".to_string();
    }
    if profile == "win32" {
        value = escape_reserved_win32_component(&value);
    }
    Ok(value)
}

pub fn encode_component(name: &str, profile: &str) -> Result<String, PathError> {
    sanitize_component(name, profile)
}

pub fn encode_git_ref(raw: &str) -> Result<String, PathError> {
    if raw.is_empty() {
        return Err(err("ERR_INVALID_COMPONENT", "git ref is empty"));
    }
    if has_nul(raw) {
        return Err(err("ERR_NUL_BYTE", "git ref contains NUL"));
    }
    let mut slug = String::new();
    let mut in_replacement = false;
    for ch in raw.chars() {
        let allowed = ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-');
        if allowed {
            slug.push(ch);
            in_replacement = false;
        } else if !in_replacement {
            slug.push('-');
            in_replacement = true;
        }
    }
    slug = trim_component_edges(&slug);
    slug.truncate(80); // ASCII slug; truncation cannot split UTF-8.
    slug = trim_component_edges(&slug);
    if slug.is_empty() {
        slug = "ref".to_string();
    }
    Ok(format!("v2-{}--{}", slug, sha256_hex(raw)))
}

fn err(code: &str, message: &str) -> PathError {
    PathError::new(code, message)
}

fn has_nul(value: &str) -> bool {
    value.as_bytes().contains(&0)
}

fn is_ascii_letter(value: u8) -> bool {
    value.is_ascii_alphabetic()
}

fn to_lower_ascii_byte(value: u8) -> char {
    value.to_ascii_lowercase() as char
}

fn has_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3 && is_ascii_letter(bytes[0]) && bytes[1] == b':' && bytes[2] == b'/'
}

fn is_drive_relative(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2
        && is_ascii_letter(bytes[0])
        && bytes[1] == b':'
        && (bytes.len() == 2 || bytes[2] != b'/')
}

fn is_uri_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 4
        && bytes[0] == b'/'
        && is_ascii_letter(bytes[1])
        && bytes[2] == b':'
        && bytes[3] == b'/'
}

fn trim_outer_ascii_whitespace(value: &str) -> String {
    value
        .trim_matches(|ch| matches!(ch, ' ' | '\t' | '\n' | '\r' | '\x0c' | '\x0b'))
        .to_string()
}

fn has_uri_scheme(value: &str) -> bool {
    let Some(index) = value.find("://") else {
        return false;
    };
    if index == 0 {
        return false;
    }
    let bytes = value.as_bytes();
    if !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    bytes[1..index]
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'+' | b'.' | b'-'))
}

fn unwrap_windows_extended_prefix(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }
    value.strip_prefix("//?/").unwrap_or(value).to_string()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(value: &str) -> Result<String, PathError> {
    let bytes = value.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            result.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(err(
                "ERR_INVALID_PERCENT_ENCODING",
                "URI percent encoding is invalid",
            ));
        }
        let Some(high) = hex_value(bytes[index + 1]) else {
            return Err(err(
                "ERR_INVALID_PERCENT_ENCODING",
                "URI percent encoding is invalid",
            ));
        };
        let Some(low) = hex_value(bytes[index + 2]) else {
            return Err(err(
                "ERR_INVALID_PERCENT_ENCODING",
                "URI percent encoding is invalid",
            ));
        };
        result.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(result).map_err(|_| {
        err(
            "ERR_INVALID_PERCENT_ENCODING",
            "URI percent encoding is invalid",
        )
    })
}

fn has_encoded_separator(value: &str) -> bool {
    let bytes = value.as_bytes();
    for window in bytes.windows(3) {
        if window[0] != b'%' {
            continue;
        }
        let low = window[2].to_ascii_lowercase();
        if window[1] == b'2' && low == b'f' {
            return true;
        }
        if window[1] == b'5' && low == b'c' {
            return true;
        }
    }
    false
}

fn lower_ascii_string(value: &str) -> String {
    value.chars().map(|ch| ch.to_ascii_lowercase()).collect()
}

fn parse_hierarchical_uri_path(
    raw: &str,
    prefix: &str,
    options: &NormalizeOptions,
) -> Result<String, PathError> {
    if options.uri.reject_encoded_slash && has_encoded_separator(raw) {
        return Err(err(
            "ERR_ENCODED_SEPARATOR",
            "URI contains an encoded path separator",
        ));
    }

    let rest = &raw[prefix.len()..];
    let Some(slash) = rest.find('/') else {
        return Err(err("ERR_INVALID_URI", "URI path is empty"));
    };
    let decoded_authority = percent_decode(&rest[..slash])?;
    let decoded = percent_decode(&rest[slash..])?;
    if decoded.contains('\0') || decoded_authority.contains('\0') {
        return Err(err("ERR_NUL_BYTE", "decoded URI contains NUL"));
    }
    if decoded.is_empty() {
        return Err(err("ERR_INVALID_URI", "URI path is empty"));
    }

    if prefix == "file://"
        && !decoded_authority.is_empty()
        && lower_ascii_string(&decoded_authority) != "localhost"
    {
        return Ok(format!("//{decoded_authority}{decoded}"));
    }
    Ok(decoded)
}

fn parse_file_uri(uri: &str, options: &NormalizeOptions) -> Result<String, PathError> {
    if has_nul(uri) {
        return Err(err("ERR_NUL_BYTE", "URI contains NUL"));
    }
    if uri.starts_with("file://") {
        if !options.uri.allow_file_uri {
            return Err(err("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed"));
        }
        return parse_hierarchical_uri_path(uri, "file://", options);
    }
    if uri.starts_with("vscode-file://") {
        if !options.uri.allow_vscode_file_uri {
            return Err(err(
                "ERR_UNSUPPORTED_URI_SCHEME",
                "vscode-file URI is not allowed",
            ));
        }
        return parse_hierarchical_uri_path(uri, "vscode-file://", options);
    }
    if has_uri_scheme(uri) {
        return Err(err("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme"));
    }
    Ok(uri.to_string())
}

fn normalize_mount_root(value: &str) -> Result<String, PathError> {
    if has_nul(value) {
        return Err(err("ERR_NUL_BYTE", "WSL mount root contains NUL"));
    }
    let value = if value.is_empty() { "/mnt" } else { value };
    if !value.starts_with('/') {
        return Err(err(
            "ERR_INVALID_PATH",
            "WSL mount root must be an absolute native POSIX path",
        ));
    }
    clean_native_posix(value)
}

fn map_wsl_drive(value: &str, mount_root: &str) -> Option<String> {
    let prefix = format!("{}/", mount_root.trim_end_matches('/'));
    let rest = value.strip_prefix(&prefix)?;
    let bytes = rest.as_bytes();
    if bytes.is_empty() || !is_ascii_letter(bytes[0]) || (bytes.len() > 1 && bytes[1] != b'/') {
        return None;
    }
    Some(format!(
        "{}:/{}",
        to_lower_ascii_byte(bytes[0]),
        if bytes.len() > 1 { &rest[2..] } else { "" }
    ))
}

fn split_root(value: &str) -> Result<SplitRoot, PathError> {
    let result = if let Some(tail) = value.strip_prefix("//?/") {
        if has_drive_root(tail) {
            SplitRoot {
                prefix: value[..7].to_string(),
                rest: value[7..].to_string(),
            }
        } else if tail.starts_with("UNC/") {
            split_unc_root(value, "//?/UNC/")?
        } else {
            return Err(err(
                "ERR_INVALID_PATH",
                "extended root requires an absolute drive or UNC server and share",
            ));
        }
    } else if has_drive_root(value) {
        SplitRoot {
            prefix: value[..3].to_string(),
            rest: value[3..].to_string(),
        }
    } else if value.starts_with("//") {
        split_unc_root(value, "//")?
    } else if let Some(rest) = value.strip_prefix('/') {
        SplitRoot {
            prefix: "/".to_string(),
            rest: rest.to_string(),
        }
    } else if is_drive_relative(value) {
        return Err(err(
            "ERR_DRIVE_RELATIVE_PATH",
            "Windows drive-relative paths are not canonical",
        ));
    } else {
        SplitRoot {
            prefix: String::new(),
            rest: value.to_string(),
        }
    };
    if is_windows_root(&result.prefix) && value.contains('\\') {
        return Err(err(
            "ERR_INVALID_PATH",
            "Windows canonical components cannot contain a literal backslash",
        ));
    }
    Ok(result)
}

fn split_unc_root(value: &str, leader: &str) -> Result<SplitRoot, PathError> {
    let mut parts = value[leader.len()..].splitn(3, '/');
    let server = parts.next().unwrap_or("");
    let share = parts.next().unwrap_or("");
    if server.is_empty()
        || share.is_empty()
        || matches!(server, "." | "..")
        || matches!(share, "." | "..")
    {
        return Err(err(
            "ERR_INVALID_PATH",
            "UNC root requires non-dot server and share components",
        ));
    }
    Ok(SplitRoot {
        prefix: format!("{leader}{server}/{share}"),
        rest: parts.next().unwrap_or("").to_string(),
    })
}

fn is_windows_root(prefix: &str) -> bool {
    !prefix.is_empty() && prefix != "/"
}
fn is_drive_root(prefix: &str) -> bool {
    has_drive_root(prefix) || prefix.strip_prefix("//?/").is_some_and(has_drive_root)
}

fn lowercase_drive(value: &str) -> String {
    let mut result = value.to_string();
    if has_drive_root(value) {
        result.replace_range(0..1, &value[..1].to_ascii_lowercase());
    } else if value.starts_with("//?/") && has_drive_root(&value[4..]) {
        result.replace_range(4..5, &value[4..5].to_ascii_lowercase());
    }
    result
}

fn needs_relative_marker(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && is_ascii_letter(bytes[0]) && bytes[1] == b':'
}
fn mark_relative(value: &str) -> String {
    if needs_relative_marker(value) {
        format!("./{value}")
    } else {
        value.to_string()
    }
}
fn has_relative_marker(value: &str) -> bool {
    value.strip_prefix("./").is_some_and(needs_relative_marker)
}
fn without_relative_marker(value: &str) -> &str {
    if has_relative_marker(value) {
        &value[2..]
    } else {
        value
    }
}

fn prepare_native_posix(value: &str) -> Result<String, PathError> {
    let leading = value.len() - value.trim_start_matches('/').len();
    if leading == 2 {
        return Err(err(
            "ERR_INVALID_PATH",
            "native POSIX paths with exactly two leading slashes are unsupported",
        ));
    }
    if leading > 2 {
        return Ok(format!("/{}", &value[leading..]));
    }
    Ok(mark_relative(value))
}

fn clean_native_posix(value: &str) -> Result<String, PathError> {
    clean_canonical(&prepare_native_posix(value)?)
}

fn parse_clean_canonical(value: &str) -> Result<SplitRoot, PathError> {
    if clean_canonical(value)? != lowercase_drive(value) {
        return Err(err(
            "ERR_INVALID_PATH",
            "path is not lexically cleaned canonical input",
        ));
    }
    let mut root = split_root(value)?;
    if root.prefix.is_empty() {
        root.rest = if root.rest == "." {
            String::new()
        } else {
            without_relative_marker(&root.rest).to_string()
        };
    }
    Ok(root)
}

fn clean_canonical(value: &str) -> Result<String, PathError> {
    if value.is_empty() {
        return Err(err("ERR_EMPTY_PATH", "path is empty"));
    }
    if has_nul(value) {
        return Err(err("ERR_NUL_BYTE", "path contains NUL"));
    }
    let mut root = split_root(value)?;
    root.prefix = lowercase_drive(&root.prefix);
    let mut parts: Vec<&str> = Vec::new();
    for part in root.rest.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if !parts.is_empty() {
                parts.pop();
                continue;
            }
            if !root.prefix.is_empty() {
                continue;
            }
            return Err(err(
                "ERR_INVALID_PATH",
                "relative path escapes above its root",
            ));
        }
        parts.push(part);
    }

    let joined = parts.join("/");
    if root.prefix.is_empty() {
        return Ok(if joined.is_empty() {
            ".".to_string()
        } else {
            mark_relative(&joined)
        });
    }
    if root.prefix == "/" {
        return Ok(if joined.is_empty() {
            "/".to_string()
        } else {
            format!("/{joined}")
        });
    }
    if root.prefix.ends_with('/') {
        return Ok(if joined.is_empty() {
            root.prefix
        } else {
            format!("{}{joined}", root.prefix)
        });
    }
    Ok(if joined.is_empty() {
        root.prefix
    } else {
        format!("{}/{joined}", root.prefix)
    })
}

fn validate_target_profile(value: &str, target_profile: &str) -> Result<(), PathError> {
    let root = split_root(value)?;
    match target_profile {
        "" | "portable" => Ok(()),
        "posix" if !is_windows_root(&root.prefix) => Ok(()),
        "win32-drive"
            if root.prefix != "/"
                && (!is_windows_root(&root.prefix) || is_drive_root(&root.prefix)) =>
        {
            Ok(())
        }
        _ => Err(err(
            "ERR_INVALID_PATH",
            "unsupported targetProfile or root kind",
        )),
    }
}

fn is_reserved_device_base(base: &str) -> bool {
    let upper = base.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let bytes = upper.as_bytes();
    bytes.len() == 4
        && (bytes.starts_with(b"COM") || bytes.starts_with(b"LPT"))
        && (b'1'..=b'9').contains(&bytes[3])
}

fn has_windows_ads(value: &str) -> bool {
    split_root(value).is_ok_and(|root| root.rest.contains(':'))
}

fn has_reserved_device_name(value: &str) -> bool {
    let Ok(root) = split_root(value) else {
        return false;
    };
    for part in root.rest.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            continue;
        }
        let dot = part.find(['.', ':']);
        let base = dot.map_or(part, |index| &part[..index]);
        if is_reserved_device_base(base) {
            return true;
        }
    }
    false
}

fn canonical_parts(value: &str) -> Result<(String, Vec<String>), PathError> {
    let root = parse_clean_canonical(value)?;
    if root.prefix.is_empty() {
        return Err(err("ERR_INVALID_PATH", "path must be canonical absolute"));
    }
    let parts = if root.rest.is_empty() {
        Vec::new()
    } else {
        root.rest.split('/').map(str::to_string).collect()
    };
    Ok((root.prefix, parts))
}

fn normalize_canonical_relative(raw: &str) -> Result<String, PathError> {
    if raw.is_empty() {
        return Err(err("ERR_EMPTY_PATH", "relative path is empty"));
    }
    if raw == "." {
        return Ok(".".to_string());
    }
    if has_nul(raw) {
        return Err(err("ERR_NUL_BYTE", "relative path contains NUL"));
    }
    if raw.starts_with('/') || has_drive_root(raw) {
        return Err(err(
            "ERR_ABSOLUTE_PATH",
            "relative path must not be absolute",
        ));
    }
    if is_drive_relative(raw) {
        return Err(err(
            "ERR_DRIVE_RELATIVE_PATH",
            "drive-relative path is not allowed",
        ));
    }

    let mut parts: Vec<&str> = Vec::new();
    for part in raw.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if parts.is_empty() {
                return Err(err("ERR_OUTSIDE_ROOT", "relative path escapes root"));
            }
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    if parts.is_empty() {
        return Ok(".".to_string());
    }
    Ok(mark_relative(&parts.join("/")))
}

fn trim_component_edges(value: &str) -> String {
    value
        .trim_matches(|ch| matches!(ch, ' ' | '.' | '_' | '-'))
        .to_string()
}

fn escape_reserved_win32_component(value: &str) -> String {
    let (base, suffix) = match value.find('.') {
        Some(dot) => (&value[..dot], &value[dot..]),
        None => (value, ""),
    };
    if is_reserved_device_base(base) {
        return format!("{base}-{suffix}");
    }
    value.to_string()
}

fn sha256_hex(input: &str) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut data = input.as_bytes().to_vec();
    let bit_length = (data.len() as u64) * 8;
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    for shift in (0..=56).rev().step_by(8) {
        data.push(((bit_length >> shift) & 0xff) as u8);
    }

    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];

    for chunk in data.chunks(64) {
        let mut w = [0u32; 64];
        for (index, slot) in w.iter_mut().take(16).enumerate() {
            let offset = index * 4;
            *slot = ((chunk[offset] as u32) << 24)
                | ((chunk[offset + 1] as u32) << 16)
                | ((chunk[offset + 2] as u32) << 8)
                | chunk[offset + 3] as u32;
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    h.iter().map(|value| format!("{value:08x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_posix_and_canonical_outputs_round_trip() {
        let native = NormalizeOptions {
            source_host: "posix".to_string(),
            ..NormalizeOptions::default()
        };
        let canonical = NormalizeOptions {
            source_host: "canonical".to_string(),
            ..NormalizeOptions::default()
        };
        for raw in [
            r"/repo/a\b",
            "/C:/repo",
            "C:/repo",
            "C:foo",
            "x/../C:foo",
            "file:///C:/repo",
            "///repo",
        ] {
            let first = normalize_with_options(raw, &native).unwrap();
            assert_eq!(normalize_with_options(&first, &native).unwrap(), first);
            assert_eq!(normalize_with_options(&first, &canonical).unwrap(), first);
        }
        for raw in [
            "//?/C:/a/../..",
            "//?/UNC/server/share/a/../..",
            "./C:/repo",
        ] {
            let first = normalize_with_options(raw, &canonical).unwrap();
            assert_eq!(normalize_with_options(&first, &canonical).unwrap(), first);
        }
    }

    #[test]
    fn relative_join_preserves_canonical_components_and_roots() {
        for (root, target) in [
            ("/repo", r"/repo/a\b"),
            ("/repo", "/repo/C:/nested"),
            ("c:/repo", "c:/repo/C:foo"),
            ("//?/c:/repo", "//?/c:/repo/file"),
            ("//?/UNC/server/share", "//?/UNC/server/share/repo/file"),
            ("/repo/cafe\u{301}", "/repo/cafe\u{301}/😀/file"),
        ] {
            assert_eq!(
                join(root, &relative(root, target).unwrap()).unwrap(),
                target
            );
        }
    }

    #[test]
    fn canonical_join_cleaned_self_preserves_root() {
        for root in [
            ".",
            "relative",
            "./C:root",
            "/repo",
            "c:/repo",
            "//server/share",
            "//?/c:/repo",
            "//?/UNC/server/share",
        ] {
            for relative in [".", "./", "./.", "a/..", "a/.././"] {
                assert_eq!(join(root, relative).unwrap(), root);
            }
            assert_eq!(join(root, "").unwrap_err().code(), "ERR_EMPTY_PATH");
        }
        for root in [
            "c:/repo",
            "//server/share",
            "//?/c:/repo",
            "//?/UNC/server/share",
        ] {
            assert_eq!(
                join(root, r"a\b/../file").unwrap_err().code(),
                "ERR_INVALID_PATH"
            );
        }
    }

    #[test]
    fn wsl_mount_configuration_round_trips_and_rejects_nul() {
        for mount in ["", "/", "/foo/../mnt/./", r"/mnt\vol", "/C:/drives"] {
            let options = NormalizeOptions {
                wsl: WslOptions {
                    enabled: true,
                    mount_root: mount.to_string(),
                },
                ..NormalizeOptions::default()
            };
            let host = to_wsl("c:/repo", &options.wsl).unwrap();
            assert_eq!(normalize_with_options(&host, &options).unwrap(), "c:/repo");
        }
        let options = WslOptions {
            mount_root: "/mnt\0extra".to_string(),
            ..WslOptions::default()
        };
        assert_eq!(
            to_wsl("/repo", &options).unwrap_err().code(),
            "ERR_NUL_BYTE"
        );
    }

    #[test]
    fn serializers_reject_unclean_canonical_operands() {
        assert!(to_posix("/repo/a/../b").is_err());
        assert!(to_win32("c:/repo/a/../b").is_err());
        assert!(to_wsl("c:/repo/a/../b", &WslOptions::default()).is_err());
    }

    #[test]
    fn normalizes_windows_drive_letter_only() {
        let options = NormalizeOptions {
            source_host: "win32".to_string(),
            target_profile: "win32-drive".to_string(),
            ..NormalizeOptions::default()
        };
        assert_eq!(
            normalize_with_options("C:/USERS/Alice/Repo", &options).unwrap(),
            "c:/USERS/Alice/Repo"
        );
    }

    #[test]
    fn rejects_prefix_sibling_relative_target() {
        let error = relative("/tmp/project", "/tmp/project-evil/file.txt").unwrap_err();
        assert_eq!(error.code(), "ERR_OUTSIDE_ROOT");
    }

    #[test]
    fn encodes_git_refs_with_hash_suffix() {
        assert_eq!(
            encode_git_ref("feature/auth").unwrap(),
            "v2-feature-auth--fc659bd735856486b656ea75488903eac295b13e5d7cce7f55339ed029ceabc6"
        );
    }
}
