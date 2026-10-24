#include "canonicalpath.hpp"

#include <cassert>
#include <iostream>
#include <string>
#include <utility>

template <class Action> void expect_error(const char *code, Action action) {
  try {
    action();
    assert(false && "operation unexpectedly succeeded");
  } catch (const canonicalpath::path_error &error) {
    assert(error.code() == code);
  }
}

int main() {
  canonicalpath::NormalizeOptions native;
  canonicalpath::NormalizeOptions canonical;
  native.source_host = "posix";
  canonical.source_host = "canonical";
  for (const char *raw : {"/repo/a\\b", "/C:/repo", "C:/repo", "C:foo", "x/../C:foo", "file:///C:/repo", "///repo"}) {
    const auto first = canonicalpath::normalize(raw, native);
    assert(canonicalpath::normalize(first, native) == first);
    assert(canonicalpath::normalize(first, canonical) == first);
    assert(canonicalpath::to_posix(first) == first);
  }
  const std::pair<const char *, const char *> chains[] = {
    {"/repo", "/repo/a\\b"}, {"/repo", "/repo/C:/nested"},
    {"c:/repo", "c:/repo/C:foo"}, {"//?/c:/repo", "//?/c:/repo/file"},
    {"//?/UNC/server/share", "//?/UNC/server/share/repo/file"}
  };
  for (const auto &[root, target] : chains) {
    assert(canonicalpath::join(root, canonicalpath::relative(root, target)) == target);
  }
  for (const char *root : {".", "relative", "./C:root", "/repo", "c:/repo", "//server/share", "//?/c:/repo", "//?/UNC/server/share"}) {
    for (const char *self_path : {".", "./", "./.", "a/..", "a/.././"}) {
      assert(canonicalpath::join(root, self_path) == root);
    }
    expect_error("ERR_EMPTY_PATH", [&] { canonicalpath::join(root, ""); });
  }
  for (const char *root : {"c:/repo", "//server/share", "//?/c:/repo", "//?/UNC/server/share"}) {
    expect_error("ERR_INVALID_PATH", [&] { canonicalpath::join(root, "a\\b/../file"); });
  }
  canonicalpath::NormalizeOptions wsl;
  wsl.wsl.enabled = true;
  for (const char *mount : {"", "/", "/foo/../mnt/./", "/mnt\\vol", "/C:/drives"}) {
    wsl.wsl.mount_root = mount;
    assert(canonicalpath::normalize(canonicalpath::to_wsl("c:/repo", wsl.wsl), wsl) == "c:/repo");
  }
  wsl.wsl.mount_root = std::string("/mnt\0extra", 10);
  expect_error("ERR_NUL_BYTE", [&] { canonicalpath::to_wsl("/repo", wsl.wsl); });
  expect_error("ERR_NUL_BYTE", [&] { canonicalpath::normalize("/repo", wsl); });
  expect_error("ERR_INVALID_PATH", [] { canonicalpath::to_posix("/repo/a/../b"); });
  expect_error("ERR_INVALID_PATH", [] { canonicalpath::to_win32("c:/repo/a/../b"); });
  std::cout << "C++ canonical grammar operation-chain and mount tests passed\n";
}
