import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const wrapper = path.join(root, "packages/bash-wrapper/canonicalfs.sh");
const available = command => spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
const skip = process.platform === "win32" || !available("bash") || !available("python3")
  ? "Bash payload/process fixtures require Unix Bash and Python 3" : false;
const options = { skip, timeout: 15000 };

// This is a process-boundary fixture, not a TLS test. A fake curl receives the
// real wrapper/helper argv, environment, config stdin and private body file.
// It never opens a network connection. HTTPS authentication is covered by the
// daemon transport tests; the synthetic pin only satisfies local validation.
function fixture(payload = Buffer.alloc(0), mode = "success") {
  const directory = mkdtempSync(path.join(tmpdir(), "canonicalfs-payload-test-"));
  const bin = path.join(directory, "bin");
  const temporary = path.join(directory, "requests");
  mkdirSync(bin, { mode: 0o700 });
  mkdirSync(temporary, { mode: 0o700 });
  const token = `synthetic-bearer-${randomBytes(24).toString("hex")}`;
  const state = path.join(directory, "state.json");
  writeFileSync(state, JSON.stringify({
    token, mode, directory,
    needles: payload.length ? [payload.toString("utf8"), payload.toString("base64")] : [],
  }), { mode: 0o600 });
  const audit = `
import json, os, pathlib, sys
state = json.loads(pathlib.Path(os.environ["CANONICALFS_TEST_STATE"]).read_text())
def observed(kind, **extra):
    arguments = "\\0".join(sys.argv[1:])
    environment = "\\0".join(os.environ.values())
    record = {"kind": kind, "argv": sys.argv[1:],
              "payload_in_argv": any(n in arguments for n in state["needles"]),
              "payload_in_environment": any(n in environment for n in state["needles"]),
              "token_in_argv": state["token"] in arguments,
              "token_in_environment": state["token"] in environment, **extra}
    with open(pathlib.Path(state["directory"]) / "audit.jsonl", "a") as output:
        output.write(json.dumps(record) + "\\n")
`;
  const python = path.join(bin, "python-audit");
  writeFileSync(python, `#!/usr/bin/env python3
${audit}
observed("python")
os.execvp("python3", ["python3", *sys.argv[1:]])
`, { mode: 0o700 });
  writeFileSync(path.join(bin, "curl"), `#!/usr/bin/env python3
${audit}
import stat, time
config = sys.stdin.buffer.read().decode("utf-8")
body_argument = sys.argv[sys.argv.index("--data-binary") + 1]
assert body_argument.startswith("@")
body_path = pathlib.Path(body_argument[1:])
body = body_path.read_bytes()
observed("curl", body_file=str(body_path),
         body_mode=stat.S_IMODE(body_path.stat().st_mode),
         directory_mode=stat.S_IMODE(body_path.parent.stat().st_mode),
         response_mode=stat.S_IMODE((body_path.parent / "response.json").stat().st_mode),
         has_bearer_in_config=("Authorization: Bearer " + state["token"]) in config)
(pathlib.Path(state["directory"]) / "request.json").write_bytes(body)
(pathlib.Path(state["directory"]) / "ready").touch()
if state["mode"] == "hold":
    time.sleep(30)
elif state["mode"] == "timeout":
    raise SystemExit(28)
elif state["mode"] == "error":
    sys.stdout.write('{"error":{"code":"ERR_TEST","message":"synthetic failure"}}500')
else:
    sys.stdout.write('{}200')
`, { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    PYTHON: python,
    TMPDIR: temporary,
    CANONICALFS_TEST_STATE: state,
    CANONICALFS_DAEMON_URL: "https://127.0.0.1:1",
    CANONICALFS_DAEMON_TOKEN: token,
    CANONICALFS_TLS_PUBLIC_KEY_PIN: "sha256//" + Buffer.alloc(32, 7).toString("base64"),
    // Bash locals can inherit the export attribute from an unrelated caller
    // variable. Secret-bearing locals must explicitly clear that attribute.
    TOKEN: "inherited-token-export", body: "inherited-body-export",
    config: "inherited-config-export", escaped_token: "inherited-escaped-token-export",
  };
  delete env.CANONICALFS_TLS_CA_FILE;
  return {
    directory, temporary, env, token,
    run(input, args = ["write-text", "p", "a"]) {
      return spawnSync("bash", [wrapper, ...args], { cwd: root, env, input, encoding: "utf8", timeout: 8000 });
    },
    records() {
      const file = path.join(directory, "audit.jsonl");
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    },
    request() { return JSON.parse(readFileSync(path.join(directory, "request.json"), "utf8")); },
    assertClean() { assert.deepEqual(readdirSync(temporary), [], "private request/response files were retained"); },
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}

test("Bash write-text keeps UTF-8, NUL and trailing newlines out of child argv/environment", options, () => {
  const payload = Buffer.from(`private-${randomBytes(24).toString("hex")} — текст "quote" \\slash\0\n\n`);
  const f = fixture(payload);
  try {
    const result = f.run(payload);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Buffer.from(f.request().data_base64, "base64"), payload);
    const records = f.records();
    assert.ok(records.some(record => record.kind === "python"));
    const curl = records.find(record => record.kind === "curl");
    assert.ok(curl, "curl fixture did not receive a request");
    for (const record of records) {
      assert.equal(record.payload_in_argv, false, record.kind);
      assert.equal(record.payload_in_environment, false, record.kind);
      assert.equal(record.token_in_argv, false, record.kind);
      assert.equal(record.token_in_environment, false, record.kind);
    }
    assert.equal(curl.body_mode, 0o600);
    assert.equal(curl.response_mode, 0o600);
    assert.equal(curl.directory_mode, 0o700);
    assert.equal(curl.has_bearer_in_config, true);
    assert.ok(!curl.argv.includes("--data"));
    f.assertClean();
  } finally { f.close(); }
});

test("Bash write-text accepts empty stdin and the exact encoded request boundary", options, () => {
  const overhead = Buffer.byteLength(JSON.stringify({ project_id: "p", path: "a", data_base64: "" }));
  const largestInput = 3 * Math.floor(((1 << 20) - overhead) / 4);
  for (const payload of [Buffer.alloc(0), Buffer.alloc(largestInput, "a")]) {
    const f = fixture();
    try {
      const result = f.run(payload);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(Buffer.from(f.request().data_base64, "base64"), payload);
      f.assertClean();
    } finally { f.close(); }
  }
});

test("Bash write-text rejects oversize, invalid UTF-8 and retired positional text before curl", options, () => {
  const overhead = Buffer.byteLength(JSON.stringify({ project_id: "p", path: "a", data_base64: "" }));
  const largestInput = 3 * Math.floor(((1 << 20) - overhead) / 4);
  const cases = [
    { input: Buffer.alloc(largestInput + 1, "a"), message: /encoded request exceeds/ },
    { input: Buffer.alloc((1 << 20) + 1, "a"), message: /input exceeds/ },
    { input: Buffer.from([0xff]), message: /valid UTF-8/ },
    { input: "", args: ["write-text", "p", "a", "retired-positional-secret"], message: /text on stdin/ },
  ];
  for (const entry of cases) {
    const f = fixture();
    try {
      const result = f.run(entry.input, entry.args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, entry.message);
      assert.ok(!result.stderr.includes("retired-positional-secret"));
      assert.ok(!f.records().some(record => record.kind === "curl"), "invalid input reached curl");
      f.assertClean();
    } finally { f.close(); }
  }
});

test("Bash removes private request files on daemon and curl timeout errors", options, () => {
  for (const mode of ["error", "timeout"]) {
    const f = fixture(Buffer.alloc(0), mode);
    try {
      const result = f.run("synthetic payload");
      assert.notEqual(result.status, 0, mode);
      assert.ok(f.records().some(record => record.kind === "curl"));
      f.assertClean();
    } finally { f.close(); }
  }
});

test("Bash process-group interruption removes payload files and exposes no process-list payload", options, async t => {
  const payload = Buffer.from(`interrupt-private-${randomBytes(24).toString("hex")}`);
  const f = fixture(payload, "hold");
  const child = spawn("bash", [wrapper, "write-text", "p", "a"], {
    cwd: root, env: f.env, detached: true, stdio: ["pipe", "ignore", "ignore"],
  });
  const finished = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  child.stdin.end(payload);
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(path.join(f.directory, "ready"))) {
      assert.equal(child.exitCode, null, "fixture exited before the request was observable");
      assert.ok(Date.now() < deadline, "curl fixture did not become ready");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (process.platform === "linux" && existsSync(`/proc/${child.pid}/task/${child.pid}/children`)) {
      const queue = [child.pid];
      let observed = 0;
      while (queue.length) {
        const pid = queue.shift();
        const command = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        const environment = readFileSync(`/proc/${pid}/environ`, "utf8");
        for (const needle of [payload.toString(), payload.toString("base64")]) {
          assert.ok(!command.includes(needle), `payload in process ${pid} arguments`);
          assert.ok(!environment.includes(needle), `payload in process ${pid} environment`);
        }
        assert.ok(!command.includes(f.token), `bearer in process ${pid} arguments`);
        const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
        if (children) queue.push(...children.split(/\s+/).map(Number));
        observed++;
      }
      assert.ok(observed >= 3, "expected wrapper, helper and curl processes");
    } else {
      t.diagnostic("/proc observation unavailable; instrumented helper argv/environment checks still ran");
    }
    process.kill(-child.pid, "SIGTERM");
    const result = await finished;
    assert.ok(result.code !== 0 || result.signal);
    f.assertClean();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
      await finished;
    }
    f.close();
  }
});
