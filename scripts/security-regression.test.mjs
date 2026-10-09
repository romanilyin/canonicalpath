import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signingEnvironment } from "./pack-unity-signed.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("UPM gets only OS configuration and Unity signing credentials", () => {
  const env = signingEnvironment({ NPM_TOKEN: "mock-npm-secret", UPM_ORGANIZATION_ID: "org", UPM_SERVICE_ACCOUNT_KEY_ID: "key", UPM_SERVICE_ACCOUNT_KEY_SECRET: "mock-upm-secret" },
    { Path: "safe-path", SystemRoot: "system-root", NPM_TOKEN: "process-secret", GITHUB_TOKEN: "github-secret", NODE_OPTIONS: "--import malicious.mjs", EVIL: "state" });
  assert.equal(env.Path, "safe-path");
  assert.equal(env.UPM_SERVICE_ACCOUNT_KEY_SECRET, "mock-upm-secret");
  for (const key of ["NPM_TOKEN", "GITHUB_TOKEN", "NODE_OPTIONS", "EVIL"]) assert.equal(env[key], undefined);
});

for (const status of [0, 7]) {
  test(`npm secrets and temporary config are isolated on exit ${status}`, () => {
    const temp = mkdtempSync(path.join(tmpdir(), "canonicalpath-security-test-"));
    try {
      const bin = path.join(temp, "bin"); mkdirSync(bin);
      const fake = path.join(bin, "fake-npm.mjs");
      writeFileSync(fake, `import { writeFileSync, existsSync } from 'node:fs';
        const args=process.argv.slice(2); const config=args[args.indexOf('--userconfig')+1];
        writeFileSync(process.env.CP_SECURITY_CAPTURE, JSON.stringify({config, exists:existsSync(config), token:process.env.NPM_TOKEN, upm:process.env.UPM_SERVICE_ACCOUNT_KEY_SECRET, args}));
        process.exit(${status});`);
      if (process.platform === "win32") {
        writeFileSync(path.join(bin, "npm.cmd"), `@"${process.execPath}" "${fake}" %*\r\n`);
      } else {
        writeFileSync(path.join(bin, "npm"), `#!${process.execPath}\n${readFileSync(fake, "utf8")}`, { mode: 0o755 });
      }
      const capture = path.join(temp, "capture.json");
      const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, NPM_TOKEN: "synthetic_npm_credential", UPM_SERVICE_ACCOUNT_KEY_SECRET: "synthetic_upm_credential", CP_SECURITY_CAPTURE: capture, TMPDIR: temp, TEMP: temp, TMP: temp };
      const result = spawnSync(process.execPath, ["--", path.join(repo, "scripts/run-npm-with-env-token.mjs"), "--env-file", path.join(temp,"absent.env"), "whoami"], { env, encoding: "utf8" });
      assert.equal(result.status, status, result.stderr);
      const observed = JSON.parse(readFileSync(capture, "utf8"));
      assert.equal(observed.token, undefined);
      assert.equal(observed.upm, undefined);
      assert.equal(observed.exists, true);
      assert.ok(observed.args.includes("--ignore-scripts=true"));
      assert.equal(existsSync(observed.config), false);
      assert.equal(existsSync(path.dirname(observed.config)), false);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
}
