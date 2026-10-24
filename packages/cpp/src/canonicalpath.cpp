#include "canonicalpath.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace canonicalpath {
namespace {

struct SplitRoot {
  std::string prefix;
  std::string rest;
};

bool starts_with(std::string_view value, std::string_view prefix) {
  return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

bool is_ascii_letter(char value) {
  unsigned char code = static_cast<unsigned char>(value);
  return (code >= 'A' && code <= 'Z') || (code >= 'a' && code <= 'z');
}

char to_lower_ascii(char value) {
  if (value >= 'A' && value <= 'Z') return static_cast<char>(value + ('a' - 'A'));
  return value;
}

std::string to_upper_ascii(std::string_view value) {
  std::string result(value);
  for (char &ch : result) {
    if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - ('a' - 'A'));
  }
  return result;
}

bool has_drive_root(std::string_view value) {
  return value.size() >= 3 && is_ascii_letter(value[0]) && value[1] == ':' && value[2] == '/';
}

bool is_drive_relative(std::string_view value) {
  return value.size() >= 2 && is_ascii_letter(value[0]) && value[1] == ':' &&
         (value.size() == 2 || value[2] != '/');
}

bool is_uri_windows_drive_path(std::string_view value) {
  return value.size() >= 4 && value[0] == '/' && is_ascii_letter(value[1]) &&
         value[2] == ':' && value[3] == '/';
}

std::string replace_char(std::string_view value, char from, char to) {
  std::string result(value);
  std::replace(result.begin(), result.end(), from, to);
  return result;
}

std::string trim_right_slashes(std::string value) {
  while (!value.empty() && value.back() == '/') value.pop_back();
  return value;
}

std::string trim_outer_ascii_whitespace(std::string value) {
  const char *chars = " \t\n\r\f\v";
  std::size_t start = value.find_first_not_of(chars);
  if (start == std::string::npos) return "";
  std::size_t end = value.find_last_not_of(chars);
  return value.substr(start, end - start + 1);
}

bool has_uri_scheme(std::string_view value) {
  std::size_t index = value.find("://");
  if (index == std::string_view::npos || index == 0) return false;
  if (!std::isalpha(static_cast<unsigned char>(value[0]))) return false;
  for (std::size_t i = 1; i < index; ++i) {
    unsigned char ch = static_cast<unsigned char>(value[i]);
    if (!std::isalnum(ch) && value[i] != '+' && value[i] != '.' && value[i] != '-') return false;
  }
  return true;
}

std::string unwrap_windows_extended_prefix(std::string_view value) {
  if (starts_with(value, "//?/UNC/")) return "//" + std::string(value.substr(8));
  if (starts_with(value, "//?/")) return std::string(value.substr(4));
  return std::string(value);
}

int hex_value(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

bool valid_utf8(std::string_view value) {
  std::size_t i = 0;
  while (i < value.size()) {
    unsigned int first = static_cast<unsigned char>(value[i++]);
    if (first < 0x80) continue;
    unsigned int count, code, minimum;
    if (first >= 0xc2 && first <= 0xdf) { count = 1; code = first & 0x1f; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { count = 2; code = first & 0x0f; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { count = 3; code = first & 0x07; minimum = 0x10000; }
    else return false;
    if (value.size() - i < count) return false;
    while (count-- > 0) {
      unsigned int next = static_cast<unsigned char>(value[i++]);
      if ((next & 0xc0) != 0x80) return false;
      code = (code << 6) | (next & 0x3f);
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

std::string percent_decode(std::string_view value) {
  std::string result;
  result.reserve(value.size());
  for (std::size_t i = 0; i < value.size(); ++i) {
    if (value[i] != '%') {
      result.push_back(value[i]);
      continue;
    }
    if (i + 2 >= value.size()) throw path_error("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
    int high = hex_value(value[i + 1]);
    int low = hex_value(value[i + 2]);
    if (high < 0 || low < 0) throw path_error("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
    result.push_back(static_cast<char>((high << 4) | low));
    i += 2;
  }
  if (result.find('\0') != std::string::npos) throw path_error("ERR_NUL_BYTE", "decoded URI contains NUL");
  if (!valid_utf8(result)) throw path_error("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is not valid UTF-8");
  return result;
}

bool has_encoded_separator(std::string_view value) {
  for (std::size_t i = 0; i + 2 < value.size(); ++i) {
    if (value[i] != '%') continue;
    char high = value[i + 1];
    char low = static_cast<char>(std::tolower(static_cast<unsigned char>(value[i + 2])));
    if (high == '2' && low == 'f') return true;
    if (high == '5' && low == 'c') return true;
  }
  return false;
}

std::string lower_ascii_string(std::string value) {
  for (char &ch : value) ch = to_lower_ascii(ch);
  return value;
}

std::string parse_hierarchical_uri_path(std::string_view raw, std::string_view prefix,
                                        const NormalizeOptions &options) {
  if (options.uri.reject_encoded_slash && has_encoded_separator(raw)) {
    throw path_error("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator");
  }

  std::string_view rest = raw.substr(prefix.size());
  std::size_t slash = rest.find('/');
  if (slash == std::string_view::npos) throw path_error("ERR_INVALID_URI", "URI path is empty");

  std::string decoded_authority = percent_decode(rest.substr(0, slash));
  std::string decoded = percent_decode(rest.substr(slash));
  if (decoded.empty()) throw path_error("ERR_INVALID_URI", "URI path is empty");

  if (prefix == "file://" && !decoded_authority.empty() &&
      lower_ascii_string(decoded_authority) != "localhost") {
    return "//" + decoded_authority + decoded;
  }
  return decoded;
}

std::string parse_file_uri(std::string_view uri, const NormalizeOptions &options) {
  if (uri.find('\0') != std::string_view::npos) throw path_error("ERR_NUL_BYTE", "URI contains NUL");
  if (starts_with(uri, "file://")) {
    if (!options.uri.allow_file_uri) throw path_error("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed");
    return parse_hierarchical_uri_path(uri, "file://", options);
  }
  if (starts_with(uri, "vscode-file://")) {
    if (!options.uri.allow_vscode_file_uri) {
      throw path_error("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed");
    }
    return parse_hierarchical_uri_path(uri, "vscode-file://", options);
  }
  if (has_uri_scheme(uri)) throw path_error("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme");
  return std::string(uri);
}

std::string map_wsl_drive(std::string_view value, const WslOptions &options) {
  const std::string prefix = trim_right_slashes(options.mount_root) + "/";
  if (!starts_with(value, prefix)) return std::string(value);
  std::string_view rest = value.substr(prefix.size());
  if (rest.empty() || !is_ascii_letter(rest[0]) || (rest.size() > 1 && rest[1] != '/')) return std::string(value);
  std::string result(1, to_lower_ascii(rest[0]));
  result += ":/";
  if (rest.size() > 1) result += rest.substr(2);
  return result;
}

bool is_windows_root(std::string_view prefix) { return !prefix.empty() && prefix != "/"; }
bool is_drive_root(std::string_view prefix) {
  return has_drive_root(prefix) || (starts_with(prefix, "//?/") && has_drive_root(prefix.substr(4)));
}

SplitRoot split_unc_root(std::string_view value, std::string_view leader) {
  std::string_view rest = value.substr(leader.size());
  std::size_t first = rest.find('/');
  if (first == std::string_view::npos) throw path_error("ERR_INVALID_PATH", "UNC root requires server and share");
  std::size_t second = rest.find('/', first + 1);
  std::string_view server = rest.substr(0, first);
  std::string_view share = second == std::string_view::npos ? rest.substr(first + 1) : rest.substr(first + 1, second - first - 1);
  if (server.empty() || share.empty() || server == "." || server == ".." || share == "." || share == "..") {
    throw path_error("ERR_INVALID_PATH", "UNC root requires non-dot server and share components");
  }
  return {std::string(leader) + std::string(server) + "/" + std::string(share), second == std::string_view::npos ? "" : std::string(rest.substr(second + 1))};
}

SplitRoot split_root(std::string_view value) {
  SplitRoot result;
  if (starts_with(value, "//?/")) {
    if (has_drive_root(value.substr(4))) result = {std::string(value.substr(0, 7)), std::string(value.substr(7))};
    else if (starts_with(value.substr(4), "UNC/")) result = split_unc_root(value, "//?/UNC/");
    else throw path_error("ERR_INVALID_PATH", "extended root requires an absolute drive or UNC server and share");
  } else if (has_drive_root(value)) {
    result = {std::string(value.substr(0, 3)), std::string(value.substr(3))};
  } else if (starts_with(value, "//")) {
    result = split_unc_root(value, "//");
  } else if (starts_with(value, "/")) {
    result = {"/", std::string(value.substr(1))};
  } else if (is_drive_relative(value)) {
    throw path_error("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical");
  } else {
    result = {"", std::string(value)};
  }
  if (is_windows_root(result.prefix) && value.find('\\') != std::string_view::npos) {
    throw path_error("ERR_INVALID_PATH", "Windows canonical components cannot contain a literal backslash");
  }
  return result;
}

std::string lowercase_drive(std::string_view value) {
  std::string result(value);
  if (has_drive_root(value)) result[0] = to_lower_ascii(result[0]);
  else if (starts_with(value, "//?/") && has_drive_root(value.substr(4))) result[4] = to_lower_ascii(result[4]);
  return result;
}

bool needs_relative_marker(std::string_view value) {
  return value.size() >= 2 && is_ascii_letter(value[0]) && value[1] == ':';
}
std::string mark_relative(std::string_view value) { return needs_relative_marker(value) ? "./" + std::string(value) : std::string(value); }
bool has_relative_marker(std::string_view value) { return starts_with(value, "./") && needs_relative_marker(value.substr(2)); }
std::string_view without_relative_marker(std::string_view value) { return has_relative_marker(value) ? value.substr(2) : value; }

std::string prepare_native_posix(std::string_view value) {
  std::size_t leading = 0;
  while (leading < value.size() && value[leading] == '/') ++leading;
  if (leading == 2) throw path_error("ERR_INVALID_PATH", "native POSIX paths with exactly two leading slashes are unsupported");
  if (leading > 2) return "/" + std::string(value.substr(leading));
  return mark_relative(value);
}

std::vector<std::string_view> split_slash_views(std::string_view value) {
  std::vector<std::string_view> parts;
  std::size_t start = 0;
  while (start <= value.size()) {
    std::size_t slash = value.find('/', start);
    if (slash == std::string_view::npos) {
      parts.push_back(value.substr(start));
      break;
    }
    parts.push_back(value.substr(start, slash - start));
    start = slash + 1;
  }
  return parts;
}

std::string clean_canonical(std::string_view value) {
  if (value.empty()) throw path_error("ERR_EMPTY_PATH", "path is empty");
  if (value.find('\0') != std::string_view::npos) throw path_error("ERR_NUL_BYTE", "path contains NUL");
  SplitRoot root = split_root(value);
  root.prefix = lowercase_drive(root.prefix);
  std::vector<std::string> parts;
  for (std::string_view part : split_slash_views(root.rest)) {
    if (part.empty() || part == ".") continue;
    if (part == "..") {
      if (!parts.empty()) {
        parts.pop_back();
        continue;
      }
      if (!root.prefix.empty()) continue;
      throw path_error("ERR_INVALID_PATH", "relative path escapes above its root");
    }
    parts.emplace_back(part);
  }

  std::string joined;
  for (std::size_t i = 0; i < parts.size(); ++i) {
    if (i > 0) joined.push_back('/');
    joined += parts[i];
  }
  if (root.prefix.empty()) return joined.empty() ? "." : mark_relative(joined);
  if (root.prefix == "/") return joined.empty() ? "/" : "/" + joined;
  if (!root.prefix.empty() && root.prefix.back() == '/') {
    return joined.empty() ? root.prefix : root.prefix + joined;
  }
  return joined.empty() ? root.prefix : root.prefix + "/" + joined;
}

std::string clean_native_posix(std::string_view value) { return clean_canonical(prepare_native_posix(value)); }

std::string normalize_mount_root(std::string_view value) {
  if (value.find('\0') != std::string_view::npos) throw path_error("ERR_NUL_BYTE", "WSL mount root contains NUL");
  if (value.empty()) value = "/mnt";
  if (!starts_with(value, "/")) throw path_error("ERR_INVALID_PATH", "WSL mount root must be an absolute native POSIX path");
  return clean_native_posix(value);
}

SplitRoot parse_clean_canonical(std::string_view value) {
  if (clean_canonical(value) != lowercase_drive(value)) throw path_error("ERR_INVALID_PATH", "path is not lexically cleaned canonical input");
  SplitRoot root = split_root(value);
  if (root.prefix.empty()) root.rest = root.rest == "." ? "" : std::string(without_relative_marker(root.rest));
  return root;
}

void validate_target_profile(std::string_view value, std::string_view target_profile) {
  SplitRoot root = split_root(value);
  if (target_profile.empty() || target_profile == "portable") return;
  if (target_profile == "posix" && !is_windows_root(root.prefix)) return;
  if (target_profile == "win32-drive" && root.prefix != "/" && (!is_windows_root(root.prefix) || is_drive_root(root.prefix))) return;
  throw path_error("ERR_INVALID_PATH", "unsupported targetProfile or root kind");
}

bool is_reserved_device_base(std::string_view base) {
  std::string upper = to_upper_ascii(base);
  if (upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL") return true;
  if (upper.size() == 4 && (upper.substr(0, 3) == "COM" || upper.substr(0, 3) == "LPT") &&
      upper[3] >= '1' && upper[3] <= '9') {
    return true;
  }
  return false;
}

bool has_windows_ads(std::string_view value) {
  try { return split_root(value).rest.find(':') != std::string::npos; }
  catch (const path_error &) { return false; }
}

bool has_reserved_device_name(std::string_view value) {
  std::string rest;
  try {
    rest = split_root(value).rest;
  } catch (const path_error &) {
    return false;
  }
  for (std::string_view part : split_slash_views(rest)) {
    if (part.empty() || part == "." || part == "..") continue;
    std::size_t dot = part.find_first_of(".:");
    std::string_view base = dot == std::string_view::npos ? part : part.substr(0, dot);
    if (is_reserved_device_base(base)) return true;
  }
  return false;
}

std::vector<std::string> canonical_parts(std::string_view value, std::string *prefix) {
  SplitRoot root = parse_clean_canonical(value);
  if (root.prefix.empty()) throw path_error("ERR_INVALID_PATH", "path must be canonical absolute");
  *prefix = root.prefix;
  std::vector<std::string> result;
  if (!root.rest.empty()) for (std::string_view part : split_slash_views(root.rest)) result.emplace_back(part);
  return result;
}

std::string normalize_canonical_relative(std::string_view raw) {
  if (raw.empty()) throw path_error("ERR_EMPTY_PATH", "relative path is empty");
  if (raw == ".") return ".";
  if (raw.find('\0') != std::string_view::npos) throw path_error("ERR_NUL_BYTE", "relative path contains NUL");
  if (starts_with(raw, "/") || has_drive_root(raw)) throw path_error("ERR_ABSOLUTE_PATH", "relative path must not be absolute");
  if (is_drive_relative(raw)) throw path_error("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed");

  std::vector<std::string> parts;
  for (std::string_view part : split_slash_views(raw)) {
    if (part.empty() || part == ".") continue;
    if (part == "..") {
      if (parts.empty()) throw path_error("ERR_OUTSIDE_ROOT", "relative path escapes root");
      parts.pop_back();
      continue;
    }
    parts.emplace_back(part);
  }
  if (parts.empty()) return ".";
  std::string joined;
  for (std::size_t i = 0; i < parts.size(); ++i) {
    if (i > 0) joined.push_back('/');
    joined += parts[i];
  }
  return mark_relative(joined);
}

std::string trim_component_edges(std::string value) {
  auto is_trimmed = [](char ch) { return ch == ' ' || ch == '.' || ch == '_' || ch == '-'; };
  std::size_t start = 0;
  while (start < value.size() && is_trimmed(value[start])) ++start;
  std::size_t end = value.size();
  while (end > start && is_trimmed(value[end - 1])) --end;
  return value.substr(start, end - start);
}

std::string escape_reserved_win32_component(std::string value) {
  std::size_t dot = value.find('.');
  std::string base = dot == std::string::npos ? value : value.substr(0, dot);
  std::string suffix = dot == std::string::npos ? "" : value.substr(dot);
  if (is_reserved_device_base(base)) return base + "-" + suffix;
  return value;
}

uint32_t rotate_right(uint32_t value, uint32_t count) {
  return (value >> count) | (value << (32 - count));
}

std::string sha256_hex(std::string_view input) {
  static constexpr std::array<uint32_t, 64> k = {
      0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
      0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
      0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
      0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
      0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
      0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
      0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
      0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U, 0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
  };

  std::vector<uint8_t> data(input.begin(), input.end());
  uint64_t bit_length = static_cast<uint64_t>(data.size()) * 8U;
  data.push_back(0x80U);
  while ((data.size() % 64U) != 56U) data.push_back(0U);
  for (int shift = 56; shift >= 0; shift -= 8) data.push_back(static_cast<uint8_t>((bit_length >> shift) & 0xffU));

  uint32_t h0 = 0x6a09e667U;
  uint32_t h1 = 0xbb67ae85U;
  uint32_t h2 = 0x3c6ef372U;
  uint32_t h3 = 0xa54ff53aU;
  uint32_t h4 = 0x510e527fU;
  uint32_t h5 = 0x9b05688cU;
  uint32_t h6 = 0x1f83d9abU;
  uint32_t h7 = 0x5be0cd19U;

  for (std::size_t chunk = 0; chunk < data.size(); chunk += 64) {
    std::array<uint32_t, 64> w{};
    for (std::size_t i = 0; i < 16; ++i) {
      std::size_t j = chunk + i * 4;
      w[i] = (static_cast<uint32_t>(data[j]) << 24) | (static_cast<uint32_t>(data[j + 1]) << 16) |
             (static_cast<uint32_t>(data[j + 2]) << 8) | static_cast<uint32_t>(data[j + 3]);
    }
    for (std::size_t i = 16; i < 64; ++i) {
      uint32_t s0 = rotate_right(w[i - 15], 7) ^ rotate_right(w[i - 15], 18) ^ (w[i - 15] >> 3);
      uint32_t s1 = rotate_right(w[i - 2], 17) ^ rotate_right(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    uint32_t a = h0;
    uint32_t b = h1;
    uint32_t c = h2;
    uint32_t d = h3;
    uint32_t e = h4;
    uint32_t f = h5;
    uint32_t g = h6;
    uint32_t h = h7;

    for (std::size_t i = 0; i < 64; ++i) {
      uint32_t s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
      uint32_t ch = (e & f) ^ ((~e) & g);
      uint32_t temp1 = h + s1 + ch + k[i] + w[i];
      uint32_t s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
      uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
      uint32_t temp2 = s0 + maj;
      h = g;
      g = f;
      f = e;
      e = d + temp1;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2;
    }

    h0 += a;
    h1 += b;
    h2 += c;
    h3 += d;
    h4 += e;
    h5 += f;
    h6 += g;
    h7 += h;
  }

  std::ostringstream out;
  out << std::hex << std::setfill('0');
  for (uint32_t value : {h0, h1, h2, h3, h4, h5, h6, h7}) out << std::setw(8) << value;
  return out.str();
}

} // namespace

path_error::path_error(std::string code, std::string message) : std::runtime_error(message), code_(std::move(code)) {}

const std::string &path_error::code() const noexcept { return code_; }

std::string normalize(std::string_view raw, NormalizeOptions options) {
  std::string value(raw);
  if (options.trim_outer_whitespace) value = trim_outer_ascii_whitespace(value);
  if (value.empty()) throw path_error("ERR_EMPTY_PATH", "path is empty");
  if (value.find('\0') != std::string::npos) throw path_error("ERR_NUL_BYTE", "path contains NUL");
  options.wsl.mount_root = normalize_mount_root(options.wsl.mount_root);
  if (options.source_host == "posix" && options.wsl.enabled) throw path_error("ERR_INVALID_PATH", "native POSIX input cannot request WSL drive mapping");
  if (options.source_host == "posix") {
    value = prepare_native_posix(value);
  } else if (options.source_host != "canonical") {
    const bool uri_input = has_uri_scheme(value);
    if (uri_input || options.source_host == "vscode-file-uri") value = parse_file_uri(value, options);
    if (options.wsl.enabled && starts_with(value, "/") && (!starts_with(value, "//") || starts_with(value, "///")) && !(uri_input && is_uri_windows_drive_path(value))) {
      value = prepare_native_posix(value);
      if (options.windows.reject_ads && has_windows_ads(value)) throw path_error("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
      if (options.windows.reject_device_names && has_reserved_device_name(value)) throw path_error("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
      value = clean_canonical(value);
      if (options.target_profile != "posix") value = map_wsl_drive(value, options.wsl);
    } else {
      value = replace_char(value, '\\', '/');
      if (starts_with(value, "//?/")) split_root(value);
      if (!options.windows.preserve_extended_length) value = unwrap_windows_extended_prefix(value);
      if (is_uri_windows_drive_path(value)) value = value.substr(1);
    }
  }
  split_root(value);
  if (options.windows.reject_ads && has_windows_ads(value)) throw path_error("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
  if (options.windows.reject_device_names && has_reserved_device_name(value)) throw path_error("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
  std::string cleaned = clean_canonical(value);
  validate_target_profile(cleaned, options.target_profile);
  return cleaned;
}

std::string relative(std::string_view root, std::string_view target) {
  std::string root_prefix;
  std::string target_prefix;
  std::vector<std::string> root_parts = canonical_parts(root, &root_prefix);
  std::vector<std::string> target_parts = canonical_parts(target, &target_prefix);
  if (root_prefix != target_prefix || target_parts.size() < root_parts.size()) {
    throw path_error("ERR_OUTSIDE_ROOT", "target is outside root");
  }
  for (std::size_t i = 0; i < root_parts.size(); ++i) {
    if (target_parts[i] != root_parts[i]) throw path_error("ERR_OUTSIDE_ROOT", "target is outside root");
  }
  if (target_parts.size() == root_parts.size()) return ".";
  std::string result;
  for (std::size_t i = root_parts.size(); i < target_parts.size(); ++i) {
    if (!result.empty()) result.push_back('/');
    result += target_parts[i];
  }
  return mark_relative(result);
}

std::string join(std::string_view root, std::string_view relative_path) {
  SplitRoot parsed = parse_clean_canonical(root);
  if (is_windows_root(parsed.prefix) && relative_path.find('\\') != std::string_view::npos) throw path_error("ERR_INVALID_PATH", "Windows canonical components cannot contain a literal backslash");
  const std::string clean_relative = normalize_canonical_relative(relative_path);
  if (clean_relative == ".") return std::string(root);
  const std::string relative(without_relative_marker(clean_relative));
  if (parsed.prefix.empty()) return mark_relative(parsed.rest.empty() ? relative : parsed.rest + "/" + relative);
  return std::string(root) + (root.back() == '/' ? "" : "/") + relative;
}

std::string join(std::initializer_list<std::string_view> parts) {
  std::string result;
  for (std::string_view part : parts) {
    if (part.empty()) continue;
    if (result.empty()) {
      parse_clean_canonical(part);
      result = std::string(part);
    } else {
      result = join(result, part);
    }
  }
  if (result.empty()) throw path_error("ERR_EMPTY_PATH", "join parts are empty");
  return result;
}

bool is_equal(std::string_view left, std::string_view right, NormalizeOptions options) {
  return normalize(left, options) == normalize(right, options);
}

std::string to_win32(std::string_view canonical) {
  SplitRoot root = parse_clean_canonical(canonical);
  if (root.prefix == "/" || canonical.find('\\') != std::string_view::npos || has_relative_marker(canonical)) throw path_error("ERR_INVALID_PATH", "canonical path has no lossless Windows representation");
  std::string value(canonical);
  if (has_drive_root(value)) value[0] = to_upper_ascii(value.substr(0, 1))[0];
  else if (starts_with(value, "//?/") && has_drive_root(std::string_view(value).substr(4))) value[4] = to_upper_ascii(value.substr(4, 1))[0];
  return replace_char(value, '/', '\\');
}

std::string to_wsl(std::string_view canonical, WslOptions options) {
  const std::string mount_root = normalize_mount_root(options.mount_root);
  SplitRoot root = parse_clean_canonical(canonical);
  if (is_windows_root(root.prefix) && !has_drive_root(root.prefix)) throw path_error("ERR_INVALID_PATH", "WSL mapping requires an ordinary Windows drive root");
  if (!has_drive_root(root.prefix)) return std::string(canonical);
  std::string result = trim_right_slashes(mount_root) + "/" + to_lower_ascii(canonical[0]);
  if (!root.rest.empty()) result += "/" + root.rest;
  return result;
}

std::string to_posix(std::string_view canonical) {
  SplitRoot root = parse_clean_canonical(canonical);
  if (is_windows_root(root.prefix)) throw path_error("ERR_INVALID_PATH", "Windows roots require an explicit host mapping");
  return std::string(canonical);
}

std::string sanitize_component(std::string_view name, std::string_view profile) {
  if (name.empty()) throw path_error("ERR_INVALID_COMPONENT", "component is empty");
  if (name.find('\0') != std::string_view::npos) throw path_error("ERR_NUL_BYTE", "component contains NUL");
  std::string value;
  bool in_replacement = false;
  for (char ch : name) {
    bool replace = ch == '/' || ch == '\\' || ch == ':' || ch == '\t' || ch == '\n' || ch == '\r';
    if (replace) {
      if (!in_replacement) value.push_back('-');
      in_replacement = true;
      continue;
    }
    value.push_back(ch);
    in_replacement = false;
  }
  value = trim_component_edges(value);
  if (value.empty()) value = "component";
  if (profile == "win32") value = escape_reserved_win32_component(value);
  return value;
}

std::string encode_component(std::string_view name, std::string_view profile) {
  return sanitize_component(name, profile);
}

std::string encode_git_ref(std::string_view raw) {
  if (raw.empty()) throw path_error("ERR_INVALID_COMPONENT", "git ref is empty");
  if (raw.find('\0') != std::string_view::npos) throw path_error("ERR_NUL_BYTE", "git ref contains NUL");
  if (!valid_utf8(raw)) throw path_error("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode");
  std::string slug;
  bool in_replacement = false;
  for (char ch : raw) {
    unsigned char code = static_cast<unsigned char>(ch);
    bool allowed = (code >= 'A' && code <= 'Z') || (code >= 'a' && code <= 'z') || (code >= '0' && code <= '9') || ch == '.' || ch == '_' || ch == '-';
    if (allowed) {
      slug.push_back(ch);
      in_replacement = false;
    } else if (!in_replacement) {
      slug.push_back('-');
      in_replacement = true;
    }
  }
  slug = trim_component_edges(trim_component_edges(slug).substr(0, 80));
  if (slug.empty()) slug = "ref";
  return "v2-" + slug + "--" + sha256_hex(raw);
}

} // namespace canonicalpath
