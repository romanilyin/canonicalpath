import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "gdscript-canonicalpath-allocation-check");

const godot = resolveGodot();
if (!godot) {
  console.log("Godot not found; skipping GDScript CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(path.join(tempRoot, "project.godot"), "[application]\nconfig/name=\"CanonicalPathGDScriptAllocationCheck\"\n", "utf8");
writeFileSync(path.join(tempRoot, "canonicalpath.gd"), readFileSync(path.join(root, "packages", "gdscript", "src", "canonicalpath.gd"), "utf8"), "utf8");
writeFileSync(path.join(tempRoot, "allocation_check.gd"), programFile(), "utf8");

const run = spawnSync(godot, ["--headless", "--path", tempRoot, "--script", path.join(tempRoot, "allocation_check.gd")], {
  stdio: "inherit",
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolveGodot() {
  const candidates = [
    process.env.GODOT,
    process.env.GODOT4,
    "godot4",
    "godot",
    path.join(homedir(), ".local", "bin", process.platform === "win32" ? "godot.exe" : "godot"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function programFile() {
  return String.raw`extends SceneTree

const CanonicalPath = preload("res://canonicalpath.gd")
const LOOPS := 10000
const BUDGET_BYTES := 128 * 1024 * 1024

func _init() -> void:
    var posix := {"sourceHost": "posix", "targetProfile": "posix"}
    var win32 := {"sourceHost": "win32", "targetProfile": "win32-drive"}
    var uri := {"sourceHost": "vscode-file-uri", "targetProfile": "posix", "uri": {"allowFileUri": true}}
    var wsl := {"sourceHost": "wsl", "targetProfile": "win32-drive", "wsl": {"enabled": true, "mountRoot": "/mnt"}}
    var wsl_out := {"mountRoot": "/mnt"}
    var checksum := _run_workload(posix, win32, uri, wsl, wsl_out, LOOPS)
    var before := _memory_bytes()
    checksum += _run_workload(posix, win32, uri, wsl, wsl_out, LOOPS)
    var after := _memory_bytes()
    var delta = max(after - before, 0)
    if checksum == 0:
        _fail("allocation workload was optimized away")
    if delta > BUDGET_BYTES:
        _fail("GDScript CanonicalPath allocation check exceeded memory budget: %d > %d" % [delta, BUDGET_BYTES])
    print("GDScript CanonicalPath allocation check passed: memory delta %d bytes over %d iterations" % [delta, LOOPS])
    quit(0)

func _run_workload(posix: Dictionary, win32: Dictionary, uri: Dictionary, wsl: Dictionary, wsl_out: Dictionary, iterations: int) -> int:
    var checksum := 0
    for index in range(iterations):
        checksum += str(CanonicalPath.normalize_result("/home//alice/./repo/src/../README.md", posix).value).length()
        checksum += str(CanonicalPath.normalize_result("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win32).value).length()
        checksum += str(CanonicalPath.normalize_result("file:///repo/caf%C3%A9.txt", uri).value).length()
        checksum += str(CanonicalPath.normalize_result("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).value).length()
        checksum += str(CanonicalPath.relative_result("c:/repo", "c:/repo/src/file.txt").value).length()
        checksum += str(CanonicalPath.join_result("c:/repo", "src/file.txt").value).length()
        checksum += 1 if CanonicalPath.is_equal_result("C:\\Users\\Alice\\Repo", "c:/Users/Alice/Repo", win32).value else 0
        checksum += str(CanonicalPath.to_win32_result("c:/Users/Alice/Repo").value).length()
        checksum += str(CanonicalPath.to_wsl_result("c:/Users/Alice/Repo", wsl_out).value).length()
        checksum += str(CanonicalPath.to_posix_result("/home/alice/repo").value).length()
        checksum += str(CanonicalPath.sanitize_component_result("feature/auth", "portable").value).length()
        checksum += str(CanonicalPath.encode_component_result("CON.txt", "win32").value).length()
        checksum += str(CanonicalPath.encode_git_ref_result("feature/auth").value).length()
    return checksum

func _memory_bytes() -> int:
    return int(Performance.get_monitor(Performance.MEMORY_STATIC))

func _fail(message: String) -> void:
    push_error(message)
    quit(1)
`;
}
