import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rawArgs = process.argv.slice(2);
let cwd = root;
let envFile = path.join(root, ".env");
const npmArgs = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if (arg === "--cwd") {
    const value = rawArgs[index + 1];
    if (!value) throw new Error("Missing value after --cwd");
    cwd = path.resolve(root, value);
    index += 1;
    continue;
  }

  if (arg === "--env-file") {
    const value = rawArgs[index + 1];
    if (!value) throw new Error("Missing value after --env-file");
    envFile = path.resolve(root, value);
    index += 1;
    continue;
  }

  npmArgs.push(arg);
}

if (npmArgs.length === 0) {
  throw new Error("Usage: node scripts/run-npm-with-env-token.mjs [--cwd path] [--env-file path] <npm args...>");
}

const envValues = existsSync(envFile) ? parseDotEnv(readFileSync(envFile, "utf8")) : {};
const token = process.env.NPM_TOKEN || envValues.NPM_TOKEN;

if (!token || token.trim() === "" || token === "npm_xxx" || token === "replace-me") {
  throw new Error(`Set NPM_TOKEN in ${path.relative(root, envFile)} before running npm registry commands`);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "canonicalpath-npm-"));
const userconfigPath = path.join(tempDir, ".npmrc");

try {
  writeFileSync(
    userconfigPath,
    `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\n`,
    { mode: 0o600 },
  );

  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    executable,
    [...npmArgs, "--registry", "https://registry.npmjs.org/", "--userconfig", userconfigPath],
    {
      cwd,
      env: { ...process.env, NPM_TOKEN: token },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  process.exit(typeof result.status === "number" ? result.status : 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function parseDotEnv(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[match[1]] = value;
  }

  return values;
}
