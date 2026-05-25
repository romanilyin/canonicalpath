import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packUnitySigned } from "./pack-unity-signed.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
  const { packOptions, npmArgs } = parseArgs(process.argv.slice(2));
  assertNpmToken(packOptions.envFile ?? ".env");

  const { tarballPath } = packUnitySigned(packOptions);
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/run-npm-with-env-token.mjs"), "publish", tarballPath, ...npmArgs],
    {
      cwd: root,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  process.exit(typeof result.status === "number" ? result.status : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(rawArgs) {
  const packOptions = {};
  const npmArgs = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--package-dir") {
      packOptions.packageDir = requiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--destination") {
      packOptions.destination = requiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--env-file") {
      packOptions.envFile = requiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    npmArgs.push(arg);
  }

  return { packOptions, npmArgs };
}

function requiredValue(args, index, flag) {
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value after ${flag}`);
  return value;
}

function assertNpmToken(envFileValue) {
  const envFile = path.isAbsolute(envFileValue) ? envFileValue : path.resolve(root, envFileValue);
  const envValues = existsSync(envFile) ? parseDotEnv(readFileSync(envFile, "utf8")) : {};
  const token = process.env.NPM_TOKEN || envValues.NPM_TOKEN;

  if (!token || token.trim() === "" || token === "npm_xxx" || token === "replace-me") {
    throw new Error(
      `Set NPM_TOKEN in ${path.relative(root, envFile)} or the process environment before publishing the signed Unity package`,
    );
  }
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
