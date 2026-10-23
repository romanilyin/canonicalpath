import assert from "node:assert/strict";
import test from "node:test";
import { selectPowerShells } from "./powershell-shell.mjs";

const modern = { status: 0, stdout: JSON.stringify({ Major: 7, Minor: 6, Edition: "Core" }) };
test("Windows defaults probe only the full PowerShell 7 path", () => {
  const calls = [];
  const selected = selectPowerShells([], { platform: "win32", env: { ProgramFiles: "C:\\Program Files" },
    spawn: (file, args) => { calls.push({ file, args }); return modern; } });
  assert.deepEqual(selected, ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("-NonInteractive"));
  assert.match(calls[0].args.at(-1), /PSVersionTable\.PSEdition/);
});
test("Missing PowerShell 7 never invokes a legacy fallback", () => {
  const calls = [];
  assert.throws(() => selectPowerShells([], { platform: "win32", env: {},
    spawn: file => { calls.push(file); return { error: { code: "ENOENT" } }; } }), /not found or unusable/);
  assert.deepEqual(calls, ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]);
  assert.deepEqual(selectPowerShells([], { platform: "linux", env: {}, spawn: () => ({ error: { code: "ENOENT" } }) }), []);
});
test("A configured path is required and its actual runtime is verified", () => {
  const env = { CANONICALPATH_POWERSHELL: "D:\\Tools\\pwsh.exe" };
  assert.deepEqual(selectPowerShells([], { platform: "win32", env, spawn: () => modern }), [env.CANONICALPATH_POWERSHELL]);
  assert.throws(() => selectPowerShells([], { platform: "linux", env, spawn: () => ({ error: { code: "ENOENT" } }) }), /not found or unusable/);
  for (const version of [{ Major: 5, Minor: 1, Edition: "Desktop" }, { Major: 7, Minor: 0, Edition: "Desktop" }, { Major: 6, Minor: 0, Edition: "Core" }]) {
    assert.throws(() => selectPowerShells([], { platform: "win32", env, spawn: () => ({ status: 0, stdout: JSON.stringify(version) }) }), /7\/Core is required/);
  }
});
test("Legacy module coverage requires a deliberate CI opt-in before any probe", () => {
  let probes = 0;
  const spawn = () => { probes++; return { status: 0, stdout: JSON.stringify({ Major: 5, Minor: 1, Edition: "Desktop" }) }; };
  assert.throws(() => selectPowerShells(["--shell", "powershell.exe"], { env: {}, spawn }), /explicit.*CI opt-in/);
  assert.equal(probes, 0);
  assert.deepEqual(selectPowerShells(["--shell", "powershell.exe", "--allow-windows-powershell"], { env: {}, spawn }), ["powershell.exe"]);
});
test("all-available cannot silently enable Windows PowerShell", () => {
  const calls = [];
  selectPowerShells(["--all-available"], { platform: "win32", env: {}, spawn: file => { calls.push(file); return modern; } });
  assert.deepEqual(calls, ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]);
});
