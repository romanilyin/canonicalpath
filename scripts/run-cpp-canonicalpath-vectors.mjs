import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "cpp-canonicalpath-vector-check");
const programPath = path.join(tempRoot, "vector_check.cpp");
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

if (!commandExists("g++", ["--version"])) {
  console.log("g++ not found; skipping C++ CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(cases), "utf8");

const compile = spawnSync(
  "g++",
  [
    "-std=c++20",
    "-Wall",
    "-Wextra",
    "-pedantic",
    "-I",
    path.join(root, "packages", "cpp", "include"),
    path.join(root, "packages", "cpp", "src", "canonicalpath.cpp"),
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
  const caseLines = [];
  cases.forEach((testCase, index) => {
    const optionsName = `options_${index}`;
    optionHelpers.push(optionsFunction(optionsName, testCase.options));
    const expression = operationExpression(testCase, optionsName);
    if (testCase.error) {
      caseLines.push(`    run_error(${cxxString(testCase.id)}, ${cxxString(testCase.error)}, [&]() { (void)(${expression}); });`);
    } else {
      caseLines.push(`    run_value(${cxxString(testCase.id)}, ${cxxString(testCase.expected)}, [&]() { return ${expression}; });`);
    }
  });

  return `#include "canonicalpath.hpp"

#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>

${optionHelpers.join("\n")}

int main() {
  int count = 0;
  auto run_value = [&](const std::string &id, const std::string &expected, const std::function<std::string()> &action) {
    try {
      std::string actual = action();
      if (actual != expected) throw std::runtime_error(id + ": expected " + expected + ", got " + actual);
      ++count;
    } catch (const canonicalpath::path_error &error) {
      throw std::runtime_error(id + ": expected value, got error " + error.code());
    }
  };
  auto run_error = [&](const std::string &id, const std::string &expected, const std::function<void()> &action) {
    try {
      action();
    } catch (const canonicalpath::path_error &error) {
      if (error.code() == expected) {
        ++count;
        return;
      }
      throw std::runtime_error(id + ": expected error " + expected + ", got " + error.code());
    }
    throw std::runtime_error(id + ": expected error " + expected + ", got value");
  };

${caseLines.join("\n")}

  std::cout << "C++ CanonicalPath vectors passed: " << count << " cases" << std::endl;
  return 0;
}
`;
}

function optionsFunction(name, options = {}) {
  const lines = [`canonicalpath::NormalizeOptions ${name}() {`, "  canonicalpath::NormalizeOptions options;"];
  if (options.sourceHost !== undefined) lines.push(`  options.source_host = ${cxxString(options.sourceHost)};`);
  if (options.targetProfile !== undefined) lines.push(`  options.target_profile = ${cxxString(options.targetProfile)};`);
  if (options.trimOuterWhitespace !== undefined) lines.push(`  options.trim_outer_whitespace = ${options.trimOuterWhitespace ? "true" : "false"};`);
  if (options.wsl?.enabled !== undefined) lines.push(`  options.wsl.enabled = ${options.wsl.enabled ? "true" : "false"};`);
  if (options.wsl?.mountRoot !== undefined) lines.push(`  options.wsl.mount_root = ${cxxString(options.wsl.mountRoot)};`);
  if (options.uri?.allowFileUri !== undefined) lines.push(`  options.uri.allow_file_uri = ${options.uri.allowFileUri ? "true" : "false"};`);
  if (options.uri?.allowVSCodeFileUri !== undefined) lines.push(`  options.uri.allow_vscode_file_uri = ${options.uri.allowVSCodeFileUri ? "true" : "false"};`);
  if (options.uri?.rejectEncodedSlash !== undefined) lines.push(`  options.uri.reject_encoded_slash = ${options.uri.rejectEncodedSlash ? "true" : "false"};`);
  if (options.windows?.preserveExtendedLength !== undefined) {
    lines.push(`  options.windows.preserve_extended_length = ${options.windows.preserveExtendedLength ? "true" : "false"};`);
  }
  if (options.windows?.rejectDeviceNames !== undefined) lines.push(`  options.windows.reject_device_names = ${options.windows.rejectDeviceNames ? "true" : "false"};`);
  if (options.windows?.rejectADS !== undefined) lines.push(`  options.windows.reject_ads = ${options.windows.rejectADS ? "true" : "false"};`);
  lines.push("  return options;", "}");
  return lines.join("\n");
}

function operationExpression(testCase, optionsName) {
  switch (testCase.operation) {
    case "normalize":
      return `canonicalpath::normalize(${cxxString(testCase.raw)}, ${optionsName}())`;
    case "relative":
      return `canonicalpath::relative(${cxxString(testCase.root)}, ${cxxString(testCase.target)})`;
    case "join":
      return `canonicalpath::join(${cxxString(testCase.root)}, ${cxxString(testCase.relative)})`;
    case "is-equal":
      return `canonicalpath::is_equal(${cxxString(testCase.root)}, ${cxxString(testCase.target)}, ${optionsName}()) ? std::string("true") : std::string("false")`;
    case "to-win32":
      return `canonicalpath::to_win32(${cxxString(testCase.raw)})`;
    case "to-wsl":
      return `canonicalpath::to_wsl(${cxxString(testCase.raw)}, ${optionsName}().wsl)`;
    case "to-posix":
      return `canonicalpath::to_posix(${cxxString(testCase.raw)})`;
    case "sanitize-component":
      return `canonicalpath::sanitize_component(${cxxString(testCase.raw)}, ${cxxString(testCase.profile)})`;
    case "encode-component":
      return `canonicalpath::encode_component(${cxxString(testCase.raw)}, ${cxxString(testCase.profile)})`;
    case "encode-git-ref":
      return `canonicalpath::encode_git_ref(${cxxString(testCase.raw)})`;
    default:
      throw new Error(`unsupported operation ${testCase.operation}`);
  }
}

function cxxString(value) {
  const bytes = Buffer.from(value ?? "", "utf8");
  let out = '"';
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x22) {
      out += '\\"';
    } else if (byte === 0x5c) {
      out += '\\\\';
    } else {
      out += `\\${byte.toString(8).padStart(3, "0")}`;
    }
  }
  out += '"';
  return `std::string(${out}, ${bytes.length})`;
}
