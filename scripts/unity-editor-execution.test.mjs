import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requireUnityCompletion } from "./unity-editor-execution.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Unity success requires a matching current receipt and a zero editor exit", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "canonicalpath-unity-receipt-"));
  const receipt = path.join(temp, "complete.txt");
  try {
    assert.throws(() => requireUnityCompletion({ status: 0 }, receipt, "current-run"), /did not produce/);
    writeFileSync(receipt, "previous-run");
    assert.throws(() => requireUnityCompletion({ status: 0 }, receipt, "current-run"), /does not match/);
    writeFileSync(receipt, "current-run");
    assert.throws(() => requireUnityCompletion({ status: 1 }, receipt, "current-run"), /exited with 1/);
    assert.throws(() => requireUnityCompletion({ status: null, signal: "SIGTERM" }, receipt, "current-run"), /SIGTERM/);
    assert.throws(() => requireUnityCompletion({ error: new Error("spawn failed") }, receipt, "current-run"), /spawn failed/);
    assert.doesNotThrow(() => requireUnityCompletion({ status: 0 }, receipt, "current-run"));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("the actual EditMode command rejects a skipped runner and stale success evidence", { skip: process.platform === "win32" }, () => {
  const temp = mkdtempSync(path.join(tmpdir(), "canonicalpath-unity-command-"));
  const version = "9999.7.3f1";
  const editor = path.join(temp, version, "Editor", "Unity");
  mkdirSync(path.dirname(editor), { recursive: true });
  writeFileSync(editor, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
const project = path.resolve(args[args.indexOf('-projectPath') + 1]);
const source = fs.readFileSync(path.join(project, 'Assets/Editor/CanonicalPathUnityEditModeRunner.cs'), 'utf8');
const nonce = /private const string CompletionNonce = "([^"]+)";/.exec(source)[1];
const mode = process.env.CANONICALPATH_FAKE_UNITY_MODE;
fs.writeFileSync(path.resolve(args[args.indexOf('-logFile') + 1]), 'fixture editor diagnostic');
if (mode !== 'missing') fs.writeFileSync(path.join(project, 'canonicalpath-editmode-complete.txt'), mode === 'stale' ? 'previous-run' : nonce);
process.exit(mode === 'failed' ? 7 : 0);
`);
  chmodSync(editor, 0o700);
  try {
    for (const mode of ["missing", "stale", "failed", "passed"]) {
      const result = spawnSync(process.execPath, [path.join(root, "scripts/run-unity-editmode-tests.mjs")], {
        cwd: root, encoding: "utf8", timeout: 15000,
        env: { ...process.env, UNITY_EDITOR: editor, UNITY_EXE: "", UNITY_PATH: "", UNITY_REQUIRED_VERSION_PREFIX: version, CANONICALPATH_FAKE_UNITY_MODE: mode },
      });
      try {
        assert.ifError(result.error);
        assert.equal(result.status === 0, mode === "passed", `${mode}: ${result.stdout}\n${result.stderr}`);
        if (mode === "passed") assert.match(result.stdout, /receipt verified/);
        else assert.match(result.stderr, /fixture editor diagnostic/);
      } finally {
        rmSync(path.join(root, "tmp", `unity-editmode-project-${version.replaceAll(".", "-")}-${result.pid}`), { recursive: true, force: true });
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
