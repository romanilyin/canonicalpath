import { createTlsFixture } from "./tls-test-fixture.mjs";
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { selectPowerShells } from "./powershell-shell.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
const available = command => spawnSync(command, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;
const windowsEnvironmentNames = [
  "CANONICALFS_DAEMON_URL", "CANONICALFS_DAEMON_TOKEN", "CANONICALFS_TLS_CA_FILE",
  "CANONICALFS_TLS_CERTIFICATE_SHA256", "CANONICALFS_TLS_PUBLIC_KEY_PIN",
  "CANONICALFS_MAX_RESPONSE_BYTES", "CANONICALFS_TIMEOUT_MILLISECONDS",
];

function windowsPath(value) {
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Cannot convert test path for Windows interop: ${value}`);
  }
  return result.stdout.trim();
}

function windowsEnvironment(env, interop) {
  if (!interop) return env;
  const result = { ...env };
  if (result.CANONICALFS_TLS_CA_FILE) result.CANONICALFS_TLS_CA_FILE = windowsPath(result.CANONICALFS_TLS_CA_FILE);
  const controlled = new Set(windowsEnvironmentNames);
  const inherited = (env.WSLENV || "").split(":").filter(entry => entry && !controlled.has(entry.split("/")[0].toUpperCase()));
  for (const name of windowsEnvironmentNames) {
    // An omitted test value must not resurrect the Windows user's daemon configuration.
    if (result[name] === undefined) result[name] = "";
  }
  // Paths were translated explicitly above: /p here would translate them a second time.
  result.WSLENV = [...inherited, ...windowsEnvironmentNames.map(name => `${name}/w`)].join(":");
  return result;
}

async function fixture(action) {
  const tlsFixture = createTlsFixture();
  const authorizations = [];
  const paths = [];
  const completedRequests = [];
  const body = JSON.stringify({ padding: "x".repeat(4096) });
  const server = createServer({cert: tlsFixture.cert, key: tlsFixture.key}, (request, response) => {
    request.resume();
    authorizations.push(request.headers.authorization);
    paths.push(request.url);
    const mode = request.url.split("/")[1];
    if (mode === "headers") return;
    if (mode === "valid") {
      // A successful write acknowledges the complete upload. An immediate
      // response with Connection: close can abort an in-flight TLS request.
      let bytes = 0;
      request.on('data', chunk => { bytes += chunk.length; });
      request.once('end', () => {
        completedRequests.push({ path: request.url, bytes });
        response.end('{}');
      });
      return;
    }
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
  try { await action(`https://127.0.0.1:${server.address().port}`, authorizations, paths, tlsFixture, completedRequests); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); tlsFixture.dispose(); }
}
{
  const shells = selectPowerShells();
  for (const shell of shells) {
    const interop = process.platform === "linux" && /\.exe$/i.test(shell);
    const nativePath = interop ? windowsPath : value => value;
    test(`${shell}: bounded success/error bodies, deadlines, private bearer`, { timeout: 30000 }, async () => {
      await fixture(async (endpoint, headers, paths, tlsFixture) => {
        const result = await run(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativePath(path.join(root, "packages/powershell/CanonicalPath/test/DaemonClient.Security.ps1")), "-RepoRoot", nativePath(root), "-Endpoint", endpoint], { env: windowsEnvironment({ ...process.env, ...tlsFixture.env }, interop), timeout: 20000, windowsHide: true });
        assert.match(result.stdout, /resource limits and credential redaction passed/);
        assert.ok(headers.length >= 10);
        assert.ok(headers.every(header => header === "Bearer security-test-dummy-bearer"));
        assert.ok(!paths.includes('/redirect-target'));
      });
    });
    test(`${shell}: CMD wrapper uses bounded transport and caps named requests before expansion`, { timeout: 60000 }, async () => {
      await fixture(async (endpoint, headers, paths, tlsFixture, completedRequests) => {
        const wrapper = nativePath(path.join(root, 'packages/windows-cmd-batch-wrapper/canonicalfs.ps1'));
        for (const mode of ['valid', 'fixed', 'chunked', 'gzip', 'error-large', 'headers', 'body', 'drip', 'error-body', 'redirect']) {
          const started = Date.now();
          const result = await run(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-Operation', 'close-project', '-ProjectId', 'p'], {
            env: windowsEnvironment({ ...process.env, ...tlsFixture.env, CANONICALFS_DAEMON_URL: endpoint + '/' + mode, CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer', CANONICALFS_MAX_RESPONSE_BYTES: '1024', CANONICALFS_TIMEOUT_MILLISECONDS: '500' }, interop), timeout: 6000, windowsHide: true,
          }).then(value => ({ ...value, code: 0 }), error => error);
          if (mode === 'valid') assert.equal(result.code, 0, result.stderr);
          else {
            assert.notEqual(result.code, 0, mode);
            assert.match(result.stderr, new RegExp(['fixed','chunked','gzip','error-large'].includes(mode) ? 'ERR_RESPONSE_TOO_LARGE' : 'ERR_DAEMON'));
          }
          assert.ok(Date.now() - started < 5500, mode);
        }
        for (const [length, accepted] of [[785000, true], [786432, false], [1048577, false]]) {
          const before = completedRequests.length;
          const script = `$text = 'a' * ${length}; & '${wrapper.replaceAll("'", "''")}' -Operation write-text -ProjectId p -Path a -Text $text`;
          const result = await run(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            env: windowsEnvironment({ ...process.env, ...tlsFixture.env, CANONICALFS_DAEMON_URL: endpoint + '/valid', CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer' }, interop), timeout: 6000, windowsHide: true,
          }).then(value => ({ ...value, code: 0 }), error => error);
          assert.equal(result.code === 0, accepted, `named length=${length}: ${result.stderr}`);
          assert.equal(completedRequests.length, before + Number(accepted), 'only an accepted request may complete its upload');
          if (accepted) {
            const expectedBytes = Buffer.byteLength(JSON.stringify({ path: 'a', data_base64: '', project_id: 'p' })) + 4 * Math.ceil(length / 3);
            assert.deepEqual(completedRequests.at(-1), { path: '/valid/v1/fs/writeFile', bytes: expectedBytes }, 'accepted write must deliver the complete encoded body');
          } else assert.match(result.stderr, /ERR_REQUEST_TOO_LARGE/);
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
      await fixture(async (endpoint, headers, paths, tlsFixture) => {
        for (const mode of ['valid', 'fixed', 'chunked', 'gzip', 'error-large', 'headers', 'body', 'drip', 'error-body', 'redirect']) {
          const started = Date.now();
          const result = await run("bash", [path.join(root, "packages/bash-wrapper/canonicalfs.sh"), "close-project", "p"], {
            env: { ...process.env, ...tlsFixture.env, CANONICALFS_DAEMON_URL: endpoint + '/' + mode, CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer', CANONICALFS_MAX_RESPONSE_BYTES: '1024', CANONICALFS_TIMEOUT_SECONDS: '0.5', TMPDIR: scratch },
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
          detached: true, stdio: 'ignore', env: { ...process.env, ...tlsFixture.env, CANONICALFS_DAEMON_URL: endpoint + '/drip', CANONICALFS_DAEMON_TOKEN: 'security-test-dummy-bearer', CANONICALFS_TIMEOUT_SECONDS: '2', TMPDIR: scratch },
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
