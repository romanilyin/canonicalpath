import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "haxe-canonicalpath-allocation-check");
const mainPath = path.join(tempRoot, "HaxeAllocationCheck.hx");
const jsPath = path.join(tempRoot, "haxe-allocation-check.js");
const sourceRoot = path.join(root, "packages", "haxe", "src");

const haxe = resolveHaxe();
if (!haxe) {
  console.log("haxe not found; skipping Haxe CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(mainPath, programFile(), "utf8");

const compile = spawnSync(haxe, ["-cp", sourceRoot, "-cp", tempRoot, "-main", "HaxeAllocationCheck", "-D", "nodejs", "-js", jsPath], {
  stdio: "inherit",
});
if (compile.error) {
  console.error(compile.error.message);
  process.exit(1);
}
if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync(process.execPath, [jsPath], { stdio: "inherit" });
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolveHaxe() {
  const candidates = [
    process.env.HAXE,
    "haxe",
    path.join(homedir(), ".local", "bin", process.platform === "win32" ? "haxe.exe" : "haxe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function programFile() {
  return String.raw`import js.Syntax;
import CanonicalPath.CanonicalPathNormalizeOptions;
import CanonicalPath.CanonicalPathURIOptions;
import CanonicalPath.CanonicalPathWSLOptions;

class HaxeAllocationCheck {
  static inline var loops = 10000;
  static inline var budgetBytes = 192 * 1024 * 1024;

  static function main(): Void {
    var posix = new CanonicalPathNormalizeOptions();
    posix.sourceHost = "posix";
    posix.targetProfile = "posix";
    var win32 = new CanonicalPathNormalizeOptions();
    win32.sourceHost = "win32";
    win32.targetProfile = "win32-drive";
    var uri = new CanonicalPathNormalizeOptions();
    uri.sourceHost = "vscode-file-uri";
    uri.targetProfile = "posix";
    uri.uri.allowFileUri = true;
    var wsl = new CanonicalPathNormalizeOptions();
    wsl.sourceHost = "wsl";
    wsl.targetProfile = "win32-drive";
    wsl.wsl.enabled = true;
    wsl.wsl.mountRoot = "/mnt";
    var wslOut = new CanonicalPathWSLOptions();
    wslOut.mountRoot = "/mnt";

    var checksum = runWorkload(posix, win32, uri, wsl, wslOut, loops);
    var before = rssBytes();
    checksum += runWorkload(posix, win32, uri, wsl, wslOut, loops);
    var after = rssBytes();
    var delta = after > before ? after - before : 0;

    if (checksum == 0) throw "allocation workload was optimized away";
    if (delta > budgetBytes) throw "Haxe CanonicalPath allocation check exceeded RSS budget: " + delta + " > " + budgetBytes;
    trace("Haxe CanonicalPath allocation check passed: RSS delta " + delta + " bytes over " + loops + " iterations");
  }

  static function runWorkload(posix: CanonicalPathNormalizeOptions, win32: CanonicalPathNormalizeOptions, uri: CanonicalPathNormalizeOptions, wsl: CanonicalPathNormalizeOptions, wslOut: CanonicalPathWSLOptions, iterations: Int): Int {
    var checksum = 0;
    for (_ in 0...iterations) {
      checksum += CanonicalPath.normalize("/home//alice/./repo/src/../README.md", posix).length;
      checksum += CanonicalPath.normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win32).length;
      checksum += CanonicalPath.normalize("file:///repo/caf%C3%A9.txt", uri).length;
      checksum += CanonicalPath.normalize("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).length;
      checksum += CanonicalPath.relative("c:/repo", "c:/repo/src/file.txt").length;
      checksum += CanonicalPath.join("c:/repo", "src/file.txt").length;
      checksum += CanonicalPath.isEqual("C:\\Users\\Alice\\Repo", "c:/Users/Alice/Repo", win32) ? 1 : 0;
      checksum += CanonicalPath.toWin32("c:/Users/Alice/Repo").length;
      checksum += CanonicalPath.toWSL("c:/Users/Alice/Repo", wslOut).length;
      checksum += CanonicalPath.toPOSIX("/home/alice/repo").length;
      checksum += CanonicalPath.sanitizeComponent("feature/auth", "portable").length;
      checksum += CanonicalPath.encodeComponent("CON.txt", "win32").length;
      checksum += CanonicalPath.encodeGitRef("feature/auth").length;
    }
    return checksum;
  }

  static function rssBytes(): Float {
    return Syntax.code("process.memoryUsage().rss");
  }
}
`;
}
