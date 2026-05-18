import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "swift-canonicalpath-allocation-check");
const sourceRoot = path.join(tempRoot, "Sources", "SwiftAllocationCheck");
const packagePath = path.join(tempRoot, "Package.swift");
const mainPath = path.join(sourceRoot, "main.swift");

const swift = resolveSwift();
if (!swift) {
  console.log("swift not found; skipping Swift CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(sourceRoot, { recursive: true });
writeFileSync(packagePath, packageFile(), "utf8");
writeFileSync(mainPath, programFile(), "utf8");

const run = spawnSync(swift, ["run", "-c", "release", "--package-path", tempRoot, "SwiftAllocationCheck"], {
  stdio: "inherit",
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolveSwift() {
  const candidates = [
    process.env.SWIFT,
    "swift",
    path.join(homedir(), ".local", "bin", process.platform === "win32" ? "swift.exe" : "swift"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function packageFile() {
  const packageDependencyPath = path.join(root, "packages", "swift").replaceAll("\\", "/");
  return `// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SwiftAllocationCheck",
    products: [
        .executable(name: "SwiftAllocationCheck", targets: ["SwiftAllocationCheck"])
    ],
    dependencies: [
        .package(path: "${packageDependencyPath}")
    ],
    targets: [
        .executableTarget(name: "SwiftAllocationCheck", dependencies: [.product(name: "CanonicalPath", package: "swift")])
    ]
)
`;
}

function programFile() {
  return String.raw`import CanonicalPath
import Foundation

@main
enum Program {
    private static let loops = 10_000
    private static let budgetBytes: UInt64 = 128 * 1024 * 1024

    static func main() throws {
        let posix = CanonicalPathNormalizeOptions(sourceHost: "posix", targetProfile: "posix")
        let win32 = CanonicalPathNormalizeOptions(sourceHost: "win32", targetProfile: "win32-drive")
        let uri = CanonicalPathNormalizeOptions(
            sourceHost: "vscode-file-uri",
            targetProfile: "posix",
            uri: CanonicalPathURIOptions(allowFileUri: true)
        )
        let wsl = CanonicalPathNormalizeOptions(
            sourceHost: "wsl",
            targetProfile: "win32-drive",
            wsl: CanonicalPathWSLOptions(enabled: true, mountRoot: "/mnt")
        )
        let wslOut = CanonicalPathWSLOptions(mountRoot: "/mnt")

        var checksum = try runWorkload(posix: posix, win32: win32, uri: uri, wsl: wsl, wslOut: wslOut, iterations: 128)
        let before = rssBytes()
        checksum &+= try runWorkload(posix: posix, win32: win32, uri: uri, wsl: wsl, wslOut: wslOut, iterations: loops)
        let after = rssBytes()
        let delta = after > before ? after - before : 0

        if checksum == 0 { throw Failure("allocation workload was optimized away") }
        if delta > budgetBytes {
            throw Failure("Swift CanonicalPath allocation check exceeded RSS budget: \(delta) > \(budgetBytes)")
        }
        print("Swift CanonicalPath allocation check passed: RSS delta \(delta) bytes over \(loops) iterations")
    }

    private static func runWorkload(
        posix: CanonicalPathNormalizeOptions,
        win32: CanonicalPathNormalizeOptions,
        uri: CanonicalPathNormalizeOptions,
        wsl: CanonicalPathNormalizeOptions,
        wslOut: CanonicalPathWSLOptions,
        iterations: Int
    ) throws -> Int {
        var checksum = 0
        for _ in 0..<iterations {
            checksum &+= try CanonicalPath.normalize("/home//alice/./repo/src/../README.md", options: posix).count
            checksum &+= try CanonicalPath.normalize("C:\\Users\\Alice\\Repo\\src\\..\\README.md", options: win32).count
            checksum &+= try CanonicalPath.normalize("file:///repo/caf%C3%A9.txt", options: uri).count
            checksum &+= try CanonicalPath.normalize("/mnt/c/Users/Alice/Repo/src/../README.md", options: wsl).count
            checksum &+= try CanonicalPath.relative("c:/repo", "c:/repo/src/file.txt").count
            checksum &+= try CanonicalPath.join("c:/repo", "src/file.txt").count
            checksum &+= try CanonicalPath.isEqual("C:\\Users\\Alice\\Repo", "c:/Users/Alice/Repo", options: win32) ? 1 : 0
            checksum &+= try CanonicalPath.toWin32("c:/Users/Alice/Repo").count
            checksum &+= try CanonicalPath.toWSL("c:/Users/Alice/Repo", options: wslOut).count
            checksum &+= try CanonicalPath.toPOSIX("/home/alice/repo").count
            checksum &+= try CanonicalPath.sanitizeComponent("feature/auth", profile: "portable").count
            checksum &+= try CanonicalPath.encodeComponent("CON.txt", profile: "win32").count
            checksum &+= try CanonicalPath.encodeGitRef("feature/auth").count
        }
        return checksum
    }

    private static func rssBytes() -> UInt64 {
        guard let status = try? String(contentsOfFile: "/proc/self/status", encoding: .utf8) else { return 0 }
        for line in status.split(separator: "\n") where line.hasPrefix("VmRSS:") {
            let fields = line.split(separator: " ").filter { !$0.isEmpty }
            if fields.count >= 2, let kilobytes = UInt64(fields[1]) {
                return kilobytes * 1024
            }
        }
        return 0
    }
}

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
`;
}
