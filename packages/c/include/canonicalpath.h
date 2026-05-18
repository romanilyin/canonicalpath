#ifndef CANONICALPATH_H
#define CANONICALPATH_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct canonicalpath_wsl_options {
  int enabled;
  const char *mount_root;
} canonicalpath_wsl_options;

typedef struct canonicalpath_uri_options {
  int allow_file_uri;
  int allow_vscode_file_uri;
  int reject_encoded_slash;
} canonicalpath_uri_options;

typedef struct canonicalpath_windows_options {
  int preserve_extended_length;
  int reject_device_names;
  int reject_ads;
} canonicalpath_windows_options;

typedef struct canonicalpath_normalize_options {
  const char *source_host;
  const char *target_profile;
  canonicalpath_wsl_options wsl;
  canonicalpath_uri_options uri;
  canonicalpath_windows_options windows;
  int trim_outer_whitespace;
} canonicalpath_normalize_options;

typedef struct canonicalpath_result {
  char *value;
  const char *error_code;
} canonicalpath_result;

typedef struct canonicalpath_bool_result {
  int value;
  const char *error_code;
} canonicalpath_bool_result;

void canonicalpath_normalize_options_init(canonicalpath_normalize_options *options);

void canonicalpath_result_free(canonicalpath_result *result);

canonicalpath_result canonicalpath_normalize(const char *raw,
                                             const canonicalpath_normalize_options *options);

canonicalpath_result canonicalpath_normalize_n(const char *raw, size_t raw_len,
                                               const canonicalpath_normalize_options *options);

canonicalpath_result canonicalpath_relative(const char *root, const char *target);

canonicalpath_result canonicalpath_relative_n(const char *root, size_t root_len, const char *target,
                                             size_t target_len);

canonicalpath_result canonicalpath_join(const char *root, const char *relative_path);

canonicalpath_result canonicalpath_join_n(const char *root, size_t root_len, const char *relative_path,
                                         size_t relative_len);

canonicalpath_bool_result canonicalpath_is_equal(const char *left, const char *right,
                                                const canonicalpath_normalize_options *options);

canonicalpath_bool_result canonicalpath_is_equal_n(const char *left, size_t left_len, const char *right,
                                                  size_t right_len,
                                                  const canonicalpath_normalize_options *options);

canonicalpath_result canonicalpath_to_win32(const char *canonical);

canonicalpath_result canonicalpath_to_win32_n(const char *canonical, size_t canonical_len);

canonicalpath_result canonicalpath_to_wsl(const char *canonical, const canonicalpath_wsl_options *options);

canonicalpath_result canonicalpath_to_wsl_n(const char *canonical, size_t canonical_len,
                                           const canonicalpath_wsl_options *options);

canonicalpath_result canonicalpath_to_posix(const char *canonical);

canonicalpath_result canonicalpath_to_posix_n(const char *canonical, size_t canonical_len);

canonicalpath_result canonicalpath_sanitize_component(const char *name, const char *profile);

canonicalpath_result canonicalpath_sanitize_component_n(const char *name, size_t name_len,
                                                       const char *profile);

canonicalpath_result canonicalpath_encode_component(const char *name, const char *profile);

canonicalpath_result canonicalpath_encode_component_n(const char *name, size_t name_len,
                                                     const char *profile);

canonicalpath_result canonicalpath_encode_git_ref(const char *raw);

canonicalpath_result canonicalpath_encode_git_ref_n(const char *raw, size_t raw_len);

#ifdef __cplusplus
}
#endif

#endif
