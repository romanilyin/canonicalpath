#include "canonicalpath.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct cp_string {
  char *data;
  size_t len;
} cp_string;

typedef struct cp_split_root {
  char *prefix;
  char *rest;
} cp_split_root;

typedef struct cp_string_vec {
  char **items;
  size_t len;
  size_t cap;
} cp_string_vec;

static canonicalpath_result cp_ok(char *value) {
  canonicalpath_result result;
  result.value = value;
  result.error_code = NULL;
  return result;
}

static canonicalpath_result cp_err(const char *code) {
  canonicalpath_result result;
  result.value = NULL;
  result.error_code = code;
  return result;
}

static canonicalpath_bool_result cp_bool_ok(int value) {
  canonicalpath_bool_result result;
  result.value = value;
  result.error_code = NULL;
  return result;
}

static canonicalpath_bool_result cp_bool_err(const char *code) {
  canonicalpath_bool_result result;
  result.value = 0;
  result.error_code = code;
  return result;
}

static char *cp_strndup(const char *value, size_t len) {
  char *result = (char *)malloc(len + 1);
  if (result == NULL) abort();
  if (len > 0 && value != NULL) memcpy(result, value, len);
  result[len] = '\0';
  return result;
}

static char *cp_strdup(const char *value) { return cp_strndup(value == NULL ? "" : value, strlen(value == NULL ? "" : value)); }

static int cp_has_nul(const char *value, size_t len) { return len > 0 && memchr(value, '\0', len) != NULL; }

static int cp_is_ascii_letter(char ch) {
  unsigned char code = (unsigned char)ch;
  return (code >= 'A' && code <= 'Z') || (code >= 'a' && code <= 'z');
}

static int cp_is_ascii_alnum(char ch) {
  unsigned char code = (unsigned char)ch;
  return (code >= 'A' && code <= 'Z') || (code >= 'a' && code <= 'z') || (code >= '0' && code <= '9');
}

static char cp_lower_ascii(char ch) { return (ch >= 'A' && ch <= 'Z') ? (char)(ch + ('a' - 'A')) : ch; }

static char cp_upper_ascii(char ch) { return (ch >= 'a' && ch <= 'z') ? (char)(ch - ('a' - 'A')) : ch; }

static int cp_starts_with(const char *value, const char *prefix) {
  return strncmp(value, prefix, strlen(prefix)) == 0;
}

static int cp_equals(const char *left, const char *right) { return strcmp(left == NULL ? "" : left, right) == 0; }

static int cp_has_drive_root(const char *value) {
  return strlen(value) >= 3 && cp_is_ascii_letter(value[0]) && value[1] == ':' && value[2] == '/';
}

static int cp_is_drive_relative(const char *value) {
  size_t len = strlen(value);
  return len >= 2 && cp_is_ascii_letter(value[0]) && value[1] == ':' && (len == 2 || value[2] != '/');
}

static int cp_is_uri_windows_drive_path(const char *value) {
  return strlen(value) >= 4 && value[0] == '/' && cp_is_ascii_letter(value[1]) && value[2] == ':' && value[3] == '/';
}

static char *cp_trim_right_slashes(char *value) {
  size_t len = strlen(value);
  while (len > 0 && value[len - 1] == '/') {
    value[--len] = '\0';
  }
  return value;
}

static char *cp_trim_outer_ascii_whitespace(const char *value, size_t len) {
  size_t start = 0;
  while (start < len && (value[start] == ' ' || value[start] == '\t' || value[start] == '\n' ||
                         value[start] == '\r' || value[start] == '\f' || value[start] == '\v')) {
    ++start;
  }
  size_t end = len;
  while (end > start && (value[end - 1] == ' ' || value[end - 1] == '\t' || value[end - 1] == '\n' ||
                         value[end - 1] == '\r' || value[end - 1] == '\f' || value[end - 1] == '\v')) {
    --end;
  }
  return cp_strndup(value + start, end - start);
}

static int cp_has_uri_scheme(const char *value) {
  const char *scheme_end = strstr(value, "://");
  if (scheme_end == NULL || scheme_end == value) return 0;
  if (!cp_is_ascii_letter(value[0])) return 0;
  for (const char *cursor = value + 1; cursor < scheme_end; ++cursor) {
    if (!cp_is_ascii_alnum(*cursor) && *cursor != '+' && *cursor != '.' && *cursor != '-') return 0;
  }
  return 1;
}

static char *cp_unwrap_windows_extended_prefix(const char *value) {
  if (cp_starts_with(value, "\\\\?\\UNC\\")) {
    size_t rest_len = strlen(value + 8);
    char *result = (char *)malloc(rest_len + 3);
    if (result == NULL) abort();
    result[0] = '\\';
    result[1] = '\\';
    memcpy(result + 2, value + 8, rest_len + 1);
    return result;
  }
  if (cp_starts_with(value, "\\\\?\\")) return cp_strdup(value + 4);
  return cp_strdup(value);
}

static char *cp_replace_char(const char *value, char from, char to) {
  char *result = cp_strdup(value);
  for (char *cursor = result; *cursor != '\0'; ++cursor) {
    if (*cursor == from) *cursor = to;
  }
  return result;
}

