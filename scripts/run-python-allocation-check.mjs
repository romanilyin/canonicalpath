import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "python-canonicalpath-allocation-check");
const programPath = path.join(tempRoot, "allocation_check.py");

const python = resolvePython();
if (!python) {
  console.log("python3 not found; skipping Python CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(), "utf8");

const run = spawnSync(python.command, [...python.args, programPath], {
  stdio: "inherit",
  env: pythonEnv(),
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolvePython() {
  const candidates = [
    process.env.PYTHON ? { command: process.env.PYTHON, args: [] } : undefined,
    { command: "python3", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function pythonEnv() {
  const packageRoot = path.join(root, "packages", "python");
  const existing = process.env.PYTHONPATH;
  return {
    ...process.env,
    PYTHONPATH: existing ? `${packageRoot}${path.delimiter}${existing}` : packageRoot,
  };
}

function programFile() {
  return `import gc
import tracemalloc

import canonicalpath


LOOPS = 5000
BUDGET_BYTES = 2_000_000


def workload():
    canonicalpath.normalize("/home//alice/./repo", {"sourceHost": "posix", "targetProfile": "posix"})
    canonicalpath.normalize("C:\\\\Users\\\\Alice\\\\Repo\\\\src\\\\..\\\\README.md", {"sourceHost": "win32", "targetProfile": "win32-drive"})
    canonicalpath.normalize("file:///repo/caf%C3%A9.txt", {"sourceHost": "vscode-file-uri", "targetProfile": "posix", "uri": {"allowFileUri": True}})
    canonicalpath.relative("c:/repo", "c:/repo/src/file.txt")
    canonicalpath.join("c:/repo", "src/./file.txt")
    canonicalpath.is_equal("/mnt/c/Users/Alice/Repo", "c:/Users/Alice/Repo", {"sourceHost": "wsl", "targetProfile": "win32-drive", "wsl": {"enabled": True, "mountRoot": "/mnt"}})
    canonicalpath.to_win32("c:/Users/Alice/Repo")
    canonicalpath.to_wsl("c:/Users/Alice/Repo", {"mountRoot": "/mnt"})
    canonicalpath.to_posix("/home/alice/repo")
    canonicalpath.sanitize_component("feature/auth", "portable")
    canonicalpath.encode_component("NUL.txt", "win32")
    canonicalpath.encode_git_ref("feature/auth")


for _ in range(100):
    workload()

gc.collect()
tracemalloc.start()
tracemalloc.reset_peak()
start_current, _ = tracemalloc.get_traced_memory()
for _ in range(LOOPS):
    workload()
_, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()

peak_delta = peak - start_current
if peak_delta > BUDGET_BYTES:
    raise SystemExit(f"Python CanonicalPath allocation check exceeded budget: {peak_delta} bytes > {BUDGET_BYTES}")

print(f"Python CanonicalPath allocation check passed: peak traced memory {peak_delta} bytes")
`;
}
