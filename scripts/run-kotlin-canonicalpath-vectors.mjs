import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "kotlin-canonicalpath-vector-check");
const mainPath = path.join(tempRoot, "VectorCheck.kt");
const jarPath = path.join(tempRoot, "kotlin-canonicalpath-vector-check.jar");
const librarySources = [
  path.join(root, "packages", "kotlin", "src", "main", "kotlin", "com", "canonicalpath", "CanonicalPath.kt"),
  path.join(root, "packages", "kotlin", "src", "main", "kotlin", "com", "canonicalpath", "CanonicalPathHttpClient.kt"),
];
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

const kotlinc = resolveKotlinc();
const java = resolveJava();
if (!kotlinc || !java) {
  console.log("kotlinc or java not found; skipping Kotlin CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(mainPath, programFile(cases), "utf8");

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

function programFile(cases) {
  const optionHelpers = [];
  const caseLines = [];
  cases.forEach((testCase, index) => {
    const optionsName = `options_${index}`;
    if (usesOptions(testCase.operation)) optionHelpers.push(optionsFunction(optionsName, testCase.options));
    const expression = operationExpression(testCase, optionsName);
    if (testCase.error) {
      caseLines.push(`    runError(s(${kotlinBytes(testCase.id)}), ${kotlinString(testCase.error)}) { ${expression} }`);
    } else {
      caseLines.push(`    runValue(s(${kotlinBytes(testCase.id)}), s(${kotlinBytes(testCase.expected)})) { ${expression} }`);
    }
  });

  return `import com.canonicalpath.CanonicalPath
import com.canonicalpath.CanonicalPathException
import com.canonicalpath.CanonicalPathNormalizeOptions

${optionHelpers.join("\n")}

fun s(vararg bytes: Int): String = bytes.map { it.toByte() }.toByteArray().toString(Charsets.UTF_8)

fun runValue(id: String, expected: String, action: () -> String) {
    try {
        val actual = action()
        if (actual != expected) throw IllegalStateException("$id: expected $expected, got $actual")
    } catch (exception: CanonicalPathException) {
        throw IllegalStateException("$id: expected value, got error \${exception.code}")
    }
}

fun runError(id: String, expected: String, action: () -> String) {
    try {
        val actual = action()
        throw IllegalStateException("$id: expected error $expected, got value $actual")
    } catch (exception: CanonicalPathException) {
        if (exception.code != expected) throw IllegalStateException("$id: expected error $expected, got \${exception.code}")
    }
}

fun main() {
${caseLines.join("\n")}
    println("Kotlin CanonicalPath vectors passed: ${cases.length} cases")
}
`;
}

function optionsFunction(name, options = {}) {
  const assignments = [];
  if (options.sourceHost !== undefined) assignments.push(`    options.sourceHost = s(${kotlinBytes(options.sourceHost)})`);
  if (options.targetProfile !== undefined) assignments.push(`    options.targetProfile = s(${kotlinBytes(options.targetProfile)})`);
  if (options.trimOuterWhitespace !== undefined) assignments.push(`    options.trimOuterWhitespace = ${options.trimOuterWhitespace ? "true" : "false"}`);
  if (options.wsl?.enabled !== undefined) assignments.push(`    options.wsl.enabled = ${options.wsl.enabled ? "true" : "false"}`);
  if (options.wsl?.mountRoot !== undefined) assignments.push(`    options.wsl.mountRoot = s(${kotlinBytes(options.wsl.mountRoot)})`);
  if (options.uri?.allowFileUri !== undefined) assignments.push(`    options.uri.allowFileUri = ${options.uri.allowFileUri ? "true" : "false"}`);
  if (options.uri?.allowVSCodeFileUri !== undefined) assignments.push(`    options.uri.allowVSCodeFileUri = ${options.uri.allowVSCodeFileUri ? "true" : "false"}`);
  if (options.uri?.rejectEncodedSlash !== undefined) assignments.push(`    options.uri.rejectEncodedSlash = ${options.uri.rejectEncodedSlash ? "true" : "false"}`);
  if (options.windows?.preserveExtendedLength !== undefined) assignments.push(`    options.windows.preserveExtendedLength = ${options.windows.preserveExtendedLength ? "true" : "false"}`);
  if (options.windows?.rejectDeviceNames !== undefined) assignments.push(`    options.windows.rejectDeviceNames = ${options.windows.rejectDeviceNames ? "true" : "false"}`);
  if (options.windows?.rejectADS !== undefined) assignments.push(`    options.windows.rejectADS = ${options.windows.rejectADS ? "true" : "false"}`);
  if (assignments.length === 0) return `fun ${name}(): CanonicalPathNormalizeOptions = CanonicalPathNormalizeOptions()`;
  return [`fun ${name}(): CanonicalPathNormalizeOptions {`, "    val options = CanonicalPathNormalizeOptions()", ...assignments, "    return options", "}"].join("\n");
}

function usesOptions(operation) {
  return operation === "normalize" || operation === "is-equal" || operation === "to-wsl";
}

function operationExpression(testCase, optionsName) {
  switch (testCase.operation) {
    case "normalize":
      return `CanonicalPath.normalize(s(${kotlinBytes(testCase.raw)}), ${optionsName}())`;
    case "relative":
      return `CanonicalPath.relative(s(${kotlinBytes(testCase.root)}), s(${kotlinBytes(testCase.target)}))`;
    case "join":
      return `CanonicalPath.join(s(${kotlinBytes(testCase.root)}), s(${kotlinBytes(testCase.relative)}))`;
    case "is-equal":
      return `CanonicalPath.isEqual(s(${kotlinBytes(testCase.root)}), s(${kotlinBytes(testCase.target)}), ${optionsName}()).toString()`;
    case "to-win32":
      return `CanonicalPath.toWin32(s(${kotlinBytes(testCase.raw)}))`;
    case "to-wsl":
      return `CanonicalPath.toWSL(s(${kotlinBytes(testCase.raw)}), ${optionsName}().wsl)`;
    case "to-posix":
      return `CanonicalPath.toPOSIX(s(${kotlinBytes(testCase.raw)}))`;
    case "sanitize-component":
      return `CanonicalPath.sanitizeComponent(s(${kotlinBytes(testCase.raw)}), s(${kotlinBytes(testCase.profile)}))`;
    case "encode-component":
      return `CanonicalPath.encodeComponent(s(${kotlinBytes(testCase.raw)}), s(${kotlinBytes(testCase.profile)}))`;
    case "encode-git-ref":
      return `CanonicalPath.encodeGitRef(s(${kotlinBytes(testCase.raw)}))`;
    default:
      throw new Error(`unsupported operation ${testCase.operation}`);
  }
}

function kotlinBytes(value) {
  return [...Buffer.from(value ?? "", "utf8")].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ");
}

function kotlinString(value) {
  return JSON.stringify(value ?? "");
}
