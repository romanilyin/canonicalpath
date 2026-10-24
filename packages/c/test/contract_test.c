#include "canonicalpath.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void expect_value(const char *expected, canonicalpath_result result) {
  assert(result.error_code == NULL);
  assert(result.value != NULL && strcmp(result.value, expected) == 0);
  canonicalpath_result_free(&result);
}

static void expect_error(const char *expected, canonicalpath_result result) {
  assert(result.error_code != NULL && strcmp(result.error_code, expected) == 0);
  assert(result.value == NULL);
  canonicalpath_result_free(&result);
}

int main(void) {
  canonicalpath_normalize_options native;
  canonicalpath_normalize_options canonical;
  canonicalpath_normalize_options_init(&native);
  canonicalpath_normalize_options_init(&canonical);
  native.source_host = "posix";
  canonical.source_host = "canonical";
  const char *native_inputs[] = {"/repo/a\\b", "/C:/repo", "C:/repo", "C:foo", "x/../C:foo", "file:///C:/repo", "///repo"};
  for (size_t i = 0; i < sizeof(native_inputs) / sizeof(native_inputs[0]); ++i) {
    canonicalpath_result first = canonicalpath_normalize(native_inputs[i], &native);
    assert(first.error_code == NULL);
    expect_value(first.value, canonicalpath_normalize(first.value, &native));
    expect_value(first.value, canonicalpath_normalize(first.value, &canonical));
    expect_value(first.value, canonicalpath_to_posix(first.value));
    canonicalpath_result_free(&first);
  }

  const char *chains[][2] = {
    {"/repo", "/repo/a\\b"}, {"/repo", "/repo/C:/nested"},
    {"c:/repo", "c:/repo/C:foo"}, {"//?/c:/repo", "//?/c:/repo/file"},
    {"//?/UNC/server/share", "//?/UNC/server/share/repo/file"}
  };
  for (size_t i = 0; i < sizeof(chains) / sizeof(chains[0]); ++i) {
    canonicalpath_result relative = canonicalpath_relative(chains[i][0], chains[i][1]);
    assert(relative.error_code == NULL);
    expect_value(chains[i][1], canonicalpath_join(chains[i][0], relative.value));
    canonicalpath_result_free(&relative);
  }

  const char *roots[] = {".", "relative", "./C:root", "/repo", "c:/repo", "//server/share", "//?/c:/repo", "//?/UNC/server/share"};
  const char *self_paths[] = {".", "./", "./.", "a/..", "a/.././"};
  for (size_t i = 0; i < sizeof(roots) / sizeof(roots[0]); ++i) {
    for (size_t j = 0; j < sizeof(self_paths) / sizeof(self_paths[0]); ++j) {
      expect_value(roots[i], canonicalpath_join(roots[i], self_paths[j]));
    }
    expect_error("ERR_EMPTY_PATH", canonicalpath_join(roots[i], ""));
  }
  for (size_t i = 4; i < sizeof(roots) / sizeof(roots[0]); ++i) {
    expect_error("ERR_INVALID_PATH", canonicalpath_join(roots[i], "a\\b/../file"));
  }

  canonicalpath_normalize_options wsl;
  canonicalpath_normalize_options_init(&wsl);
  wsl.wsl.enabled = 1;
  const char *mounts[] = {"", "/", "/foo/../mnt/./", "/mnt\\vol", "/C:/drives"};
  for (size_t i = 0; i < sizeof(mounts) / sizeof(mounts[0]); ++i) {
    wsl.wsl.mount_root = mounts[i];
    wsl.wsl.mount_root_len = strlen(mounts[i]);
    canonicalpath_result host = canonicalpath_to_wsl("c:/repo", &wsl.wsl);
    assert(host.error_code == NULL);
    expect_value("c:/repo", canonicalpath_normalize(host.value, &wsl));
    canonicalpath_result_free(&host);
  }

  /* A positive explicit length does not require a NUL terminator. */
  const char bounded_mount[] = {'/', 'm', 'n', 't'};
  wsl.wsl.mount_root = bounded_mount;
  wsl.wsl.mount_root_len = sizeof(bounded_mount);
  expect_value("/mnt/c/repo", canonicalpath_to_wsl("c:/repo", &wsl.wsl));
  expect_value("c:/repo", canonicalpath_normalize("/mnt/c/repo", &wsl));

  const char nul_mount[] = {'/', 'm', 'n', 't', '\0', 'x'};
  wsl.wsl.mount_root = nul_mount;
  wsl.wsl.mount_root_len = sizeof(nul_mount);
  expect_error("ERR_NUL_BYTE", canonicalpath_to_wsl("/repo", &wsl.wsl));
  expect_error("ERR_NUL_BYTE", canonicalpath_normalize("/repo", &wsl));
  wsl.wsl.enabled = 0;
  expect_error("ERR_NUL_BYTE", canonicalpath_normalize("/repo", &wsl));
  wsl.wsl.mount_root = NULL;
  wsl.wsl.mount_root_len = 1;
  expect_error("ERR_INVALID_PATH", canonicalpath_to_wsl("c:/repo", &wsl.wsl));

  expect_error("ERR_INVALID_PATH", canonicalpath_to_posix("/repo/a/../b"));
  expect_error("ERR_INVALID_PATH", canonicalpath_to_win32("c:/repo/a/../b"));
  puts("C canonical grammar operation-chain and length-aware mount tests passed");
  return 0;
}
