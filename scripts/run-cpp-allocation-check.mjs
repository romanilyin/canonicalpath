import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "cpp-canonicalpath-allocation-check");
const programPath = path.join(tempRoot, "allocation_check.cpp");
const binaryPath = path.join(tempRoot, process.platform === "win32" ? "allocation_check.exe" : "allocation_check");

if (!commandExists("g++", ["--version"])) {
  console.log("g++ not found; skipping C++ CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(), "utf8");

const compile = spawnSync(
  "g++",
  [
    "-std=c++20",
    "-O2",
    "-Wall",
    "-Wextra",
    "-pedantic",
    "-I",
    path.join(root, "packages", "cpp", "include"),
    path.join(root, "packages", "cpp", "src", "canonicalpath.cpp"),
    programPath,
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
  return String.raw`#include "canonicalpath.hpp"

#include <atomic>
#include <cstdlib>
#include <iostream>
#include <new>
#include <string>

static std::atomic<std::size_t> allocations{0};

void *operator new(std::size_t size) {
  allocations.fetch_add(1, std::memory_order_relaxed);
  if (void *ptr = std::malloc(size)) return ptr;
  throw std::bad_alloc();
}

void operator delete(void *ptr) noexcept { std::free(ptr); }

void operator delete(void *ptr, std::size_t) noexcept { std::free(ptr); }

int main() {
  canonicalpath::NormalizeOptions win;
  win.source_host = "win32";
  win.target_profile = "win32-drive";
  canonicalpath::NormalizeOptions wsl;
  wsl.source_host = "wsl";
  wsl.target_profile = "win32-drive";
  wsl.wsl.enabled = true;
  wsl.wsl.mount_root = "/mnt";

  volatile std::size_t checksum = 0;
  for (int i = 0; i < 100; ++i) {
    checksum += canonicalpath::normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win).size();
    checksum += canonicalpath::normalize("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).size();
    checksum += canonicalpath::relative("c:/repo", "c:/repo/src/file.txt").size();
    checksum += canonicalpath::join("c:/repo", "src/tmp/../file.txt").size();
    checksum += canonicalpath::sanitize_component("CON.txt", "win32").size();
  }

  allocations.store(0, std::memory_order_relaxed);
  for (int i = 0; i < 1000; ++i) {
    checksum += canonicalpath::normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win).size();
    checksum += canonicalpath::normalize("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).size();
    checksum += canonicalpath::relative("c:/repo", "c:/repo/src/file.txt").size();
    checksum += canonicalpath::join("c:/repo", "src/tmp/../file.txt").size();
    checksum += canonicalpath::sanitize_component("CON.txt", "win32").size();
  }
  std::size_t count = allocations.load(std::memory_order_relaxed);
  if (checksum == 0) throw std::runtime_error("allocation workload was optimized away");
  if (count > 50000) {
    std::cerr << "C++ CanonicalPath allocation budget exceeded: " << count << std::endl;
    return 1;
  }
  std::cout << "C++ CanonicalPath allocation check passed: " << count << " allocations" << std::endl;
  return 0;
}
`;
}
