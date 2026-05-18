import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "dart-canonicalpath-vector-check");
const programPath = path.join(tempRoot, "vector_check.dart");
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

const dart = resolveDart();
if (!dart) {
  console.log("Dart SDK not found; skipping Dart CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(cases), "utf8");

const run = runDart(dart, [programPath]);
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolveDart() {
  const direct = process.env.DART || "dart";
  const directProbe = spawnSync(direct, ["--version"], { stdio: "ignore" });
  if (!directProbe.error && directProbe.status === 0) return { kind: "direct", command: direct };

  const cmdProbe = spawnSync("cmd.exe", ["/d", "/c", "dart --version"], { stdio: "ignore" });
  if (!cmdProbe.error && cmdProbe.status === 0) return { kind: "cmd", command: "dart" };
  return undefined;
}

function runDart(dart, args) {
  if (dart.kind === "direct") {
    return spawnSync(dart.command, args, { stdio: "inherit", cwd: root });
  }
  const command = [dart.command, ...args.map(wslpathIfAvailable)].map(cmdArgument).join(" ");
  return spawnSync("cmd.exe", ["/d", "/c", command], { stdio: "inherit", cwd: root });
}

function wslpathIfAvailable(value) {
  if (process.platform !== "linux") return value;
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0) return value;
  return result.stdout.trim() || value;
}

function cmdArgument(value) {
  const text = String(value);
  return /[\s&()<>|^]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function programFile(cases) {
  const encodedCases = Buffer.from(JSON.stringify(cases), "utf8").toString("base64");
  return `import 'dart:convert';

import '../../packages/dart/lib/canonicalpath.dart' as canonicalpath;

const encodedCases = '${encodedCases}';

String runCase(Map<String, dynamic> testCase) {
  final operation = testCase['operation'] as String;
  final options = Map<String, dynamic>.from((testCase['options'] as Map?) ?? const <String, dynamic>{});
  switch (operation) {
    case 'normalize':
      return canonicalpath.normalize((testCase['raw'] as String?) ?? '', options);
    case 'relative':
      return canonicalpath.relative((testCase['root'] as String?) ?? '', (testCase['target'] as String?) ?? '');
    case 'join':
      return canonicalpath.join((testCase['root'] as String?) ?? '', (testCase['relative'] as String?) ?? '');
    case 'is-equal':
      return canonicalpath.isEqual((testCase['root'] as String?) ?? '', (testCase['target'] as String?) ?? '', options) ? 'true' : 'false';
    case 'to-win32':
      return canonicalpath.toWin32((testCase['raw'] as String?) ?? '');
    case 'to-wsl':
      return canonicalpath.toWSL((testCase['raw'] as String?) ?? '', Map<String, dynamic>.from((options['wsl'] as Map?) ?? const <String, dynamic>{}));
    case 'to-posix':
      return canonicalpath.toPOSIX((testCase['raw'] as String?) ?? '');
    case 'sanitize-component':
      return canonicalpath.sanitizeComponent((testCase['raw'] as String?) ?? '', (testCase['profile'] as String?) ?? 'portable');
    case 'encode-component':
      return canonicalpath.encodeComponent((testCase['raw'] as String?) ?? '', (testCase['profile'] as String?) ?? 'portable');
    case 'encode-git-ref':
      return canonicalpath.encodeGitRef((testCase['raw'] as String?) ?? '');
    default:
      throw StateError('unsupported operation $operation');
  }
}

void main() {
  final cases = jsonDecode(utf8.decode(base64Decode(encodedCases))) as List<dynamic>;
  var count = 0;
  for (final item in cases) {
    final testCase = Map<String, dynamic>.from(item as Map);
    final testId = testCase['id'] as String;
    final expectedError = testCase['error'] as String?;
    try {
      final actual = runCase(testCase);
      if (expectedError != null) {
        throw StateError('$testId: expected error $expectedError, got value $actual');
      }
      final expected = testCase['expected'] as String?;
      if (actual != expected) {
        throw StateError('$testId: expected $expected, got $actual');
      }
    } on canonicalpath.CanonicalPathError catch (error) {
      if (expectedError == error.code) {
        count += 1;
        continue;
      }
      throw StateError('$testId: expected error $expectedError, got \${error.code}');
    }
    count += 1;
  }
  print('Dart CanonicalPath vectors passed: $count cases');
}
`;
}
