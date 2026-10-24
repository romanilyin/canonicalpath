import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runners = [
  ["run-rust-tests.mjs", "test"],
  ["run-rust-canonicalpath-vectors.mjs", "run"],
];

// Exercise the real CLI exit/output boundary without depending on the host's
// Cargo installation. Only the child process's external Cargo calls are stubbed.
const preload = `
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const scenario = JSON.parse(process.env.CP_RUST_TEST_SCENARIO);
childProcess.spawnSync = (_command, args) => {
  appendFileSync(process.env.CP_RUST_TEST_LOG, JSON.stringify(args) + "\\n");
  const outcome = args[0] === "--version" ? scenario.probe : scenario.command;
  return outcome.error
    ? { error: Object.assign(new Error(outcome.error), { code: outcome.error }), status: null, signal: null }
    : { status: outcome.status, signal: outcome.signal ?? null };
};
syncBuiltinESMExports();
`;

function invoke(runner, scenario) {
  const directory = mkdtempSync(path.join(tmpdir(), "canonicalpath-rust-runner-"));
  try {
    const preloadPath = path.join(directory, "preload.mjs");
    const logPath = path.join(directory, "cargo-calls.jsonl");
    writeFileSync(preloadPath, preload);
    writeFileSync(logPath, "");
    const result = spawnSync(process.execPath, ["--import", preloadPath, path.join(root, "scripts", runner)], {
      cwd: directory,
      env: { ...process.env, CARGO: "cargo-under-test", CP_RUST_TEST_SCENARIO: JSON.stringify(scenario), CP_RUST_TEST_LOG: logPath },
      encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    assert.notEqual(result.status, 0, `${runner} incorrectly succeeded\n${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout, /passed|skipping/i);
    const calls = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("required Rust checks fail when Cargo is missing or its toolchain cannot start", () => {
  for (const [runner] of runners) {
    for (const probe of [{ error: "ENOENT" }, { status: 1 }]) {
      const { result, calls } = invoke(runner, { probe });
      assert.match(result.stderr, /requires a working Cargo toolchain/);
      assert.deepEqual(calls, [["--version"]], "an explicit broken CARGO must not fall back or report a skip");
    }
  }
});

test("required Rust stages propagate failed, signalled and unstartable Cargo commands", () => {
  for (const [runner, commandName] of runners) {
    for (const command of [{ status: 101 }, { status: null, signal: "SIGTERM" }, { error: "EACCES" }]) {
      const { result, calls } = invoke(runner, { probe: { status: 0 }, command });
      assert.match(result.stderr, new RegExp(`Required cargo ${commandName}`));
      assert.equal(calls.length, 2);
      assert.equal(calls[1][0], commandName, "the intended Cargo stage must actually be invoked");
    }
  }
});
