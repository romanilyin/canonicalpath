import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import test from "node:test";
const root = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
const available = command => spawnSync(command, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;

async function fixture(action) {
  const authorizations = [];
  const paths = [];
  const body = JSON.stringify({ padding: "x".repeat(4096) });
  const server = createServer((request, response) => {
    request.resume();
    authorizations.push(request.headers.authorization);
    paths.push(request.url);
    const mode = request.url.split("/")[1];
    if (mode === "headers") return;
    if (mode === "valid") return response.end('{}');
    if (mode === "redirect") { response.writeHead(302, { location: '/redirect-target' }); return response.end('{}'); }
    if (mode === "gzip") {
      const compressed = gzipSync(body);
      response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': compressed.length });
      return response.end(compressed);
    }
    const status = mode.startsWith("error") ? 500 : 200;
    if (mode === "fixed" || mode === "error-large") {
      response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      return response.end(body);
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.write('{"padding":"');
    if (mode === "body" || mode === "error-body") return;
    if (mode === "drip") {
      const timer = setInterval(() => response.write('x'), 50);
      response.on('close', () => clearInterval(timer));
      return;
    }
    response.write('x'.repeat(4096)); response.end('"}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`, authorizations, paths); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
if (process.platform === "win32" || available("pwsh")) {
  const shells = process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["pwsh"];
  for (const shell of shells) {
    if (spawnSync(shell, ["-NoProfile", "-Command", "exit 0"], { windowsHide: true }).status !== 0) continue;
    test(`${shell}: bounded success/error bodies, deadlines, private bearer`, { timeout: 30000 }, async () => {
      await fixture(async (endpoint, headers, paths) => {
        const result = await run(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "packages/powershell/CanonicalPath/test/DaemonClient.Security.ps1"), "-RepoRoot", root, "-Endpoint", endpoint], { timeout: 20000, windowsHide: true });
        assert.match(result.stdout, /resource limits and credential redaction passed/);
        assert.ok(headers.length >= 10);
        assert.ok(headers.every(header => header === "Bearer security-test-dummy-bearer"));
        assert.ok(!paths.includes('/redirect-target'));
      });
    });
    test(`${shell}: CMD wrapper uses bounded transport and caps named requests before expansion`, { timeout: 60000 }, async () => {
      await fixture(async (endpoint, headers, paths) => {
        const wrapper = path.join(root, 'packages/windows-cmd-batch-wrapper/canonicalfs.ps1');
        for (const mode of ['valid', 'fixed', 'chunked', 'gzip', 'error-large', 'headers', 'body', 'drip', 'error-body', 'redirect']) {
          const started = Date.now();
          const result = await run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-Operation', 'close-project', '-ProjectId', 'p'], {
            env: { ...process.env, CANONICALFS_DAEMON_URL: endpoint + '/' + mode, CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer', CANONICALFS_MAX_RESPONSE_BYTES: '1024', CANONICALFS_TIMEOUT_MILLISECONDS: '500' }, timeout: 6000, windowsHide: true,
          }).then(value => ({ ...value, code: 0 }), error => error);
          if (mode === 'valid') assert.equal(result.code, 0, result.stderr);
          else {
            assert.notEqual(result.code, 0, mode);
            assert.match(result.stderr, new RegExp(['fixed','chunked','gzip','error-large'].includes(mode) ? 'ERR_RESPONSE_TOO_LARGE' : 'ERR_DAEMON'));
          }
          assert.ok(Date.now() - started < 5500, mode);
        }
        for (const [length, accepted] of [[785000, true], [786432, false], [1048577, false]]) {
          const script = `$text = 'a' * ${length}; & '${wrapper.replaceAll("'", "''")}' -Operation write-text -ProjectId p -Path a -Text $text`;
          const result = await run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            env: { ...process.env, CANONICALFS_DAEMON_URL: endpoint + '/valid', CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer' }, timeout: 6000, windowsHide: true,
          }).then(value => ({ ...value, code: 0 }), error => error);
          assert.equal(result.code === 0, accepted, result.stderr);
          if (!accepted) assert.match(result.stderr, /ERR_REQUEST_TOO_LARGE/);
        }
        assert.equal(paths.length, 11, 'oversized named requests must never reach the server');
        assert.ok(!paths.includes('/redirect-target'));
        assert.ok(headers.every(header => header === 'Bearer security-test-dummy-bearer'));
      });
    });
  }
}
if (process.platform !== "win32" && available("bash") && available("curl") && available("python3")) {
  test("Bash: decoded byte caps, overall deadlines and response-file cleanup", { timeout: 15000 }, async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "canonicalfs-response-test-"));
    try {
      await fixture(async (endpoint, headers, paths) => {
        for (const mode of ['valid', 'fixed', 'chunked', 'gzip', 'error-large', 'headers', 'body', 'drip', 'error-body', 'redirect']) {
          const started = Date.now();
          const result = await run("bash", [path.join(root, "packages/bash-wrapper/canonicalfs.sh"), "close-project", "p"], {
            env: { ...process.env, CANONICALFS_DAEMON_URL: endpoint + '/' + mode, CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer', CANONICALFS_MAX_RESPONSE_BYTES: '1024', CANONICALFS_TIMEOUT_SECONDS: '0.5', TMPDIR: scratch },
            timeout: 4000,
          }).then(value => ({ ...value, code: 0 }), error => error);
          if (mode === 'valid') assert.equal(result.code, 0, result.stderr);
          else {
            assert.notEqual(result.code, 0);
            const code = ['fixed', 'chunked', 'gzip', 'error-large'].includes(mode) ? 'ERR_RESPONSE_TOO_LARGE' : 'ERR_DAEMON';
            assert.match(result.stderr, new RegExp(code));
          }
          assert.ok(Date.now() - started < 3000, `deadline exceeded: ${mode}`);
          assert.deepEqual(readdirSync(scratch), [], `temporary response leaked: ${mode}`);
        }
        const interrupted = spawn('bash', [path.join(root, 'packages/bash-wrapper/canonicalfs.sh'), 'close-project', 'p'], {
          detached: true, stdio: 'ignore', env: { ...process.env, CANONICALFS_DAEMON_URL: endpoint + '/drip', CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer', CANONICALFS_TIMEOUT_SECONDS: '2', TMPDIR: scratch },
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        const finished = new Promise(resolve => interrupted.on('exit', resolve));
        process.kill(-interrupted.pid, 'SIGTERM');
        await finished;
        assert.deepEqual(readdirSync(scratch), [], 'interrupted response file leaked');
        assert.ok(headers.every(header => header === 'Bearer security-test-dummy-bearer'));
        assert.ok(!paths.includes('/redirect-target'));
      });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
}
