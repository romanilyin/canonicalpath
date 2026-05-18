import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "kotlin-canonicalpath-allocation-check");
const mainPath = path.join(tempRoot, "AllocationCheck.kt");
const jarPath = path.join(tempRoot, "kotlin-canonicalpath-allocation-check.jar");
const librarySources = [
  path.join(root, "packages", "kotlin", "src", "main", "kotlin", "com", "canonicalpath", "CanonicalPath.kt"),
  path.join(root, "packages", "kotlin", "src", "main", "kotlin", "com", "canonicalpath", "CanonicalPathHttpClient.kt"),
];

const kotlinc = resolveKotlinc();
const java = resolveJava();
if (!kotlinc || !java) {
  console.log("kotlinc or java not found; skipping Kotlin CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(mainPath, programFile(), "utf8");

const compile = spawnSync(kotlinc, [...librarySources, mainPath, "-include-runtime", "-d", jarPath], {
  stdio: "inherit",
});
if (compile.error) {
  console.error(compile.error.message);
  process.exit(1);
}
if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync(java, ["-jar", jarPath], { stdio: "inherit" });
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolveKotlinc() {
  const candidates = [
    process.env.KOTLINC,
    "kotlinc",
    path.join(homedir(), ".local", "bin", process.platform === "win32" ? "kotlinc.bat" : "kotlinc"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function resolveJava() {
  const candidates = [
    process.env.JAVA,
    "java",
    path.join(homedir(), ".local", "bin", process.platform === "win32" ? "java.exe" : "java"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function programFile() {
  return String.raw`import com.canonicalpath.CanonicalPath
import com.canonicalpath.CanonicalPathNormalizeOptions
import com.canonicalpath.CanonicalPathURIOptions
import com.canonicalpath.CanonicalPathWSLOptions

private const val loops = 10_000
private const val budgetBytes = 192L * 1024L * 1024L

fun main() {
    val posix = CanonicalPathNormalizeOptions(sourceHost = "posix", targetProfile = "posix")
    val win32 = CanonicalPathNormalizeOptions(sourceHost = "win32", targetProfile = "win32-drive")
    val uri = CanonicalPathNormalizeOptions(
        sourceHost = "vscode-file-uri",
        targetProfile = "posix",
        uri = CanonicalPathURIOptions(allowFileUri = true),
    )
    val wsl = CanonicalPathNormalizeOptions(
        sourceHost = "wsl",
        targetProfile = "win32-drive",
        wsl = CanonicalPathWSLOptions(enabled = true, mountRoot = "/mnt"),
    )
    val wslOut = CanonicalPathWSLOptions(mountRoot = "/mnt")

    var checksum = runWorkload(posix, win32, uri, wsl, wslOut, loops)
    System.gc()
    Thread.sleep(50)
    val before = rssBytes()
    checksum += runWorkload(posix, win32, uri, wsl, wslOut, loops)
    System.gc()
    Thread.sleep(50)
    val after = rssBytes()
    val delta = if (after > before) after - before else 0L

    check(checksum != 0) { "allocation workload was optimized away" }
    check(delta <= budgetBytes) { "Kotlin CanonicalPath allocation check exceeded RSS budget: $delta > $budgetBytes" }
    println("Kotlin CanonicalPath allocation check passed: RSS delta $delta bytes over $loops iterations")
}

fun runWorkload(
    posix: CanonicalPathNormalizeOptions,
    win32: CanonicalPathNormalizeOptions,
    uri: CanonicalPathNormalizeOptions,
    wsl: CanonicalPathNormalizeOptions,
    wslOut: CanonicalPathWSLOptions,
    iterations: Int,
): Int {
    var checksum = 0
    repeat(iterations) {
        checksum += CanonicalPath.normalize("/home//alice/./repo/src/../README.md", posix).length
        checksum += CanonicalPath.normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", win32).length
        checksum += CanonicalPath.normalize("file:///repo/caf%C3%A9.txt", uri).length
        checksum += CanonicalPath.normalize("/mnt/c/Users/Alice/Repo/src/../README.md", wsl).length
        checksum += CanonicalPath.relative("c:/repo", "c:/repo/src/file.txt").length
        checksum += CanonicalPath.join("c:/repo", "src/file.txt").length
        checksum += if (CanonicalPath.isEqual("C:\\Users\\Alice\\Repo", "c:/Users/Alice/Repo", win32)) 1 else 0
        checksum += CanonicalPath.toWin32("c:/Users/Alice/Repo").length
        checksum += CanonicalPath.toWSL("c:/Users/Alice/Repo", wslOut).length
        checksum += CanonicalPath.toPOSIX("/home/alice/repo").length
        checksum += CanonicalPath.sanitizeComponent("feature/auth", "portable").length
        checksum += CanonicalPath.encodeComponent("CON.txt", "win32").length
        checksum += CanonicalPath.encodeGitRef("feature/auth").length
    }
    return checksum
}

fun rssBytes(): Long {
    return try {
        java.io.File("/proc/self/status").readLines().firstOrNull { it.startsWith("VmRSS:") }
            ?.split(Regex("\\s+"))
            ?.getOrNull(1)
            ?.toLongOrNull()
            ?.times(1024L) ?: 0L
    } catch (ignored: Exception) {
        0L
    }
}
`;
}
