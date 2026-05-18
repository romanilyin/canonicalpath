import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "haxe-canonicalpath-vector-check");
const mainPath = path.join(tempRoot, "HaxeVectorCheck.hx");
const sourceRoot = path.join(root, "packages", "haxe", "src");
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

const haxe = resolveHaxe();
if (!haxe) {
  console.log("haxe not found; skipping Haxe CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(mainPath, programFile(cases), "utf8");

const run = spawnSync(haxe, ["-cp", sourceRoot, "-cp", tempRoot, "-main", "HaxeVectorCheck", "--interp"], {
  stdio: "inherit",
});
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

function programFile(cases) {
  const optionHelpers = [];
  const caseLines = [];
  cases.forEach((testCase, index) => {
    const optionsName = `options_${index}`;
    if (usesOptions(testCase.operation)) optionHelpers.push(optionsFunction(optionsName, testCase.options));
    const expression = operationExpression(testCase, optionsName);
    if (testCase.error) {
      caseLines.push(`    runError(s(${haxeBytes(testCase.id)}), ${haxeString(testCase.error)}, function() return ${expression});`);
    } else {
      caseLines.push(`    runValue(s(${haxeBytes(testCase.id)}), s(${haxeBytes(testCase.expected)}), function() return ${expression});`);
    }
  });

  return `import haxe.io.Bytes;
import CanonicalPath.CanonicalPathError;
import CanonicalPath.CanonicalPathNormalizeOptions;

${optionHelpers.join("\n")}

class HaxeVectorCheck {
  public static function s(bytes: Array<Int>): String {
    var value = Bytes.alloc(bytes.length);
    for (index in 0...bytes.length) value.set(index, bytes[index]);
    return value.toString();
  }

  static function runValue(id: String, expected: String, action: Void -> String): Void {
    try {
      var actual = action();
      if (actual != expected) throw id + ": expected " + expected + ", got " + actual;
    } catch (error: CanonicalPathError) {
      throw id + ": expected value, got error " + error.code;
    }
  }

  static function runError(id: String, expected: String, action: Void -> String): Void {
    try {
      var actual = action();
      throw id + ": expected error " + expected + ", got value " + actual;
    } catch (error: CanonicalPathError) {
      if (error.code != expected) throw id + ": expected error " + expected + ", got " + error.code;
    }
  }

  static function main(): Void {
${caseLines.join("\n")}
    trace("Haxe CanonicalPath vectors passed: ${cases.length} cases");
  }
}
`;
}

function optionsFunction(name, options = {}) {
  const assignments = [];
  if (options.sourceHost !== undefined) assignments.push(`  options.sourceHost = HaxeVectorCheck.s(${haxeBytes(options.sourceHost)});`);
  if (options.targetProfile !== undefined) assignments.push(`  options.targetProfile = HaxeVectorCheck.s(${haxeBytes(options.targetProfile)});`);
  if (options.trimOuterWhitespace !== undefined) assignments.push(`  options.trimOuterWhitespace = ${options.trimOuterWhitespace ? "true" : "false"};`);
  if (options.wsl?.enabled !== undefined) assignments.push(`  options.wsl.enabled = ${options.wsl.enabled ? "true" : "false"};`);
  if (options.wsl?.mountRoot !== undefined) assignments.push(`  options.wsl.mountRoot = HaxeVectorCheck.s(${haxeBytes(options.wsl.mountRoot)});`);
  if (options.uri?.allowFileUri !== undefined) assignments.push(`  options.uri.allowFileUri = ${options.uri.allowFileUri ? "true" : "false"};`);
  if (options.uri?.allowVSCodeFileUri !== undefined) assignments.push(`  options.uri.allowVSCodeFileUri = ${options.uri.allowVSCodeFileUri ? "true" : "false"};`);
  if (options.uri?.rejectEncodedSlash !== undefined) assignments.push(`  options.uri.rejectEncodedSlash = ${options.uri.rejectEncodedSlash ? "true" : "false"};`);
  if (options.windows?.preserveExtendedLength !== undefined) assignments.push(`  options.windows.preserveExtendedLength = ${options.windows.preserveExtendedLength ? "true" : "false"};`);
  if (options.windows?.rejectDeviceNames !== undefined) assignments.push(`  options.windows.rejectDeviceNames = ${options.windows.rejectDeviceNames ? "true" : "false"};`);
  if (options.windows?.rejectADS !== undefined) assignments.push(`  options.windows.rejectADS = ${options.windows.rejectADS ? "true" : "false"};`);
  if (assignments.length === 0) return `function ${name}(): CanonicalPathNormalizeOptions {\n  return new CanonicalPathNormalizeOptions();\n}`;
  return [`function ${name}(): CanonicalPathNormalizeOptions {`, "  var options = new CanonicalPathNormalizeOptions();", ...assignments, "  return options;", "}"].join("\n");
}

function usesOptions(operation) {
  return operation === "normalize" || operation === "is-equal" || operation === "to-wsl";
}

function operationExpression(testCase, optionsName) {
  switch (testCase.operation) {
    case "normalize":
      return `CanonicalPath.normalize(s(${haxeBytes(testCase.raw)}), ${optionsName}())`;
    case "relative":
      return `CanonicalPath.relative(s(${haxeBytes(testCase.root)}), s(${haxeBytes(testCase.target)}))`;
    case "join":
      return `CanonicalPath.join(s(${haxeBytes(testCase.root)}), s(${haxeBytes(testCase.relative)}))`;
    case "is-equal":
      return `Std.string(CanonicalPath.isEqual(s(${haxeBytes(testCase.root)}), s(${haxeBytes(testCase.target)}), ${optionsName}()))`;
    case "to-win32":
      return `CanonicalPath.toWin32(s(${haxeBytes(testCase.raw)}))`;
    case "to-wsl":
      return `CanonicalPath.toWSL(s(${haxeBytes(testCase.raw)}), ${optionsName}().wsl)`;
    case "to-posix":
      return `CanonicalPath.toPOSIX(s(${haxeBytes(testCase.raw)}))`;
    case "sanitize-component":
      return `CanonicalPath.sanitizeComponent(s(${haxeBytes(testCase.raw)}), s(${haxeBytes(testCase.profile)}))`;
    case "encode-component":
      return `CanonicalPath.encodeComponent(s(${haxeBytes(testCase.raw)}), s(${haxeBytes(testCase.profile)}))`;
    case "encode-git-ref":
      return `CanonicalPath.encodeGitRef(s(${haxeBytes(testCase.raw)}))`;
    default:
      throw new Error(`unsupported operation ${testCase.operation}`);
  }
}

function haxeBytes(value) {
  return `[${[...Buffer.from(value ?? "", "utf8")].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}]`;
}

function haxeString(value) {
  return JSON.stringify(value ?? "");
}
