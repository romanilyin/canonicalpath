#pragma once

#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>

namespace canonicalpath {

struct WslOptions {
  bool enabled = false;
  std::string mount_root = "/mnt";
};

struct UriOptions {
  bool allow_file_uri = false;
  bool allow_vscode_file_uri = false;
  bool reject_encoded_slash = true;
};

struct WindowsOptions {
  bool preserve_extended_length = false;
  bool reject_device_names = false;
  bool reject_ads = false;
};

struct NormalizeOptions {
  std::string source_host;
  std::string target_profile;
  WslOptions wsl;
  UriOptions uri;
  WindowsOptions windows;
  bool trim_outer_whitespace = false;
};

class path_error : public std::runtime_error {
public:
  path_error(std::string code, std::string message);

  const std::string &code() const noexcept;

private:
  std::string code_;
};

std::string normalize(std::string_view raw, NormalizeOptions options = {});

std::string relative(std::string_view root, std::string_view target);

std::string join(std::string_view root, std::string_view relative_path);

std::string join(std::initializer_list<std::string_view> parts);

bool is_equal(std::string_view left, std::string_view right,
              NormalizeOptions options = {});

std::string to_win32(std::string_view canonical);

std::string to_wsl(std::string_view canonical, WslOptions options = {});

std::string to_posix(std::string_view canonical);

std::string sanitize_component(std::string_view name, std::string_view profile);

std::string encode_component(std::string_view name, std::string_view profile);

std::string encode_git_ref(std::string_view raw);
} // namespace canonicalpath
