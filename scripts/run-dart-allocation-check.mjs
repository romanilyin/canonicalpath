import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "dart-canonicalpath-allocation-check");
const programPath = path.join(tempRoot, "allocation_check.dart");

const dart = resolveDart();
if (!dart) {
  console.log("Dart SDK not found; skipping Dart CanonicalPath allocation check");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(), "utf8");

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

function programFile() {
  return `import 'dart:io';

import '../../packages/dart/lib/canonicalpath.dart' as canonicalpath;

const loops = 5000;
const budgetBytes = 128 * 1024 * 1024;

void workload() {
  canonicalpath.normalize('/home//alice/./repo', {'sourceHost': 'posix', 'targetProfile': 'posix'});
  canonicalpath.normalize('C:\\\\Users\\\\Alice\\\\Repo\\\\src\\\\..\\\\README.md', {'sourceHost': 'win32', 'targetProfile': 'win32-drive'});
  canonicalpath.normalize('file:///repo/caf%C3%A9.txt', {'sourceHost': 'vscode-file-uri', 'targetProfile': 'posix', 'uri': {'allowFileUri': true}});
  canonicalpath.relative('c:/repo', 'c:/repo/src/file.txt');
  canonicalpath.join('c:/repo', 'src/./file.txt');
  canonicalpath.isEqual('/mnt/c/Users/Alice/Repo', 'c:/Users/Alice/Repo', {'sourceHost': 'wsl', 'targetProfile': 'win32-drive', 'wsl': {'enabled': true, 'mountRoot': '/mnt'}});
  canonicalpath.toWin32('c:/Users/Alice/Repo');
  canonicalpath.toWSL('c:/Users/Alice/Repo', {'mountRoot': '/mnt'});
  canonicalpath.toPOSIX('/home/alice/repo');
  canonicalpath.sanitizeComponent('feature/auth', 'portable');
  canonicalpath.encodeComponent('NUL.txt', 'win32');
  canonicalpath.encodeGitRef('feature/auth');
}

void main() {
  for (var index = 0; index < 1000; index++) {
    workload();
  }

  final before = ProcessInfo.currentRss;
  for (var index = 0; index < loops; index++) {
    workload();
  }
  final after = ProcessInfo.currentRss;
  final delta = after > before ? after - before : 0;
  if (delta > budgetBytes) {
    throw StateError('Dart CanonicalPath allocation check exceeded RSS budget: $delta bytes > $budgetBytes');
  }
  print('Dart CanonicalPath allocation check passed: RSS delta $delta bytes over $loops iterations');
}
`;
}
