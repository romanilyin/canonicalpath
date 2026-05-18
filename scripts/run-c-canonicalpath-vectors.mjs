import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "c-canonicalpath-vector-check");
const programPath = path.join(tempRoot, "vector_check.c");
const binaryPath = path.join(tempRoot, process.platform === "win32" ? "vector_check.exe" : "vector_check");
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

if (!commandExists("gcc", ["--version"])) {
  console.log("gcc not found; skipping C CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(cases), "utf8");

const compile = spawnSync(
  "gcc",
  [
    "-std=c11",
    "-Wall",
    "-Wextra",
    "-pedantic",
    "-I",
    path.join(root, "packages", "c", "include"),
    path.join(root, "packages", "c", "src", "canonicalpath.c"),
    programPath,
    "-o",
    binaryPath,
  ],
  { stdio: "inherit" },
);
if (compile.error) {
  console.error(compile.error.message);
  process.exit(1);
}
if ((compile.status ?? 1) !== 0) process.exit(compile.status ?? 1);

const run = spawnSync(binaryPath, { stdio: "inherit" });
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function commandExists(command, args) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

function programFile(cases) {
  const optionHelpers = [];
  const caseBlocks = [];
  cases.forEach((testCase, index) => {
    const optionsName = `options_${index}`;
    if (usesOptions(testCase.operation)) optionHelpers.push(optionsFunction(optionsName, testCase.options));
    caseBlocks.push(caseBlock(testCase, optionsName));
  });

  return `#include "canonicalpath.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void assert_value(const char *id, const char *expected, size_t expected_len, canonicalpath_result result) {
  if (result.error_code != NULL) {
    fprintf(stderr, "%s: expected value, got error %s\\n", id, result.error_code);
    exit(1);
  }
  size_t actual_len = strlen(result.value);
  if (actual_len != expected_len || memcmp(result.value, expected, expected_len) != 0) {
    fprintf(stderr, "%s: expected %.*s, got %s\\n", id, (int)expected_len, expected, result.value);
    canonicalpath_result_free(&result);
    exit(1);
  }
  canonicalpath_result_free(&result);
}

static void assert_error(const char *id, const char *expected, canonicalpath_result result) {
  if (result.error_code == NULL) {
    fprintf(stderr, "%s: expected error %s, got value %s\\n", id, expected, result.value);
    canonicalpath_result_free(&result);
    exit(1);
  }
  if (strcmp(result.error_code, expected) != 0) {
    fprintf(stderr, "%s: expected error %s, got %s\\n", id, expected, result.error_code);
    exit(1);
  }
}

static void assert_bool_value(const char *id, int expected, canonicalpath_bool_result result) {
  if (result.error_code != NULL) {
    fprintf(stderr, "%s: expected value, got error %s\\n", id, result.error_code);
    exit(1);
  }
  if (result.value != expected) {
    fprintf(stderr, "%s: expected %s, got %s\\n", id, expected ? "true" : "false", result.value ? "true" : "false");
    exit(1);
  }
}

static void assert_bool_error(const char *id, const char *expected, canonicalpath_bool_result result) {
  if (result.error_code == NULL) {
    fprintf(stderr, "%s: expected error %s, got value %s\\n", id, expected, result.value ? "true" : "false");
    exit(1);
  }
  if (strcmp(result.error_code, expected) != 0) {
    fprintf(stderr, "%s: expected error %s, got %s\\n", id, expected, result.error_code);
    exit(1);
  }
}

${optionHelpers.join("\n")}

int main(void) {
${caseBlocks.join("\n")}
  printf("C CanonicalPath vectors passed: ${cases.length} cases\\n");
  return 0;
}
`;
}

function optionsFunction(name, options = {}) {
  const lines = [`static canonicalpath_normalize_options ${name}(void) {`, "  canonicalpath_normalize_options options;", "  canonicalpath_normalize_options_init(&options);"];
  if (options.sourceHost !== undefined) lines.push(`  options.source_host = ${cString(options.sourceHost)};`);
  if (options.targetProfile !== undefined) lines.push(`  options.target_profile = ${cString(options.targetProfile)};`);
  if (options.trimOuterWhitespace !== undefined) lines.push(`  options.trim_outer_whitespace = ${options.trimOuterWhitespace ? "1" : "0"};`);
  if (options.wsl?.enabled !== undefined) lines.push(`  options.wsl.enabled = ${options.wsl.enabled ? "1" : "0"};`);
  if (options.wsl?.mountRoot !== undefined) lines.push(`  options.wsl.mount_root = ${cString(options.wsl.mountRoot)};`);
  if (options.uri?.allowFileUri !== undefined) lines.push(`  options.uri.allow_file_uri = ${options.uri.allowFileUri ? "1" : "0"};`);
  if (options.uri?.allowVSCodeFileUri !== undefined) lines.push(`  options.uri.allow_vscode_file_uri = ${options.uri.allowVSCodeFileUri ? "1" : "0"};`);
  if (options.uri?.rejectEncodedSlash !== undefined) lines.push(`  options.uri.reject_encoded_slash = ${options.uri.rejectEncodedSlash ? "1" : "0"};`);
  if (options.windows?.preserveExtendedLength !== undefined) lines.push(`  options.windows.preserve_extended_length = ${options.windows.preserveExtendedLength ? "1" : "0"};`);
  if (options.windows?.rejectDeviceNames !== undefined) lines.push(`  options.windows.reject_device_names = ${options.windows.rejectDeviceNames ? "1" : "0"};`);
  if (options.windows?.rejectADS !== undefined) lines.push(`  options.windows.reject_ads = ${options.windows.rejectADS ? "1" : "0"};`);
  lines.push("  return options;", "}");
  return lines.join("\n");
}

function caseBlock(testCase, optionsName) {
  const id = cString(testCase.id);
  const expected = testCase.expected ?? "";
  const expectedBytes = Buffer.from(expected, "utf8");
  const expect = testCase.error
    ? testCase.operation === "is-equal"
      ? `assert_bool_error(${id}, ${cString(testCase.error)}, result);`
      : `assert_error(${id}, ${cString(testCase.error)}, result);`
    : testCase.operation === "is-equal"
      ? `assert_bool_value(${id}, ${expected === "true" ? "1" : "0"}, result);`
      : `assert_value(${id}, ${cBytes(expected)}, ${expectedBytes.length}, result);`;
  return `  {
    ${operationSetup(testCase, optionsName)}
    ${operationResult(testCase, optionsName)}
    ${expect}
  }`;
}

function operationSetup(testCase, optionsName) {
  if (!usesOptions(testCase.operation)) return "";
  return `canonicalpath_normalize_options options = ${optionsName}();`;
}

function operationResult(testCase) {
  switch (testCase.operation) {
    case "normalize":
      return `canonicalpath_result result = canonicalpath_normalize_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)}, &options);`;
    case "relative":
      return `canonicalpath_result result = canonicalpath_relative_n(${cBytes(testCase.root)}, ${byteLength(testCase.root)}, ${cBytes(testCase.target)}, ${byteLength(testCase.target)});`;
    case "join":
      return `canonicalpath_result result = canonicalpath_join_n(${cBytes(testCase.root)}, ${byteLength(testCase.root)}, ${cBytes(testCase.relative)}, ${byteLength(testCase.relative)});`;
    case "is-equal":
      return `canonicalpath_bool_result result = canonicalpath_is_equal_n(${cBytes(testCase.root)}, ${byteLength(testCase.root)}, ${cBytes(testCase.target)}, ${byteLength(testCase.target)}, &options);`;
    case "to-win32":
      return `canonicalpath_result result = canonicalpath_to_win32_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)});`;
    case "to-wsl":
      return `canonicalpath_result result = canonicalpath_to_wsl_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)}, &options.wsl);`;
    case "to-posix":
      return `canonicalpath_result result = canonicalpath_to_posix_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)});`;
    case "sanitize-component":
      return `canonicalpath_result result = canonicalpath_sanitize_component_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)}, ${cString(testCase.profile)});`;
    case "encode-component":
      return `canonicalpath_result result = canonicalpath_encode_component_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)}, ${cString(testCase.profile)});`;
    case "encode-git-ref":
      return `canonicalpath_result result = canonicalpath_encode_git_ref_n(${cBytes(testCase.raw)}, ${byteLength(testCase.raw)});`;
    default:
      throw new Error(`unsupported operation ${testCase.operation}`);
  }
}

function usesOptions(operation) {
  return operation === "normalize" || operation === "is-equal" || operation === "to-wsl";
}

function byteLength(value) {
  return Buffer.from(value ?? "", "utf8").length;
}

function cBytes(value) {
  const bytes = Buffer.from(value ?? "", "utf8");
  return `(const char *)(const unsigned char[]){${[...bytes].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}${bytes.length > 0 ? ", " : ""}0}`;
}

function cString(value) {
  const bytes = Buffer.from(value ?? "", "utf8");
  let out = '"';
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c) out += String.fromCharCode(byte);
    else if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += "\\\\";
    else out += `\\${byte.toString(8).padStart(3, "0")}`;
  }
  out += '"';
  return out;
}
