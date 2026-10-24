import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { signingEnvironment, packUnitySigned, verifySignedTarball } from "./pack-unity-signed.mjs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("disabled local Unity signer rejects every archive and never starts credential-bearing publication", () => {
  for (const candidate of ['stale.tgz', 'marker-only.tgz', 'expansion-bomb.tgz', 'symlink.tgz']) {
    assert.throws(() => verifySignedTarball(candidate), /no archive is accepted or decompressed/);
  }
  assert.throws(() => packUnitySigned({ envFile:'does-not-exist', destination:'stale' }), /disabled/);
  const result = spawnSync(process.execPath, ['--', path.join(repo, 'scripts/publish-unity-signed.mjs'), '--env-file', 'does-not-exist', '--dry-run'], {encoding:'utf8'});
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /authenticated signature verification is unavailable/);
});

function metadataTarball(metadata) {
  const data = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(512);
  header.write('package/package.json');
  for (const [offset, size, number] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, data.length], [136, 12, 0]]) {
    header.write(number.toString(8).padStart(size - 1, '0') + '\0', offset);
  }
  header.fill(32, 148, 156); header[156] = 48;
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512 + 1024)]));
}

test("the actual privileged workflow rejects artifact-selected registries and publication settings", () => {
  const workflow = readFileSync(path.join(repo, '.github/workflows/publish-npm.yml'), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: Verify artifact manifest and tarball digests')).split('- name: Preflight npm versions')[0];
  const source = step.match(/node --input-type=module <<'JS'\r?\n([\s\S]*?)\r?\n\s*JS/)[1].replace(/^          /gm, '');
  const name = 'com.romanilyin.canonicalpath', version = '2026.10.10-1';
  const cases = [
    [{ registry:'https://registry.npmjs.org', access:'public' }, true],
    [{ registry:'https://registry.npmjs.org/', access:'public' }, true],
    [{ registry:'https://example.invalid', access:'public' }, false],
    [{ registry:'http://registry.npmjs.org', access:'public' }, false],
    [{ registry:'https://registry.npmjs.org.evil.invalid', access:'public' }, false],
    [{ registry:'https://registry.npmjs.org', access:'public', '@romanilyin:registry':'https://example.invalid' }, false],
    [{ registry:'https://registry.npmjs.org', access:'public', 'strict-ssl':false }, false],
    [{ registry:'https://registry.npmjs.org', access:'public', proxy:'https://example.invalid' }, false],
    [{ registry:'https://registry.npmjs.org', access:'public', '//registry.npmjs.org/:_authToken':'synthetic' }, false],
    [{ registry:'https://registry.npmjs.org', access:'public' }, false, {name:'another-package'}],
    [{ registry:'https://registry.npmjs.org', access:'public' }, false, {version:'2026.1.1-1'}],
  ];
  const temp = mkdtempSync(path.join(tmpdir(), 'canonicalpath-publisher-test-'));
  try {
    for (const [config, accepted, identity] of cases) {
      const tarball = metadataTarball({ name, version, publishConfig:config, ...identity });
      writeFileSync(path.join(temp,'package.tgz'), tarball);
      const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
      writeFileSync(path.join(temp,'manifest.tsv'), `${name}\t${version}\t${integrity}\tpackage.tgz\n`);
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {cwd:temp, encoding:'utf8', env:{PATH:process.env.PATH, RELEASE_KIND:'unity', RELEASE_VERSION:version}});
      assert.equal(result.status === 0, accepted, JSON.stringify(config) + '\n' + result.stderr);
    }
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

test("UPM gets only OS configuration and Unity signing credentials", () => {
  const env = signingEnvironment({ NPM_TOKEN: "mock-npm-secret", UPM_ORGANIZATION_ID: "org", UPM_SERVICE_ACCOUNT_KEY_ID: "key", UPM_SERVICE_ACCOUNT_KEY_SECRET: "mock-upm-secret" },
    { Path: "safe-path", SystemRoot: "system-root", NPM_TOKEN: "process-secret", GITHUB_TOKEN: "github-secret", NODE_OPTIONS: "--import malicious.mjs", EVIL: "state" });
  assert.equal(env.Path, "safe-path");
  assert.equal(env.UPM_SERVICE_ACCOUNT_KEY_SECRET, "mock-upm-secret");
  for (const key of ["NPM_TOKEN", "GITHUB_TOKEN", "NODE_OPTIONS", "EVIL"]) assert.equal(env[key], undefined);
});

// These aliases remain callable so old automation gets an explicit refusal,
// rather than a PATH-selected publisher receiving a live credential file.
const localNpmCommands = Object.entries(JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).scripts)
  .filter(([, command]) => command.startsWith("node scripts/run-npm-with-env-token.mjs "))
  .map(([name, command]) => [name, command.slice("node scripts/run-npm-with-env-token.mjs ".length).split(" ")]);

function localNpmTestEnvironment(temp, bin, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (["SYSTEMROOT", "WINDIR", "COMSPEC"].includes(key.toUpperCase())) env[key] = value;
  }
  return { ...env, PATH: bin, TMPDIR: temp, TEMP: temp, TMP: temp, ...extra };
}

function assertLocalNpmDisabled(result, secrets = []) {
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Local npm token commands are disabled/);
  assert.match(result.stderr, /OIDC trusted-publishing workflow/);
  assert.equal(result.stdout, "");
  for (const secret of secrets) assert.ok(!(result.stdout + result.stderr).includes(secret), "secret or caller argument was printed");
}

