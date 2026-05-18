import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "c-canonicalpath-allocation-check");
const programPath = path.join(tempRoot, "allocation_check.c");
const binaryPath = path.join(tempRoot, process.platform === "win32" ? "allocation_check.exe" : "allocation_check");

if (!commandExists("gcc", ["--version"])) {
  console.log("gcc not found; skipping C CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(), "utf8");

const compile = spawnSync(
  "gcc",
  [
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-pedantic",
    "-I",
    path.join(root, "packages", "c", "include"),
    path.join(root, "packages", "c", "src", "canonicalpath.c"),
    programPath,
    "-Wl,--wrap=malloc",
    "-Wl,--wrap=calloc",
    "-Wl,--wrap=realloc",
    "-Wl,--wrap=free",
    "-o",
    binaryPath,
  ],
  { stdio: "inherit" },
);
if (compile.error) {
  console.error(compile.error.message);
  process.exit(1);
}
if ((compile.status ?? 1) !== 0) process.exit(compile.status ?? 1);

const run = spawnSync(binaryPath, { stdio: "inherit" });
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function commandExists(command, args) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

function programFile() {
  return String.raw`#include "canonicalpath.h"

#include <stdio.h>
#include <stdlib.h>

static size_t allocations = 0;

void *__real_malloc(size_t size);
void *__real_calloc(size_t count, size_t size);
void *__real_realloc(void *ptr, size_t size);
void __real_free(void *ptr);

void *__wrap_malloc(size_t size) {
  ++allocations;
  return __real_malloc(size);
}

void *__wrap_calloc(size_t count, size_t size) {
  ++allocations;
  return __real_calloc(count, size);
}

void *__wrap_realloc(void *ptr, size_t size) {
  ++allocations;
  return __real_realloc(ptr, size);
}

void __wrap_free(void *ptr) { __real_free(ptr); }

static size_t use_result(size_t checksum, canonicalpath_result result) {
  if (result.error_code != NULL) {
    fprintf(stderr, "unexpected error: %s\n", result.error_code);
    exit(1);
  }
  for (const char *cursor = result.value; *cursor != '\0'; ++cursor) checksum += (unsigned char)*cursor;
  canonicalpath_result_free(&result);
  return checksum;
}

static size_t workload(size_t checksum, const canonicalpath_normalize_options *win,
                       const canonicalpath_normalize_options *wsl) {
  checksum = use_result(checksum, canonicalpath_normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win));
  checksum = use_result(checksum, canonicalpath_normalize("/mnt/c/Users/Alice/Repo/src/../README.md", wsl));
  checksum = use_result(checksum, canonicalpath_relative("c:/repo", "c:/repo/src/file.txt"));
  checksum = use_result(checksum, canonicalpath_join("c:/repo", "src/tmp/../file.txt"));
  checksum = use_result(checksum, canonicalpath_sanitize_component("CON.txt", "win32"));
  return checksum;
}

int main(void) {
  canonicalpath_normalize_options win;
  canonicalpath_normalize_options_init(&win);
  win.source_host = "win32";
  win.target_profile = "win32-drive";

  canonicalpath_normalize_options wsl;
  canonicalpath_normalize_options_init(&wsl);
  wsl.source_host = "wsl";
  wsl.target_profile = "win32-drive";
  wsl.wsl.enabled = 1;
  wsl.wsl.mount_root = "/mnt";

  size_t checksum = 0;
  for (int i = 0; i < 100; ++i) checksum = workload(checksum, &win, &wsl);

  allocations = 0;
  for (int i = 0; i < 1000; ++i) checksum = workload(checksum, &win, &wsl);

  if (checksum == 0) {
    fprintf(stderr, "allocation workload was optimized away\n");
    return 1;
  }
  if (allocations > 150000) {
    fprintf(stderr, "C CanonicalPath allocation budget exceeded: %zu\n", allocations);
    return 1;
  }
  printf("C CanonicalPath allocation check passed: %zu allocations\n", allocations);
  return 0;
}
`;
}
