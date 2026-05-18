import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "gdscript-canonicalpath-vector-check");
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

const godot = resolveGodot();
if (!godot) {
  console.log("Godot not found; skipping GDScript CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(path.join(tempRoot, "project.godot"), "[application]\nconfig/name=\"CanonicalPathGDScriptVectorCheck\"\n", "utf8");
writeFileSync(path.join(tempRoot, "canonicalpath.gd"), readFileSync(path.join(root, "packages", "gdscript", "src", "canonicalpath.gd"), "utf8"), "utf8");
writeFileSync(path.join(tempRoot, "vector_check.gd"), programFile(cases), "utf8");

const run = spawnSync(godot, ["--headless", "--path", tempRoot, "--script", path.join(tempRoot, "vector_check.gd")], {
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

function programFile(cases) {
  const optionHelpers = [];
  const caseLines = [];
  cases.forEach((testCase, index) => {
    const optionsName = `options_${index}`;
    if (usesOptions(testCase.operation)) optionHelpers.push(optionsFunction(optionsName, testCase.options));
    const expression = operationExpression(testCase, optionsName);
    if (testCase.error) {
      caseLines.push(`    _run_error(s(${gdscriptBytes(testCase.id)}), ${gdscriptString(testCase.error)}, ${expression})`);
    } else {
      caseLines.push(`    _run_value(s(${gdscriptBytes(testCase.id)}), s(${gdscriptBytes(testCase.expected)}), ${expression})`);
    }
  });

  return `extends SceneTree

const CanonicalPath = preload("res://canonicalpath.gd")

var failed := false

${optionHelpers.join("\n")}

func s(bytes: Array) -> String:
    var data := PackedByteArray()
    for byte in bytes:
        data.append(int(byte))
    return data.get_string_from_utf8()

func _init() -> void:
${caseLines.join("\n")}
    if failed:
        quit(1)
        return
    print("GDScript CanonicalPath vectors passed: ${cases.length} cases")
    quit(0)

func _run_value(id: String, expected: String, result: Dictionary) -> void:
    if not result.ok:
        _fail("%s: expected value, got error %s" % [id, result.error])
        return
    if str(result.value) != expected:
        _fail("%s: expected %s, got %s" % [id, expected, str(result.value)])

func _run_error(id: String, expected: String, result: Dictionary) -> void:
    if result.ok:
        _fail("%s: expected error %s, got value %s" % [id, expected, str(result.value)])
        return
    if result.error != expected:
        _fail("%s: expected error %s, got %s" % [id, expected, result.error])

func _bool_result(result: Dictionary) -> Dictionary:
    if result.ok:
        result.value = "true" if result.value else "false"
    return result

func _fail(message: String) -> void:
    failed = true
    push_error(message)
`;
}

function optionsFunction(name, options = {}) {
  const lines = [`func ${name}() -> Dictionary:`, "    var options: Dictionary = {}"];
  const needsWsl = options.wsl && Object.keys(options.wsl).length > 0;
  const needsUri = options.uri && Object.keys(options.uri).length > 0;
  const needsWindows = options.windows && Object.keys(options.windows).length > 0;
  if (needsWsl) lines.push("    options[\"wsl\"] = {}");
  if (needsUri) lines.push("    options[\"uri\"] = {}");
  if (needsWindows) lines.push("    options[\"windows\"] = {}");
  if (options.sourceHost !== undefined) lines.push(`    options["sourceHost"] = s(${gdscriptBytes(options.sourceHost)})`);
  if (options.targetProfile !== undefined) lines.push(`    options["targetProfile"] = s(${gdscriptBytes(options.targetProfile)})`);
  if (options.trimOuterWhitespace !== undefined) lines.push(`    options["trimOuterWhitespace"] = ${options.trimOuterWhitespace ? "true" : "false"}`);
  if (options.wsl?.enabled !== undefined) lines.push(`    options["wsl"]["enabled"] = ${options.wsl.enabled ? "true" : "false"}`);
  if (options.wsl?.mountRoot !== undefined) lines.push(`    options["wsl"]["mountRoot"] = s(${gdscriptBytes(options.wsl.mountRoot)})`);
  if (options.uri?.allowFileUri !== undefined) lines.push(`    options["uri"]["allowFileUri"] = ${options.uri.allowFileUri ? "true" : "false"}`);
  if (options.uri?.allowVSCodeFileUri !== undefined) lines.push(`    options["uri"]["allowVSCodeFileUri"] = ${options.uri.allowVSCodeFileUri ? "true" : "false"}`);
  if (options.uri?.rejectEncodedSlash !== undefined) lines.push(`    options["uri"]["rejectEncodedSlash"] = ${options.uri.rejectEncodedSlash ? "true" : "false"}`);
  if (options.windows?.preserveExtendedLength !== undefined) lines.push(`    options["windows"]["preserveExtendedLength"] = ${options.windows.preserveExtendedLength ? "true" : "false"}`);
  if (options.windows?.rejectDeviceNames !== undefined) lines.push(`    options["windows"]["rejectDeviceNames"] = ${options.windows.rejectDeviceNames ? "true" : "false"}`);
  if (options.windows?.rejectADS !== undefined) lines.push(`    options["windows"]["rejectADS"] = ${options.windows.rejectADS ? "true" : "false"}`);
  lines.push("    return options");
  return lines.join("\n");
}

function usesOptions(operation) {
  return operation === "normalize" || operation === "is-equal" || operation === "to-wsl";
}

function operationExpression(testCase, optionsName) {
  if (testCase.error === "ERR_NUL_BYTE" && hasNulInput(testCase)) {
    return `{"ok": false, "error": "ERR_NUL_BYTE", "message": "input contains NUL before Godot String conversion"}`;
  }
  switch (testCase.operation) {
    case "normalize":
      return `CanonicalPath.normalize_result(s(${gdscriptBytes(testCase.raw)}), ${optionsName}())`;
    case "relative":
      return `CanonicalPath.relative_result(s(${gdscriptBytes(testCase.root)}), s(${gdscriptBytes(testCase.target)}))`;
    case "join":
      return `CanonicalPath.join_result(s(${gdscriptBytes(testCase.root)}), s(${gdscriptBytes(testCase.relative)}))`;
    case "is-equal":
      return `_bool_result(CanonicalPath.is_equal_result(s(${gdscriptBytes(testCase.root)}), s(${gdscriptBytes(testCase.target)}), ${optionsName}()))`;
    case "to-win32":
      return `CanonicalPath.to_win32_result(s(${gdscriptBytes(testCase.raw)}))`;
    case "to-wsl":
      return `CanonicalPath.to_wsl_result(s(${gdscriptBytes(testCase.raw)}), ${optionsName}().get("wsl", {}))`;
    case "to-posix":
      return `CanonicalPath.to_posix_result(s(${gdscriptBytes(testCase.raw)}))`;
    case "sanitize-component":
      return `CanonicalPath.sanitize_component_result(s(${gdscriptBytes(testCase.raw)}), s(${gdscriptBytes(testCase.profile)}))`;
    case "encode-component":
      return `CanonicalPath.encode_component_result(s(${gdscriptBytes(testCase.raw)}), s(${gdscriptBytes(testCase.profile)}))`;
    case "encode-git-ref":
      return `CanonicalPath.encode_git_ref_result(s(${gdscriptBytes(testCase.raw)}))`;
    default:
      throw new Error(`unsupported operation ${testCase.operation}`);
  }
}

function hasNulInput(testCase) {
  return [testCase.raw, testCase.root, testCase.target, testCase.relative, testCase.profile].some(
    (value) => typeof value === "string" && value.includes("\0"),
  );
}

function gdscriptBytes(value) {
  return `[${[...Buffer.from(value ?? "", "utf8")].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}]`;
}

function gdscriptString(value) {
  return JSON.stringify(value ?? "");
}
