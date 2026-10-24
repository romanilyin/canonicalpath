import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot as root, requireCargo, runCargo } from "./rust-toolchain.mjs";

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

const cargo = requireCargo();
const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);
if (cases.length === 0) throw new Error("Rust shared vector check requires at least one test case");

const temporaryBase = path.join(root, "tmp");
mkdirSync(temporaryBase, { recursive: true });
const tempRoot = mkdtempSync(path.join(temporaryBase, "rust-canonicalpath-vector-check-"));
try {
  const cargoTomlPath = path.join(tempRoot, "Cargo.toml");
  const sourceRoot = path.join(tempRoot, "src");
  mkdirSync(sourceRoot);
  writeFileSync(cargoTomlPath, cargoToml(), "utf8");
  writeFileSync(path.join(sourceRoot, "main.rs"), programFile(cases), "utf8");
  runCargo(cargo, ["run", "--quiet", "--offline", "--manifest-path", cargoTomlPath]);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function cargoToml() {
  const packagePath = path.join(root, "packages", "rust").replaceAll("\\", "/");
  return `[package]
name = "canonicalpath-rust-vector-check"
version = "2026.5.18-2"
edition = "2021"

[dependencies]
canonicalpath-rust = { path = "${packagePath}" }
`;
}

function programFile(cases) {
  const optionHelpers = [];
  const caseLines = [];
  cases.forEach((testCase, index) => {
    const optionsName = `options_${index}`;
    if (usesOptions(testCase.operation)) optionHelpers.push(optionsFunction(optionsName, testCase.options));
    const expression = operationExpression(testCase, optionsName);
    if (testCase.error) {
      caseLines.push(`    run_error(&s(${rustBytes(testCase.id)}), ${rustString(testCase.error)}, || { ${expression} });`);
    } else {
      caseLines.push(`    run_value(&s(${rustBytes(testCase.id)}), &s(${rustBytes(testCase.expected)}), || { ${expression} });`);
    }
  });

  return `use canonicalpath_rust::{self, NormalizeOptions, PathError};

${optionHelpers.join("\n")}

fn s(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn run_value<F>(id: &str, expected: &str, action: F)
where
    F: FnOnce() -> Result<String, PathError>,
{
    match action() {
        Ok(actual) if actual == expected => {}
        Ok(actual) => panic!("{}: expected {}, got {}", id, expected, actual),
        Err(error) => panic!("{}: expected value, got error {}", id, error.code()),
    }
}

fn run_error<F>(id: &str, expected: &str, action: F)
where
    F: FnOnce() -> Result<String, PathError>,
{
    match action() {
        Ok(actual) => panic!("{}: expected error {}, got value {}", id, expected, actual),
        Err(error) if error.code() == expected => {}
        Err(error) => panic!("{}: expected error {}, got {}", id, expected, error.code()),
    }
}

fn main() {
${caseLines.join("\n")}
    println!("Rust CanonicalPath vectors passed: {} cases", ${cases.length});
}
`;
}

function optionsFunction(name, options = {}) {
  const assignments = [];
  if (options.sourceHost !== undefined) assignments.push(`    options.source_host = s(${rustBytes(options.sourceHost)});`);
  if (options.targetProfile !== undefined) assignments.push(`    options.target_profile = s(${rustBytes(options.targetProfile)});`);
  if (options.trimOuterWhitespace !== undefined) assignments.push(`    options.trim_outer_whitespace = ${options.trimOuterWhitespace ? "true" : "false"};`);
  if (options.wsl?.enabled !== undefined) assignments.push(`    options.wsl.enabled = ${options.wsl.enabled ? "true" : "false"};`);
  if (options.wsl?.mountRoot !== undefined) assignments.push(`    options.wsl.mount_root = s(${rustBytes(options.wsl.mountRoot)});`);
  if (options.uri?.allowFileUri !== undefined) assignments.push(`    options.uri.allow_file_uri = ${options.uri.allowFileUri ? "true" : "false"};`);
  if (options.uri?.allowVSCodeFileUri !== undefined) assignments.push(`    options.uri.allow_vscode_file_uri = ${options.uri.allowVSCodeFileUri ? "true" : "false"};`);
  if (options.uri?.rejectEncodedSlash !== undefined) assignments.push(`    options.uri.reject_encoded_slash = ${options.uri.rejectEncodedSlash ? "true" : "false"};`);
  if (options.windows?.preserveExtendedLength !== undefined) {
    assignments.push(`    options.windows.preserve_extended_length = ${options.windows.preserveExtendedLength ? "true" : "false"};`);
  }
  if (options.windows?.rejectDeviceNames !== undefined) assignments.push(`    options.windows.reject_device_names = ${options.windows.rejectDeviceNames ? "true" : "false"};`);
  if (options.windows?.rejectADS !== undefined) assignments.push(`    options.windows.reject_ads = ${options.windows.rejectADS ? "true" : "false"};`);
  if (assignments.length === 0) return `fn ${name}() -> NormalizeOptions {\n    NormalizeOptions::default()\n}`;
  const lines = [`fn ${name}() -> NormalizeOptions {`, "    let mut options = NormalizeOptions::default();", ...assignments];
  lines.push("    options", "}");
  return lines.join("\n");
}

function usesOptions(operation) {
  return operation === "normalize" || operation === "is-equal" || operation === "to-wsl";
}

function operationExpression(testCase, optionsName) {
  switch (testCase.operation) {
    case "normalize":
      return `canonicalpath_rust::normalize_with_options(&s(${rustBytes(testCase.raw)}), &${optionsName}())`;
    case "relative":
      return `canonicalpath_rust::relative(&s(${rustBytes(testCase.root)}), &s(${rustBytes(testCase.target)}))`;
    case "join":
      return `canonicalpath_rust::join(&s(${rustBytes(testCase.root)}), &s(${rustBytes(testCase.relative)}))`;
    case "is-equal":
      return `canonicalpath_rust::is_equal(&s(${rustBytes(testCase.root)}), &s(${rustBytes(testCase.target)}), &${optionsName}()).map(|value| value.to_string())`;
    case "to-win32":
      return `canonicalpath_rust::to_win32(&s(${rustBytes(testCase.raw)}))`;
    case "to-wsl":
      return `{ let options = ${optionsName}(); canonicalpath_rust::to_wsl(&s(${rustBytes(testCase.raw)}), &options.wsl) }`;
    case "to-posix":
      return `canonicalpath_rust::to_posix(&s(${rustBytes(testCase.raw)}))`;
    case "sanitize-component":
      return `canonicalpath_rust::sanitize_component(&s(${rustBytes(testCase.raw)}), ${rustString(testCase.profile)})`;
    case "encode-component":
      return `canonicalpath_rust::encode_component(&s(${rustBytes(testCase.raw)}), ${rustString(testCase.profile)})`;
    case "encode-git-ref":
      return `canonicalpath_rust::encode_git_ref(&s(${rustBytes(testCase.raw)}))`;
    default:
      throw new Error(`unsupported operation ${testCase.operation}`);
  }
}

function rustBytes(value) {
  const bytes = Buffer.from(value ?? "", "utf8");
  return `&[${[...bytes].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}]`;
}

function rustString(value) {
  return JSON.stringify(value ?? "");
}