static int cp_hex_value(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

static const char *cp_percent_decode(const char *value, size_t len, cp_string *out) {
  char *result = (char *)malloc(len + 1);
  if (result == NULL) abort();
  size_t write = 0;
  for (size_t read = 0; read < len; ++read) {
    if (value[read] != '%') {
      result[write++] = value[read];
      continue;
    }
    if (read + 2 >= len) {
      free(result);
      return "ERR_INVALID_PERCENT_ENCODING";
    }
    int high = cp_hex_value(value[read + 1]);
    int low = cp_hex_value(value[read + 2]);
    if (high < 0 || low < 0) {
      free(result);
      return "ERR_INVALID_PERCENT_ENCODING";
    }
    result[write++] = (char)((high << 4) | low);
    read += 2;
  }
  result[write] = '\0';
  out->data = result;
  out->len = write;
  return NULL;
}

static int cp_has_encoded_separator(const char *value) {
  size_t len = strlen(value);
  for (size_t i = 0; i + 2 < len; ++i) {
    if (value[i] != '%') continue;
    char low = cp_lower_ascii(value[i + 2]);
    if (value[i + 1] == '2' && low == 'f') return 1;
    if (value[i + 1] == '5' && low == 'c') return 1;
  }
  return 0;
}

static char *cp_lower_ascii_string(const char *value) {
  char *result = cp_strdup(value);
  for (char *cursor = result; *cursor != '\0'; ++cursor) *cursor = cp_lower_ascii(*cursor);
  return result;
}

static const char *cp_parse_hierarchical_uri_path(const char *raw, const char *prefix,
                                                  const canonicalpath_normalize_options *options, cp_string *out) {
  if (options->uri.reject_encoded_slash && cp_has_encoded_separator(raw)) return "ERR_ENCODED_SEPARATOR";

  const char *rest = raw + strlen(prefix);
  const char *slash = strchr(rest, '/');
  if (slash == NULL) return "ERR_INVALID_URI";

  cp_string authority = {0};
  cp_string decoded = {0};
  const char *error = cp_percent_decode(rest, (size_t)(slash - rest), &authority);
  if (error != NULL) return error;
  error = cp_percent_decode(slash, strlen(slash), &decoded);
  if (error != NULL) {
    free(authority.data);
    return error;
  }
  if (decoded.len == 0) {
    free(authority.data);
    free(decoded.data);
    return "ERR_INVALID_URI";
  }

  if (strcmp(prefix, "file://") == 0 && authority.len > 0) {
    char *authority_lower = cp_lower_ascii_string(authority.data);
    int is_localhost = strcmp(authority_lower, "localhost") == 0;
    free(authority_lower);
    if (!is_localhost) {
      char *result = (char *)malloc(2 + authority.len + decoded.len + 1);
      if (result == NULL) abort();
      result[0] = '/';
      result[1] = '/';
      memcpy(result + 2, authority.data, authority.len);
      memcpy(result + 2 + authority.len, decoded.data, decoded.len);
      result[2 + authority.len + decoded.len] = '\0';
      out->data = result;
      out->len = 2 + authority.len + decoded.len;
      free(authority.data);
      free(decoded.data);
      return NULL;
    }
  }

  free(authority.data);
  out->data = decoded.data;
  out->len = decoded.len;
  return NULL;
}

static const char *cp_parse_file_uri(cp_string input, const canonicalpath_normalize_options *options, cp_string *out) {
  if (cp_has_nul(input.data, input.len)) return "ERR_NUL_BYTE";
  if (cp_starts_with(input.data, "file://")) {
    if (!options->uri.allow_file_uri) return "ERR_UNSUPPORTED_URI_SCHEME";
    return cp_parse_hierarchical_uri_path(input.data, "file://", options, out);
  }
  if (cp_starts_with(input.data, "vscode-file://")) {
    if (!options->uri.allow_vscode_file_uri) return "ERR_UNSUPPORTED_URI_SCHEME";
    return cp_parse_hierarchical_uri_path(input.data, "vscode-file://", options, out);
  }
  if (cp_has_uri_scheme(input.data)) return "ERR_UNSUPPORTED_URI_SCHEME";
  out->data = cp_strndup(input.data, input.len);
  out->len = input.len;
  return NULL;
}

static char *cp_map_wsl_drive(const char *value, const canonicalpath_wsl_options *options) {
  if (!options->enabled) return cp_strdup(value);
  char *mount_root = cp_strdup(options->mount_root == NULL || options->mount_root[0] == '\0' ? "/mnt" : options->mount_root);
  cp_trim_right_slashes(mount_root);

  size_t mount_len = strlen(mount_root);
  char *prefix = (char *)malloc(mount_len + 2);
  if (prefix == NULL) abort();
  memcpy(prefix, mount_root, mount_len);
  prefix[mount_len] = '/';
  prefix[mount_len + 1] = '\0';
  free(mount_root);

  if (!cp_starts_with(value, prefix)) {
    free(prefix);
    return cp_strdup(value);
  }

  const char *rest = value + strlen(prefix);
  free(prefix);
  size_t rest_len = strlen(rest);
  if (rest_len == 0 || !cp_is_ascii_letter(rest[0])) return cp_strdup(value);
  if (rest_len > 1 && rest[1] != '/') return cp_strdup(value);

  char *result = (char *)malloc(rest_len + 3);
  if (result == NULL) abort();
  result[0] = cp_lower_ascii(rest[0]);
  result[1] = ':';
  result[2] = '/';
  if (rest_len > 1) memcpy(result + 3, rest + 2, rest_len - 1);
  else result[3] = '\0';
  if (rest_len > 1) result[rest_len + 1] = '\0';
  return result;
}

static void cp_split_root_free(cp_split_root *root) {
  free(root->prefix);
  free(root->rest);
  root->prefix = NULL;
  root->rest = NULL;
}

static const char *cp_split_root_parse(const char *value, cp_split_root *out) {
  if (cp_has_drive_root(value)) {
    out->prefix = cp_strndup(value, 3);
    out->rest = cp_strdup(value + 3);
    return NULL;
  }
  if (cp_starts_with(value, "//")) {
    const char *rest = value + 2;
    const char *first = strchr(rest, '/');
    if (first == NULL || first == rest) return "ERR_INVALID_PATH";
    const char *second = strchr(first + 1, '/');
    size_t server_len = (size_t)(first - rest);
    size_t share_len = second == NULL ? strlen(first + 1) : (size_t)(second - (first + 1));
    if (share_len == 0) return "ERR_INVALID_PATH";
    out->prefix = (char *)malloc(2 + server_len + 1 + share_len + 1);
    if (out->prefix == NULL) abort();
    out->prefix[0] = '/';
    out->prefix[1] = '/';
    memcpy(out->prefix + 2, rest, server_len);
    out->prefix[2 + server_len] = '/';
    memcpy(out->prefix + 3 + server_len, first + 1, share_len);
    out->prefix[3 + server_len + share_len] = '\0';
    out->rest = second == NULL ? cp_strdup("") : cp_strdup(second + 1);
    return NULL;
  }
  if (value[0] == '/') {
    out->prefix = cp_strdup("/");
    out->rest = cp_strdup(value + 1);
    return NULL;
  }
  out->prefix = cp_strdup("");
  out->rest = cp_strdup(value);
  return NULL;
}

static void cp_vec_init(cp_string_vec *vec) {
  vec->items = NULL;
  vec->len = 0;
  vec->cap = 0;
}

static void cp_vec_free(cp_string_vec *vec) {
  for (size_t i = 0; i < vec->len; ++i) free(vec->items[i]);
  free(vec->items);
  vec->items = NULL;
  vec->len = 0;
  vec->cap = 0;
}

static void cp_vec_push(cp_string_vec *vec, const char *value, size_t len) {
  if (vec->len == vec->cap) {
    size_t new_cap = vec->cap == 0 ? 8 : vec->cap * 2;
    char **new_items = (char **)realloc(vec->items, new_cap * sizeof(char *));
    if (new_items == NULL) abort();
    vec->items = new_items;
    vec->cap = new_cap;
  }
  vec->items[vec->len++] = cp_strndup(value, len);
}

static void cp_vec_pop(cp_string_vec *vec) {
  if (vec->len == 0) return;
  free(vec->items[--vec->len]);
  vec->items[vec->len] = NULL;
}

static char *cp_join_parts_range(cp_string_vec *vec, size_t start) {
  size_t total = 0;
  for (size_t i = start; i < vec->len; ++i) total += strlen(vec->items[i]) + (i > start ? 1 : 0);
  char *result = (char *)malloc(total + 1);
  if (result == NULL) abort();
  size_t offset = 0;
  for (size_t i = start; i < vec->len; ++i) {
    if (i > start) result[offset++] = '/';
    size_t len = strlen(vec->items[i]);
    memcpy(result + offset, vec->items[i], len);
    offset += len;
  }
  result[offset] = '\0';
  return result;
}

static const char *cp_clean_canonical(const char *value, char **out) {
  if (value[0] == '\0') return "ERR_EMPTY_PATH";
  cp_split_root root = {0};
  const char *error = cp_split_root_parse(value, &root);
  if (error != NULL) return error;

  cp_string_vec parts;
  cp_vec_init(&parts);
  const char *cursor = root.rest;
  while (1) {
    const char *slash = strchr(cursor, '/');
    size_t len = slash == NULL ? strlen(cursor) : (size_t)(slash - cursor);
    if (len == 0 || (len == 1 && cursor[0] == '.')) {
    } else if (len == 2 && cursor[0] == '.' && cursor[1] == '.') {
      if (parts.len > 0) cp_vec_pop(&parts);
      else if (root.prefix[0] == '\0') {
        cp_vec_free(&parts);
        cp_split_root_free(&root);
        return "ERR_INVALID_PATH";
      }
    } else {
      cp_vec_push(&parts, cursor, len);
    }
    if (slash == NULL) break;
    cursor = slash + 1;
  }

  char *joined = cp_join_parts_range(&parts, 0);
  size_t prefix_len = strlen(root.prefix);
  size_t joined_len = strlen(joined);
  if (prefix_len == 0) {
    *out = joined_len == 0 ? cp_strdup(".") : cp_strdup(joined);
  } else if (strcmp(root.prefix, "/") == 0) {
    if (joined_len == 0) *out = cp_strdup("/");
    else {
      *out = (char *)malloc(joined_len + 2);
      if (*out == NULL) abort();
      (*out)[0] = '/';
      memcpy(*out + 1, joined, joined_len + 1);
    }
  } else if (root.prefix[prefix_len - 1] == '/') {
    if (joined_len == 0) *out = cp_strdup(root.prefix);
    else {
      *out = (char *)malloc(prefix_len + joined_len + 1);
      if (*out == NULL) abort();
      memcpy(*out, root.prefix, prefix_len);
      memcpy(*out + prefix_len, joined, joined_len + 1);
    }
  } else {
    if (joined_len == 0) *out = cp_strdup(root.prefix);
    else {
      *out = (char *)malloc(prefix_len + 1 + joined_len + 1);
      if (*out == NULL) abort();
      memcpy(*out, root.prefix, prefix_len);
      (*out)[prefix_len] = '/';
      memcpy(*out + prefix_len + 1, joined, joined_len + 1);
    }
  }

  free(joined);
  cp_vec_free(&parts);
  cp_split_root_free(&root);
  return NULL;
}

static const char *cp_validate_target_profile(const char *value, const char *target_profile) {
  if (target_profile == NULL || target_profile[0] == '\0' || strcmp(target_profile, "portable") == 0) return NULL;
  if (strcmp(target_profile, "posix") == 0) {
    if (cp_has_drive_root(value) || cp_starts_with(value, "//")) return "ERR_INVALID_PATH";
    return NULL;
  }
  if (strcmp(target_profile, "win32-drive") == 0) {
    if (value[0] == '/') return "ERR_INVALID_PATH";
    return NULL;
  }
  return "ERR_INVALID_PATH";
}

static int cp_is_reserved_device_base(const char *base, size_t len) {
  char upper[5];
  if (len > 4) return 0;
  for (size_t i = 0; i < len; ++i) upper[i] = cp_upper_ascii(base[i]);
  upper[len] = '\0';
  if (strcmp(upper, "CON") == 0 || strcmp(upper, "PRN") == 0 || strcmp(upper, "AUX") == 0 ||
      strcmp(upper, "NUL") == 0) {
    return 1;
  }
  return len == 4 && (strncmp(upper, "COM", 3) == 0 || strncmp(upper, "LPT", 3) == 0) &&
         upper[3] >= '1' && upper[3] <= '9';
}

static int cp_has_windows_ads(const char *value) {
  size_t start = 0;
  if (cp_has_drive_root(value)) start = 3;
  else if (cp_starts_with(value, "//")) {
    cp_split_root root = {0};
    if (cp_split_root_parse(value, &root) == NULL) {
      start = strlen(root.prefix);
      cp_split_root_free(&root);
    }
  }
  return strchr(value + start, ':') != NULL;
}

static int cp_has_reserved_device_name(const char *value) {
  cp_split_root root = {0};
  if (cp_split_root_parse(value, &root) != NULL) return 0;
  const char *cursor = root.rest;
  while (1) {
    const char *slash = strchr(cursor, '/');
    size_t len = slash == NULL ? strlen(cursor) : (size_t)(slash - cursor);
    if (len > 0 && !(len == 1 && cursor[0] == '.') && !(len == 2 && cursor[0] == '.' && cursor[1] == '.')) {
      size_t base_len = len;
      for (size_t i = 0; i < len; ++i) {
        if (cursor[i] == '.' || cursor[i] == ':') {
          base_len = i;
          break;
        }
      }
      if (cp_is_reserved_device_base(cursor, base_len)) {
        cp_split_root_free(&root);
        return 1;
      }
    }
    if (slash == NULL) break;
    cursor = slash + 1;
  }
  cp_split_root_free(&root);
  return 0;
}

static const char *cp_canonical_parts(const char *value, char **prefix, cp_string_vec *parts) {
  if (cp_has_nul(value, strlen(value))) return "ERR_NUL_BYTE";
  cp_split_root root = {0};
  const char *error = cp_split_root_parse(value, &root);
  if (error != NULL) return error;
  if (root.prefix[0] == '\0') {
    cp_split_root_free(&root);
    return "ERR_INVALID_PATH";
  }
  const char *cursor = root.rest;
  while (1) {
    const char *slash = strchr(cursor, '/');
    size_t len = slash == NULL ? strlen(cursor) : (size_t)(slash - cursor);
    if (len > 0) {
      if ((len == 1 && cursor[0] == '.') || (len == 2 && cursor[0] == '.' && cursor[1] == '.')) {
        cp_split_root_free(&root);
        return "ERR_INVALID_PATH";
      }
      cp_vec_push(parts, cursor, len);
    }
    if (slash == NULL) break;
    cursor = slash + 1;
  }
  *prefix = root.prefix;
  free(root.rest);
  return NULL;
}

static int cp_is_absolute_path_like(const char *value) {
  if (value[0] == '/' || cp_starts_with(value, "\\\\")) return 1;
  char *slash = cp_replace_char(value, '\\', '/');
  int result = cp_has_drive_root(slash);
  free(slash);
  return result;
}

static const char *cp_normalize_relative(const char *raw, char **out) {
  if (raw[0] == '\0') return "ERR_EMPTY_PATH";
  if (strcmp(raw, ".") == 0) {
    *out = cp_strdup(".");
    return NULL;
  }
  if (cp_has_nul(raw, strlen(raw))) return "ERR_NUL_BYTE";
  if (cp_is_absolute_path_like(raw)) return "ERR_ABSOLUTE_PATH";
  if (cp_is_drive_relative(raw)) return "ERR_DRIVE_RELATIVE_PATH";
  if (strchr(raw, '\\') != NULL) return "ERR_INVALID_PATH";

  cp_string_vec parts;
  cp_vec_init(&parts);
  const char *cursor = raw;
  while (1) {
    const char *slash = strchr(cursor, '/');
    size_t len = slash == NULL ? strlen(cursor) : (size_t)(slash - cursor);
    if (len == 0 || (len == 1 && cursor[0] == '.')) {
    } else if (len == 2 && cursor[0] == '.' && cursor[1] == '.') {
      if (parts.len == 0) {
        cp_vec_free(&parts);
        return "ERR_OUTSIDE_ROOT";
      }
      cp_vec_pop(&parts);
    } else {
      cp_vec_push(&parts, cursor, len);
    }
    if (slash == NULL) break;
    cursor = slash + 1;
  }
  if (parts.len == 0) {
    cp_vec_free(&parts);
    return "ERR_EMPTY_PATH";
  }
  *out = cp_join_parts_range(&parts, 0);
  cp_vec_free(&parts);
  return NULL;
}

static char *cp_trim_component_edges(const char *value) {
  size_t len = strlen(value);
  size_t start = 0;
  while (start < len && (value[start] == ' ' || value[start] == '.' || value[start] == '_' || value[start] == '-')) ++start;
  size_t end = len;
  while (end > start && (value[end - 1] == ' ' || value[end - 1] == '.' || value[end - 1] == '_' ||
                         value[end - 1] == '-')) {
    --end;
  }
  return cp_strndup(value + start, end - start);
}

static char *cp_escape_reserved_win32_component(const char *value) {
  const char *dot = strchr(value, '.');
  size_t base_len = dot == NULL ? strlen(value) : (size_t)(dot - value);
  if (!cp_is_reserved_device_base(value, base_len)) return cp_strdup(value);
  size_t suffix_len = dot == NULL ? 0 : strlen(dot);
  char *result = (char *)malloc(base_len + 1 + suffix_len + 1);
  if (result == NULL) abort();
  memcpy(result, value, base_len);
  result[base_len] = '-';
  if (suffix_len > 0) memcpy(result + base_len + 1, dot, suffix_len);
  result[base_len + 1 + suffix_len] = '\0';
  return result;
}

static uint32_t cp_rotr(uint32_t value, uint32_t count) { return (value >> count) | (value << (32 - count)); }

static char *cp_sha256_hex(const unsigned char *input, size_t input_len) {
  static const uint32_t k[64] = {
      0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U, 0x923f82a4U,
      0xab1c5ed5U, 0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU,
      0x9bdc06a7U, 0xc19bf174U, 0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU,
      0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU, 0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
      0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U, 0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU,
      0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U, 0xa2bfe8a1U, 0xa81a664bU,
      0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U, 0x19a4c116U,
      0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
      0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U, 0x90befffaU, 0xa4506cebU, 0xbef9a3f7U,
      0xc67178f2U};

  uint64_t bit_len = (uint64_t)input_len * 8U;
  size_t data_len = input_len + 1;
  while ((data_len % 64U) != 56U) ++data_len;
  data_len += 8;
  unsigned char *data = (unsigned char *)calloc(data_len, 1);
  if (data == NULL) abort();
  memcpy(data, input, input_len);
  data[input_len] = 0x80U;
  for (int shift = 56; shift >= 0; shift -= 8) data[data_len - 8 + (56 - shift) / 8] = (unsigned char)((bit_len >> shift) & 0xffU);

  uint32_t h[8] = {0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
                   0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U};

  for (size_t chunk = 0; chunk < data_len; chunk += 64) {
    uint32_t w[64] = {0};
    for (size_t i = 0; i < 16; ++i) {
      size_t j = chunk + i * 4;
      w[i] = ((uint32_t)data[j] << 24) | ((uint32_t)data[j + 1] << 16) | ((uint32_t)data[j + 2] << 8) |
             (uint32_t)data[j + 3];
    }
    for (size_t i = 16; i < 64; ++i) {
      uint32_t s0 = cp_rotr(w[i - 15], 7) ^ cp_rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      uint32_t s1 = cp_rotr(w[i - 2], 17) ^ cp_rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (size_t i = 0; i < 64; ++i) {
      uint32_t s1 = cp_rotr(e, 6) ^ cp_rotr(e, 11) ^ cp_rotr(e, 25);
      uint32_t ch = (e & f) ^ ((~e) & g);
      uint32_t temp1 = hh + s1 + ch + k[i] + w[i];
      uint32_t s0 = cp_rotr(a, 2) ^ cp_rotr(a, 13) ^ cp_rotr(a, 22);
      uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
      uint32_t temp2 = s0 + maj;
      hh = g;
      g = f;
      f = e;
      e = d + temp1;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  free(data);

  char *hex = (char *)malloc(65);
  if (hex == NULL) abort();
  snprintf(hex, 65, "%08x%08x%08x%08x%08x%08x%08x%08x", h[0], h[1], h[2], h[3], h[4], h[5], h[6],
           h[7]);
  return hex;
}

void canonicalpath_normalize_options_init(canonicalpath_normalize_options *options) {
  memset(options, 0, sizeof(*options));
  options->wsl.mount_root = "/mnt";
  options->uri.reject_encoded_slash = 1;
}

void canonicalpath_result_free(canonicalpath_result *result) {
  if (result == NULL) return;
  free(result->value);
  result->value = NULL;
  result->error_code = NULL;
}

canonicalpath_result canonicalpath_normalize(const char *raw, const canonicalpath_normalize_options *options) {
  return canonicalpath_normalize_n(raw == NULL ? "" : raw, strlen(raw == NULL ? "" : raw), options);
}

canonicalpath_result canonicalpath_normalize_n(const char *raw, size_t raw_len,
                                               const canonicalpath_normalize_options *options) {
  canonicalpath_normalize_options defaults;
  if (options == NULL) {
    canonicalpath_normalize_options_init(&defaults);
    options = &defaults;
  }

  char *initial = options->trim_outer_whitespace ? cp_trim_outer_ascii_whitespace(raw, raw_len) : cp_strndup(raw, raw_len);
  cp_string value = {initial, strlen(initial)};
  if (value.len == 0) {
    free(value.data);
    return cp_err("ERR_EMPTY_PATH");
  }
  if (cp_has_nul(raw, raw_len)) {
    free(value.data);
    return cp_err("ERR_NUL_BYTE");
  }

  if (cp_has_uri_scheme(value.data) || cp_equals(options->source_host, "vscode-file-uri")) {
    cp_string parsed = {0};
    const char *error = cp_parse_file_uri(value, options, &parsed);
    free(value.data);
    if (error != NULL) return cp_err(error);
    value = parsed;
  }
  if (cp_has_nul(value.data, value.len)) {
    free(value.data);
    return cp_err("ERR_NUL_BYTE");
  }

  char *unwrapped = options->windows.preserve_extended_length ? cp_strdup(value.data) : cp_unwrap_windows_extended_prefix(value.data);
  free(value.data);
  char *slash = cp_replace_char(unwrapped, '\\', '/');
  free(unwrapped);

  if (!cp_equals(options->target_profile, "posix")) {
    char *mapped = cp_map_wsl_drive(slash, &options->wsl);
    free(slash);
    slash = mapped;
  }
  if (cp_is_uri_windows_drive_path(slash)) {
    char *trimmed = cp_strdup(slash + 1);
    free(slash);
    slash = trimmed;
  }
  if (cp_is_drive_relative(slash)) {
    free(slash);
    return cp_err("ERR_DRIVE_RELATIVE_PATH");
  }
  if (cp_has_drive_root(slash)) slash[0] = cp_lower_ascii(slash[0]);

  if (options->windows.reject_ads && cp_has_windows_ads(slash)) {
    free(slash);
    return cp_err("ERR_ALTERNATE_DATA_STREAM");
  }
  if (options->windows.reject_device_names && cp_has_reserved_device_name(slash)) {
    free(slash);
    return cp_err("ERR_RESERVED_DEVICE_NAME");
  }

  char *cleaned = NULL;
  const char *error = cp_clean_canonical(slash, &cleaned);
  free(slash);
  if (error != NULL) return cp_err(error);
  error = cp_validate_target_profile(cleaned, options->target_profile);
  if (error != NULL) {
    free(cleaned);
    return cp_err(error);
  }
  return cp_ok(cleaned);
}

canonicalpath_result canonicalpath_relative(const char *root, const char *target) {
  return canonicalpath_relative_n(root == NULL ? "" : root, strlen(root == NULL ? "" : root), target == NULL ? "" : target,
                                  strlen(target == NULL ? "" : target));
}

canonicalpath_result canonicalpath_relative_n(const char *root, size_t root_len, const char *target, size_t target_len) {
  if (cp_has_nul(root, root_len) || cp_has_nul(target, target_len)) return cp_err("ERR_NUL_BYTE");
  char *root_copy = cp_strndup(root, root_len);
  char *target_copy = cp_strndup(target, target_len);
  char *root_prefix = NULL;
  char *target_prefix = NULL;
  cp_string_vec root_parts;
  cp_string_vec target_parts;
  cp_vec_init(&root_parts);
  cp_vec_init(&target_parts);

  const char *error = cp_canonical_parts(root_copy, &root_prefix, &root_parts);
  if (error == NULL) error = cp_canonical_parts(target_copy, &target_prefix, &target_parts);
  free(root_copy);
  free(target_copy);
  if (error != NULL) {
    free(root_prefix);
    free(target_prefix);
    cp_vec_free(&root_parts);
    cp_vec_free(&target_parts);
    return cp_err(error);
  }
  if (strcmp(root_prefix, target_prefix) != 0 || target_parts.len < root_parts.len) error = "ERR_OUTSIDE_ROOT";
  for (size_t i = 0; error == NULL && i < root_parts.len; ++i) {
    if (strcmp(root_parts.items[i], target_parts.items[i]) != 0) error = "ERR_OUTSIDE_ROOT";
  }
  if (error != NULL) {
    free(root_prefix);
    free(target_prefix);
    cp_vec_free(&root_parts);
    cp_vec_free(&target_parts);
    return cp_err(error);
  }
  char *result = target_parts.len == root_parts.len ? cp_strdup(".") : cp_join_parts_range(&target_parts, root_parts.len);
  free(root_prefix);
  free(target_prefix);
  cp_vec_free(&root_parts);
  cp_vec_free(&target_parts);
  return cp_ok(result);
}

canonicalpath_result canonicalpath_join(const char *root, const char *relative_path) {
  return canonicalpath_join_n(root == NULL ? "" : root, strlen(root == NULL ? "" : root),
                              relative_path == NULL ? "" : relative_path, strlen(relative_path == NULL ? "" : relative_path));
}

canonicalpath_result canonicalpath_join_n(const char *root, size_t root_len, const char *relative_path,
                                         size_t relative_len) {
  if (cp_has_nul(root, root_len) || cp_has_nul(relative_path, relative_len)) return cp_err("ERR_NUL_BYTE");
  char *root_copy = cp_strndup(root, root_len);
  char *relative_copy = cp_strndup(relative_path, relative_len);
  char *clean_relative = NULL;
  const char *error = cp_normalize_relative(relative_copy, &clean_relative);
  free(relative_copy);
  if (error != NULL) {
    free(root_copy);
    return cp_err(error);
  }
  if (strcmp(clean_relative, ".") == 0) {
    free(clean_relative);
    return cp_ok(root_copy);
  }
  size_t root_copy_len = strlen(root_copy);
  size_t rel_len = strlen(clean_relative);
  int needs_slash = !(strcmp(root_copy, "/") == 0 || (root_copy_len > 0 && root_copy[root_copy_len - 1] == '/'));
  char *result = (char *)malloc(root_copy_len + (needs_slash ? 1 : 0) + rel_len + 1);
  if (result == NULL) abort();
  memcpy(result, root_copy, root_copy_len);
  size_t offset = root_copy_len;
  if (needs_slash) result[offset++] = '/';
  memcpy(result + offset, clean_relative, rel_len + 1);
  free(root_copy);
  free(clean_relative);
  return cp_ok(result);
}

canonicalpath_bool_result canonicalpath_is_equal(const char *left, const char *right,
                                                const canonicalpath_normalize_options *options) {
  return canonicalpath_is_equal_n(left == NULL ? "" : left, strlen(left == NULL ? "" : left), right == NULL ? "" : right,
                                  strlen(right == NULL ? "" : right), options);
}

canonicalpath_bool_result canonicalpath_is_equal_n(const char *left, size_t left_len, const char *right, size_t right_len,
                                                  const canonicalpath_normalize_options *options) {
  canonicalpath_result left_result = canonicalpath_normalize_n(left, left_len, options);
  if (left_result.error_code != NULL) return cp_bool_err(left_result.error_code);
  canonicalpath_result right_result = canonicalpath_normalize_n(right, right_len, options);
  if (right_result.error_code != NULL) {
    canonicalpath_result_free(&left_result);
    return cp_bool_err(right_result.error_code);
  }
  int equal = strcmp(left_result.value, right_result.value) == 0;
  canonicalpath_result_free(&left_result);
  canonicalpath_result_free(&right_result);
  return cp_bool_ok(equal);
}

canonicalpath_result canonicalpath_to_win32(const char *canonical) {
  return canonicalpath_to_win32_n(canonical == NULL ? "" : canonical, strlen(canonical == NULL ? "" : canonical));
}

canonicalpath_result canonicalpath_to_win32_n(const char *canonical, size_t canonical_len) {
  if (cp_has_nul(canonical, canonical_len)) return cp_err("ERR_NUL_BYTE");
  char *copy = cp_strndup(canonical, canonical_len);
  char *result = NULL;
  if (cp_has_drive_root(copy)) {
    char *rest = cp_replace_char(copy + 3, '/', '\\');
    size_t rest_len = strlen(rest);
    result = (char *)malloc(rest_len + 4);
    if (result == NULL) abort();
    result[0] = cp_upper_ascii(copy[0]);
    result[1] = ':';
    result[2] = '\\';
    memcpy(result + 3, rest, rest_len + 1);
    free(rest);
  } else if (cp_starts_with(copy, "//")) {
    char *rest = cp_replace_char(copy + 2, '/', '\\');
    size_t rest_len = strlen(rest);
    result = (char *)malloc(rest_len + 3);
    if (result == NULL) abort();
    result[0] = '\\';
    result[1] = '\\';
    memcpy(result + 2, rest, rest_len + 1);
    free(rest);
  } else {
    result = cp_replace_char(copy, '/', '\\');
  }
  free(copy);
  return cp_ok(result);
}

canonicalpath_result canonicalpath_to_wsl(const char *canonical, const canonicalpath_wsl_options *options) {
  return canonicalpath_to_wsl_n(canonical == NULL ? "" : canonical, strlen(canonical == NULL ? "" : canonical), options);
}

canonicalpath_result canonicalpath_to_wsl_n(const char *canonical, size_t canonical_len,
                                           const canonicalpath_wsl_options *options) {
  if (cp_has_nul(canonical, canonical_len)) return cp_err("ERR_NUL_BYTE");
  canonicalpath_wsl_options defaults = {0, "/mnt"};
  if (options == NULL) options = &defaults;
  char *copy = cp_strndup(canonical, canonical_len);
  if (!cp_has_drive_root(copy)) return cp_ok(copy);
  char *mount_root = cp_strdup(options->mount_root == NULL || options->mount_root[0] == '\0' ? "/mnt" : options->mount_root);
  cp_trim_right_slashes(mount_root);
  const char *rest = copy + 3;
  size_t mount_len = strlen(mount_root);
  size_t rest_len = strlen(rest);
  char *result = (char *)malloc(mount_len + 3 + (rest_len > 0 ? 1 + rest_len : 0) + 1);
  if (result == NULL) abort();
  memcpy(result, mount_root, mount_len);
  result[mount_len] = '/';
  result[mount_len + 1] = cp_lower_ascii(copy[0]);
  size_t offset = mount_len + 2;
  if (rest_len > 0) {
    result[offset++] = '/';
    memcpy(result + offset, rest, rest_len);
    offset += rest_len;
  }
  result[offset] = '\0';
  free(mount_root);
  free(copy);
  return cp_ok(result);
}

canonicalpath_result canonicalpath_to_posix(const char *canonical) {
  return canonicalpath_to_posix_n(canonical == NULL ? "" : canonical, strlen(canonical == NULL ? "" : canonical));
}

canonicalpath_result canonicalpath_to_posix_n(const char *canonical, size_t canonical_len) {
  if (cp_has_nul(canonical, canonical_len)) return cp_err("ERR_NUL_BYTE");
  char *copy = cp_strndup(canonical, canonical_len);
  if (cp_has_drive_root(copy)) {
    free(copy);
    return cp_err("ERR_INVALID_PATH");
  }
  if (strchr(copy, '\\') != NULL) {
    free(copy);
    return cp_err("ERR_INVALID_PATH");
  }
  return cp_ok(copy);
}

canonicalpath_result canonicalpath_sanitize_component(const char *name, const char *profile) {
  return canonicalpath_sanitize_component_n(name == NULL ? "" : name, strlen(name == NULL ? "" : name), profile);
}

canonicalpath_result canonicalpath_sanitize_component_n(const char *name, size_t name_len, const char *profile) {
  if (name_len == 0) return cp_err("ERR_INVALID_COMPONENT");
  if (cp_has_nul(name, name_len)) return cp_err("ERR_NUL_BYTE");
  char *value = (char *)malloc(name_len + 1);
  if (value == NULL) abort();
  size_t write = 0;
  int in_replacement = 0;
  for (size_t read = 0; read < name_len; ++read) {
    char ch = name[read];
    int replace = ch == '/' || ch == '\\' || ch == ':' || ch == '\t' || ch == '\n' || ch == '\r';
    if (replace) {
      if (!in_replacement) value[write++] = '-';
      in_replacement = 1;
    } else {
      value[write++] = ch;
      in_replacement = 0;
    }
  }
  value[write] = '\0';
  char *trimmed = cp_trim_component_edges(value);
  free(value);
  if (trimmed[0] == '\0') {
    free(trimmed);
    trimmed = cp_strdup("component");
  }
  if (cp_equals(profile, "win32")) {
    char *escaped = cp_escape_reserved_win32_component(trimmed);
    free(trimmed);
    trimmed = escaped;
  }
  return cp_ok(trimmed);
}

canonicalpath_result canonicalpath_encode_component(const char *name, const char *profile) {
  return canonicalpath_sanitize_component(name, profile);
}

canonicalpath_result canonicalpath_encode_component_n(const char *name, size_t name_len, const char *profile) {
  return canonicalpath_sanitize_component_n(name, name_len, profile);
}

canonicalpath_result canonicalpath_encode_git_ref(const char *raw) {
  return canonicalpath_encode_git_ref_n(raw == NULL ? "" : raw, strlen(raw == NULL ? "" : raw));
}

canonicalpath_result canonicalpath_encode_git_ref_n(const char *raw, size_t raw_len) {
  if (raw_len == 0) return cp_err("ERR_INVALID_COMPONENT");
  if (cp_has_nul(raw, raw_len)) return cp_err("ERR_NUL_BYTE");
  char *slug = (char *)malloc(raw_len + 1);
  if (slug == NULL) abort();
  size_t write = 0;
  int in_replacement = 0;
  for (size_t read = 0; read < raw_len; ++read) {
    char ch = raw[read];
    int allowed = cp_is_ascii_alnum(ch) || ch == '.' || ch == '_' || ch == '-';
    if (allowed) {
      slug[write++] = ch;
      in_replacement = 0;
    } else if (!in_replacement) {
      slug[write++] = '-';
      in_replacement = 1;
    }
  }
  slug[write] = '\0';
  char *trimmed = cp_trim_component_edges(slug);
  free(slug);
  if (trimmed[0] == '\0') {
    free(trimmed);
    trimmed = cp_strdup("ref");
  }
  char *hash = cp_sha256_hex((const unsigned char *)raw, raw_len);
  size_t slug_len = strlen(trimmed);
  char *result = (char *)malloc(slug_len + 2 + 12 + 1);
  if (result == NULL) abort();
  memcpy(result, trimmed, slug_len);
  result[slug_len] = '-';
  result[slug_len + 1] = '-';
  memcpy(result + slug_len + 2, hash, 12);
  result[slug_len + 14] = '\0';
  free(trimmed);
  free(hash);
  return cp_ok(result);
}
