import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const go = process.env.GO ?? "go";
const temporary = mkdtempSync(path.join(tmpdir(), "canonicalpath-wasm-denial-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    timeout: 180_000,
    ...options,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`Unsupported-platform verification failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
  }
  return result;
}

try {
  const goroot = run(go, ["env", "GOROOT"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).stdout.trim();
  const runner = path.join(goroot, "lib", "wasm", "wasm_exec_node.js");
  if (!existsSync(runner)) throw new Error("The selected Go toolchain has no js/wasm Node runner");
  const binary = path.join(temporary, "canonicalfs.test.wasm");
  run(go, ["test", "-c", "-o", binary, "./packages/go/canonicalfs"], {
    env: { ...process.env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
  });
  run(process.execPath, ["--stack-size=8192", runner, binary, "-test.count=1", "-test.v"]);
  console.log("CanonicalFS unsupported-platform tests passed on js/wasm");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