test("all retired npm aliases reject a PATH-prepended npm/npm.cmd without credential materialization", () => {
  assert.ok(localNpmCommands.length > 0, "compatibility aliases must be exercised");
  const temp = mkdtempSync(path.join(tmpdir(), "canonicalpath-security-test-"));
  try {
    const bin = path.join(temp, "bin"); mkdirSync(bin);
    const capture = path.join(temp, "publisher-executed.json");
    const fake = path.join(bin, "fake-npm.mjs");
    writeFileSync(fake, `import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args:process.argv.slice(2) }));`);
    writeFileSync(path.join(bin, "npm.cmd"), `@"${process.execPath}" "${fake}" %*\r\n`);
    writeFileSync(path.join(bin, "npm"), `#!${process.execPath}\n${readFileSync(fake, "utf8")}`, { mode: 0o755 });
    const envFile = path.join(temp, "synthetic-credentials.env");
    writeFileSync(envFile, "NPM_TOKEN=synthetic_env_file_credential\n");
    const env = localNpmTestEnvironment(temp, bin, { NPM_TOKEN:"synthetic_process_credential", UPM_SERVICE_ACCOUNT_KEY_SECRET:"synthetic_upm_credential" });
    const before = readdirSync(temp).sort();
    for (const [name, args] of [...localNpmCommands, ["arbitrary invocation", ["exec", "synthetic_argument_credential"]]]) {
      const result = spawnSync(process.execPath, ["--", path.join(repo, "scripts/run-npm-with-env-token.mjs"), "--env-file", envFile, ...args], { cwd:temp, env, encoding:"utf8" });
      assertLocalNpmDisabled(result, ["synthetic_process_credential", "synthetic_env_file_credential", "synthetic_upm_credential", "synthetic_argument_credential"]);
      assert.equal(existsSync(capture), false, name + ": publisher must never execute");
      assert.deepEqual(readdirSync(temp).sort(), before, name + ": no credential file or directory may be created");
    }
    delete env.NPM_TOKEN;
    assertLocalNpmDisabled(spawnSync(process.execPath, ["--", path.join(repo, "scripts/run-npm-with-env-token.mjs"), "--env-file", envFile, "publish"], { cwd:temp, env, encoding:"utf8" }), ["synthetic_env_file_credential"]);
    assert.equal(existsSync(capture), false, "env-file-only credentials must not enable publication");
    assert.deepEqual(readdirSync(temp).sort(), before);
  } finally { rmSync(temp, { recursive:true, force:true }); }
});

test("retired npm entrypoint refuses before reading credentials or accessing env/config files", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "canonicalpath-npm-denial-test-"));
  try {
    const envFile = path.join(temp, "synthetic-credentials.env");
    writeFileSync(envFile, "NPM_TOKEN=synthetic_env_file_credential\n");
    const guard = path.join(temp, "guard.mjs");
    writeFileSync(guard, `import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const refuse = () => { process.stderr.write('FORBIDDEN_LOCAL_PUBLISH_IO\\n'); process.exit(97); };
const credentials = [${JSON.stringify(envFile)}, ${JSON.stringify(path.join(repo, ".env"))}];
for (const name of ['existsSync', 'readFileSync', 'openSync']) {
  const original = fs[name];
  fs[name] = (...args) => { if (credentials.includes(String(args[0]))) refuse(); return original(...args); };
}
fs.mkdtempSync = refuse;
fs.writeFileSync = refuse;
childProcess.spawnSync = refuse;
const originalEnv = process.env;
process.env = new Proxy(originalEnv, { get(target, key) { if (/TOKEN|SECRET|PASSWORD/.test(String(key))) refuse(); return target[key]; } });
syncBuiltinESMExports();
`);
    const env = localNpmTestEnvironment(temp, temp, { NPM_TOKEN:"synthetic_process_credential" });
    for (const args of [["ping"], [], ["--env-file", envFile, "publish", "--dry-run"], ["--env-file"]]) {
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(guard).href, "--", path.join(repo, "scripts/run-npm-with-env-token.mjs"), ...args], { cwd:temp, env, encoding:"utf8" });
      assertLocalNpmDisabled(result, ["synthetic_process_credential", "synthetic_env_file_credential"]);
      assert.ok(!result.stderr.includes("FORBIDDEN_LOCAL_PUBLISH_IO"), "entrypoint accessed protected state before refusal");
    }
  } finally { rmSync(temp, { recursive:true, force:true }); }
});
