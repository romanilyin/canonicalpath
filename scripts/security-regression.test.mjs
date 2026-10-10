import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signingEnvironment } from "./pack-unity-signed.mjs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
