import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const noticeFiles = ["LICENSE.md", "LICENSE.ru.md", "NOTICE.md"];
const requiredUnitySigningEnv = [
  "UPM_ORGANIZATION_ID",
  "UPM_SERVICE_ACCOUNT_KEY_ID",
  "UPM_SERVICE_ACCOUNT_KEY_SECRET",
];

export function packUnitySigned(options = {}) {
  const packageDir = resolveFromRoot(options.packageDir ?? "packages/unity");
  const destination = resolveFromRoot(options.destination ?? "tmp/unity-signed");
  const envFile = resolveFromRoot(options.envFile ?? ".env");
  const envValues = existsSync(envFile) ? parseDotEnv(readFileSync(envFile, "utf8")) : {};
  const env = mergeEnv(envValues);
  const missing = requiredUnitySigningEnv.filter((key) => !isUsableSecret(env[key]));

  if (missing.length > 0) {
    throw new Error(
      `Set ${missing.join(", ")} in ${path.relative(root, envFile)} or the process environment before signing the Unity package`,
    );
  }

  const packageJsonPath = path.join(packageDir, "package.json");
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  mkdirSync(destination, { recursive: true });
  const startedAt = Date.now();

  syncNoticeFiles(packageDir);
  try {
    const result = spawnSync(
      "upm",
      ["pack", packageDir, "--organization-id", env.UPM_ORGANIZATION_ID, "--destination", destination],
      {
        cwd: root,
        env,
        stdio: "inherit",
      },
    );

    if (result.error) {
      if (result.error.code === "ENOENT") {
        throw new Error(
          "Unity Package Manager CLI `upm` was not found. Install it from Unity's UPM CLI documentation before signing.",
        );
      }

      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`Unity Package Manager CLI failed with exit code ${result.status ?? "unknown"}`);
    }

    const tarballPath = resolvePackedTarball(destination, manifest, startedAt);
    verifySignedTarball(tarballPath);

    console.log(`Signed Unity package: ${path.relative(root, tarballPath)}`);
    return { tarballPath, packageName: manifest.name, version: manifest.version };
  } finally {
    cleanNoticeFiles(packageDir);
  }
}

export function verifySignedTarball(tarballPath) {
  const entries = listTarGzipEntries(tarballPath);
  const hasAttestation = entries.some((entry) => entry === ".attestation.p7m" || entry.endsWith("/.attestation.p7m"));

  if (!hasAttestation) {
    throw new Error(
      `${path.relative(root, tarballPath)} does not contain Unity package signature file .attestation.p7m`,
    );
  }
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function mergeEnv(envValues) {
  const env = { ...process.env };

  for (const [key, value] of Object.entries(envValues)) {
    if (!Object.hasOwn(env, key) || env[key] === "") {
      env[key] = value;
    }
  }

  return env;
}

function isUsableSecret(value) {
  return typeof value === "string" && value.trim() !== "" && value !== "replace-me" && value !== "upm_xxx";
}

function syncNoticeFiles(packageDir) {
  for (const file of noticeFiles) {
    copyFileSync(path.join(root, file), path.join(packageDir, file));
  }
}

function cleanNoticeFiles(packageDir) {
  for (const file of noticeFiles) {
    const source = path.join(root, file);
    const target = path.join(packageDir, file);

    if (!existsSync(source) || !existsSync(target)) continue;

    if (readFileSync(source, "utf8") === readFileSync(target, "utf8")) {
      rmSync(target);
    }
  }
}

function resolvePackedTarball(destination, manifest, startedAt) {
  const expectedPath = path.join(destination, `${manifest.name}-${manifest.version}.tgz`);

  if (existsSync(expectedPath) && statSync(expectedPath).mtimeMs >= startedAt - 2000) {
    return expectedPath;
  }

  const freshTarballs = readdirSync(destination)
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => {
      const tarballPath = path.join(destination, entry);
      return { path: tarballPath, mtimeMs: statSync(tarballPath).mtimeMs };
    })
    .filter((entry) => entry.mtimeMs >= startedAt - 2000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (freshTarballs.length === 1) {
    return freshTarballs[0].path;
  }

  if (existsSync(expectedPath)) {
    return expectedPath;
  }

  throw new Error(
    `Could not find signed Unity tarball for ${manifest.name}@${manifest.version} in ${path.relative(root, destination)}`,
  );
}

function listTarGzipEntries(tarballPath) {
  const data = zlib.gunzipSync(readFileSync(tarballPath));
  const entries = [];
  let offset = 0;

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (isZeroBlock(header)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const sizeText = readTarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);

    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`${path.relative(root, tarballPath)} has an invalid tar entry size`);
    }

    entries.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return entries;
}

function isZeroBlock(block) {
  for (const byte of block) {
    if (byte !== 0) return false;
  }

  return true;
}

function readTarString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const nulIndex = slice.indexOf(0);
  return slice.subarray(0, nulIndex === -1 ? slice.length : nulIndex).toString("utf8");
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

function parseArgs(rawArgs) {
  const options = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--help") {
      return { help: true };
    }

    if (arg === "--package-dir") {
      options.packageDir = requiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--destination") {
      options.destination = requiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--env-file") {
      options.envFile = requiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requiredValue(args, index, flag) {
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value after ${flag}`);
  return value;
}

function printUsage() {
  console.log(
    "Usage: node scripts/pack-unity-signed.mjs [--package-dir path] [--destination path] [--env-file path]",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
    } else {
      packUnitySigned(options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
