import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "swift-canonicalpath-vector-check");
const sourceRoot = path.join(tempRoot, "Sources", "SwiftVectorCheck");
const packagePath = path.join(tempRoot, "Package.swift");
const mainPath = path.join(sourceRoot, "main.swift");
const vectorFiles = [
  "lexical_cases.json",
  "windows_cases.json",
  "wsl_cases.json",
  "uri_cases.json",
  "unicode_cases.json",
  "security_cases.json",
  "component_cases.json",
  "git_cases.json",
  "equality_cases.json",
].map((name) => path.join(root, "spec", "testdata", name));

const swift = resolveSwift();
if (!swift) {
  console.log("swift not found; skipping Swift CanonicalPath vector check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(sourceRoot, { recursive: true });
writeFileSync(packagePath, packageFile(), "utf8");
writeFileSync(mainPath, programFile(), "utf8");

const run = spawnSync(
  swift,
  ["run", "--package-path", tempRoot, "SwiftVectorCheck", ...vectorFiles],
  { stdio: "inherit" },
);
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
    name: "SwiftVectorCheck",
    products: [
        .executable(name: "SwiftVectorCheck", targets: ["SwiftVectorCheck"])
    ],
    dependencies: [
        .package(path: "${packageDependencyPath}")
    ],
    targets: [
        .executableTarget(name: "SwiftVectorCheck", dependencies: [.product(name: "CanonicalPath", package: "swift")])
    ]
)
`;
}

function programFile() {
  return String.raw`import CanonicalPath
import Foundation

struct VectorFile: Decodable {
    let version: Int
    let cases: [VectorCase]
}

struct VectorCase: Decodable {
    let id: String
    let operation: String
    let raw: String?
    let root: String?
    let target: String?
    let relative: String?
    let profile: String?
    let options: VectorOptions?
    let expected: String?
    let error: String?
}

struct VectorOptions: Decodable {
    let sourceHost: String?
    let targetProfile: String?
    let wsl: VectorWSLOptions?
    let uri: VectorURIOptions?
    let windows: VectorWindowsOptions?
    let trimOuterWhitespace: Bool?
}

struct VectorWSLOptions: Decodable {
    let enabled: Bool?
    let mountRoot: String?
}

struct VectorURIOptions: Decodable {
    let allowFileUri: Bool?
    let allowVSCodeFileUri: Bool?
    let rejectEncodedSlash: Bool?
}

struct VectorWindowsOptions: Decodable {
    let preserveExtendedLength: Bool?
    let rejectDeviceNames: Bool?
    let rejectADS: Bool?
}

@main
enum Program {
    static func main() throws {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.isEmpty { throw Failure("Expected one or more canonicalpath vector files.") }

        var count = 0
        for file in args {
            let data = try Data(contentsOf: URL(fileURLWithPath: file))
            let vectors = try JSONDecoder().decode(VectorFile.self, from: data)
            for testCase in vectors.cases {
                try runVector(testCase)
                count += 1
            }
        }

        print("Swift CanonicalPath vectors passed: \(count) cases")
    }

    private static func runVector(_ testCase: VectorCase) throws {
        do {
            let actual = try runOperation(testCase)
            if let expectedError = testCase.error {
                throw Failure("\(testCase.id): expected error \(expectedError), got value \(actual)")
            }
            if actual != testCase.expected {
                throw Failure("\(testCase.id): expected \(testCase.expected ?? "<nil>"), got \(actual)")
            }
        } catch let error as CanonicalPathError {
            guard let expectedError = testCase.error, error.code == expectedError else {
                throw Failure("\(testCase.id): expected error \(testCase.error ?? "<none>"), got \(error.code)")
            }
        }
    }

    private static func runOperation(_ testCase: VectorCase) throws -> String {
        switch testCase.operation {
        case "normalize":
            return try CanonicalPath.normalize(required(testCase.raw, testCase, "raw"), options: toOptions(testCase.options))
        case "relative":
            return try CanonicalPath.relative(required(testCase.root, testCase, "root"), required(testCase.target, testCase, "target"))
        case "join":
            return try CanonicalPath.join(required(testCase.root, testCase, "root"), required(testCase.relative, testCase, "relative"))
        case "is-equal":
            return try CanonicalPath.isEqual(required(testCase.root, testCase, "root"), required(testCase.target, testCase, "target"), options: toOptions(testCase.options)) ? "true" : "false"
        case "to-win32":
            return try CanonicalPath.toWin32(required(testCase.raw, testCase, "raw"))
        case "to-wsl":
            return try CanonicalPath.toWSL(required(testCase.raw, testCase, "raw"), options: toWSLOptions(testCase.options?.wsl))
        case "to-posix":
            return try CanonicalPath.toPOSIX(required(testCase.raw, testCase, "raw"))
        case "sanitize-component":
            return try CanonicalPath.sanitizeComponent(required(testCase.raw, testCase, "raw"), profile: required(testCase.profile, testCase, "profile"))
        case "encode-component":
            return try CanonicalPath.encodeComponent(required(testCase.raw, testCase, "raw"), profile: required(testCase.profile, testCase, "profile"))
        case "encode-git-ref":
            return try CanonicalPath.encodeGitRef(required(testCase.raw, testCase, "raw"))
        default:
            throw Failure("\(testCase.id): unsupported operation \(testCase.operation)")
        }
    }

    private static func toOptions(_ source: VectorOptions?) -> CanonicalPathNormalizeOptions {
        CanonicalPathNormalizeOptions(
            sourceHost: source?.sourceHost ?? "",
            targetProfile: source?.targetProfile ?? "",
            wsl: toWSLOptions(source?.wsl),
            uri: CanonicalPathURIOptions(
                allowFileUri: source?.uri?.allowFileUri ?? false,
                allowVSCodeFileUri: source?.uri?.allowVSCodeFileUri ?? false,
                rejectEncodedSlash: source?.uri?.rejectEncodedSlash
            ),
            windows: CanonicalPathWindowsOptions(
                preserveExtendedLength: source?.windows?.preserveExtendedLength ?? false,
                rejectDeviceNames: source?.windows?.rejectDeviceNames ?? false,
                rejectADS: source?.windows?.rejectADS ?? false
            ),
            trimOuterWhitespace: source?.trimOuterWhitespace ?? false
        )
    }

    private static func toWSLOptions(_ source: VectorWSLOptions?) -> CanonicalPathWSLOptions {
        CanonicalPathWSLOptions(enabled: source?.enabled ?? false, mountRoot: source?.mountRoot ?? "/mnt")
    }

    private static func required(_ value: String?, _ testCase: VectorCase, _ field: String) throws -> String {
        guard let value else { throw Failure("\(testCase.id): missing \(field)") }
        return value
    }
}

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
`;
}
