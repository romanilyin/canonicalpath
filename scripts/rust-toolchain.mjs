import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// An explicit CARGO override must work as configured; do not silently select a
// different installation when the requested executable or toolchain is broken.
export function requireCargo() {
  const candidates = process.env.CARGO
    ? [process.env.CARGO]
    : ["cargo", path.join(homedir(), ".cargo", "bin", process.platform === "win32" ? "cargo.exe" : "cargo")];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { cwd: repositoryRoot, stdio: "ignore" });
    if (!probe.error && !probe.signal && probe.status === 0) return candidate;
  }
  throw new Error("Rust verification requires a working Cargo toolchain. Install Rust with rustup, add Cargo to PATH, or set CARGO to its executable; Rust checks cannot be skipped.");
}

export function runCargo(cargo, args) {
  const result = spawnSync(cargo, args, { cwd: repositoryRoot, stdio: "inherit" });
  if (result.error) throw new Error(`Required cargo ${args[0]} could not start: ${result.error.message}`, { cause: result.error });
  if (result.signal) throw new Error(`Required cargo ${args[0]} was terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`Required cargo ${args[0]} failed with exit status ${result.status ?? "unknown"}`);
}
