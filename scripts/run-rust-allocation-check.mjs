import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "rust-canonicalpath-allocation-check");
const cargoTomlPath = path.join(tempRoot, "Cargo.toml");
const sourceRoot = path.join(tempRoot, "src");
const mainPath = path.join(sourceRoot, "main.rs");

const cargo = resolveCargo();
if (!cargo) {
  console.log("cargo not found; skipping Rust CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(sourceRoot, { recursive: true });
writeFileSync(cargoTomlPath, cargoToml(), "utf8");
writeFileSync(mainPath, programFile(), "utf8");

const run = spawnSync(cargo, ["run", "--quiet", "--release", "--manifest-path", cargoTomlPath], {
  stdio: "inherit",
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolveCargo() {
  const candidates = [
    process.env.CARGO,
    "cargo",
    path.join(homedir(), ".cargo", "bin", process.platform === "win32" ? "cargo.exe" : "cargo"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function cargoToml() {
  const packagePath = path.join(root, "packages", "rust").replaceAll("\\", "/");
  return `[package]
name = "canonicalpath-rust-allocation-check"
version = "2026.5.18-2"
edition = "2021"

[dependencies]
canonicalpath-rust = { path = "${packagePath}" }
`;
}

function programFile() {
  return String.raw`use canonicalpath_rust::{self, NormalizeOptions};
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};

struct CountingAllocator;

static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }
}

#[global_allocator]
static GLOBAL: CountingAllocator = CountingAllocator;

fn main() {
    let mut win = NormalizeOptions::default();
    win.source_host = "win32".to_string();
    win.target_profile = "win32-drive".to_string();

    let mut wsl = NormalizeOptions::default();
    wsl.source_host = "wsl".to_string();
    wsl.target_profile = "win32-drive".to_string();
    wsl.wsl.enabled = true;
    wsl.wsl.mount_root = "/mnt".to_string();

    let mut checksum = 0usize;
    for _ in 0..100 {
        checksum = workload(checksum, &win, &wsl);
    }

    ALLOCATIONS.store(0, Ordering::Relaxed);
    for _ in 0..1000 {
        checksum = workload(checksum, &win, &wsl);
    }

    let count = ALLOCATIONS.load(Ordering::Relaxed);
    if checksum == 0 {
        panic!("allocation workload was optimized away");
    }
    if count > 100_000 {
        eprintln!("Rust CanonicalPath allocation budget exceeded: {count}");
        std::process::exit(1);
    }
    println!("Rust CanonicalPath allocation check passed: {count} allocations");
}

fn workload(mut checksum: usize, win: &NormalizeOptions, wsl: &NormalizeOptions) -> usize {
    checksum = checksum.wrapping_add(black_box(canonicalpath_rust::normalize_with_options("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win).unwrap()).len());
    checksum = checksum.wrapping_add(black_box(canonicalpath_rust::normalize_with_options("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).unwrap()).len());
    checksum = checksum.wrapping_add(black_box(canonicalpath_rust::relative("c:/repo", "c:/repo/src/file.txt").unwrap()).len());
    checksum = checksum.wrapping_add(black_box(canonicalpath_rust::join("c:/repo", "src/tmp/../file.txt").unwrap()).len());
    checksum = checksum.wrapping_add(black_box(canonicalpath_rust::sanitize_component("CON.txt", "win32").unwrap()).len());
    checksum
}
`;
}
