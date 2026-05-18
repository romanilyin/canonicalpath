import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(root, "tmp", "python-canonicalpath-vector-check");
const programPath = path.join(tempRoot, "vector_check.py");
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

const python = resolvePython();
if (!python) {
  console.log("python3 not found; skipping Python CanonicalPath vector check");
  process.exit(0);
}

const cases = vectorFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).cases);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
writeFileSync(programPath, programFile(cases), "utf8");

const run = spawnSync(python.command, [...python.args, programPath], {
  stdio: "inherit",
  env: pythonEnv(),
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);

function resolvePython() {
  const candidates = [
    process.env.PYTHON ? { command: process.env.PYTHON, args: [] } : undefined,
    { command: "python3", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function pythonEnv() {
  const packageRoot = path.join(root, "packages", "python");
  const existing = process.env.PYTHONPATH;
  return {
    ...process.env,
    PYTHONPATH: existing ? `${packageRoot}${path.delimiter}${existing}` : packageRoot,
  };
}

function programFile(cases) {
  const encodedCases = Buffer.from(JSON.stringify(cases), "utf8").toString("base64");
  return `import base64
import json

import canonicalpath


CASES = json.loads(base64.b64decode(${JSON.stringify(encodedCases)}).decode("utf-8"))


def run_case(test_case):
    operation = test_case["operation"]
    options = test_case.get("options") or {}
    if operation == "normalize":
        return canonicalpath.normalize(test_case.get("raw", ""), options)
    if operation == "relative":
        return canonicalpath.relative(test_case.get("root", ""), test_case.get("target", ""))
    if operation == "join":
        return canonicalpath.join(test_case.get("root", ""), test_case.get("relative", ""))
    if operation == "is-equal":
        return "true" if canonicalpath.is_equal(test_case.get("root", ""), test_case.get("target", ""), options) else "false"
    if operation == "to-win32":
        return canonicalpath.to_win32(test_case.get("raw", ""))
    if operation == "to-wsl":
        return canonicalpath.to_wsl(test_case.get("raw", ""), options.get("wsl") or {})
    if operation == "to-posix":
        return canonicalpath.to_posix(test_case.get("raw", ""))
    if operation == "sanitize-component":
        return canonicalpath.sanitize_component(test_case.get("raw", ""), test_case.get("profile", "portable"))
    if operation == "encode-component":
        return canonicalpath.encode_component(test_case.get("raw", ""), test_case.get("profile", "portable"))
    if operation == "encode-git-ref":
        return canonicalpath.encode_git_ref(test_case.get("raw", ""))
    raise AssertionError(f"unsupported operation {operation}")


count = 0
for test_case in CASES:
    test_id = test_case["id"]
    expected_error = test_case.get("error")
    try:
        actual = run_case(test_case)
    except canonicalpath.CanonicalPathError as error:
        if expected_error == error.code:
            count += 1
            continue
        raise AssertionError(f"{test_id}: expected error {expected_error}, got {error.code}") from error
    if expected_error is not None:
        raise AssertionError(f"{test_id}: expected error {expected_error}, got value {actual}")
    expected = test_case.get("expected")
    if actual != expected:
        raise AssertionError(f"{test_id}: expected {expected}, got {actual}")
    count += 1

print(f"Python CanonicalPath vectors passed: {count} cases")
`;
}
