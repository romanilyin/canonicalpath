import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const STINGER_LICENSE = "LicenseRef-Stinger-Royalty-Free-EULA-1.0";

let failed = false;

function fail(message) {
  failed = true;
  console.error(`[license-layout] ${message}`);
}

function file(relativePath) {
  return path.join(root, relativePath);
}

function readText(relativePath) {
  return readFileSync(file(relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function requireFile(relativePath) {
  if (!existsSync(file(relativePath))) fail(`Missing required file: ${relativePath}`);
}

function requireMissing(relativePath) {
  if (existsSync(file(relativePath))) {
    fail(`File should not exist at repository root after relicensing: ${relativePath}`);
  }
}

function requireContains(relativePath, text) {
  requireFile(relativePath);
  if (existsSync(file(relativePath)) && !readText(relativePath).includes(text)) {
    fail(`${relativePath} must contain: ${text}`);
  }
}

function requirePackageLicense(relativePath, expectedLicense) {
  requireFile(relativePath);
  if (!existsSync(file(relativePath))) return undefined;
  const pkg = readJson(relativePath);
  if (pkg.license !== expectedLicense) {
    fail(`${relativePath} must use license ${expectedLicense}, got ${pkg.license}`);
  }
  return pkg;
}

function requireFilesEntry(pkg, packageJsonPath, entry) {
  if (!Array.isArray(pkg.files) || !pkg.files.includes(entry)) {
    fail(`${packageJsonPath} files[] must include ${entry}`);
  }
}

function requireNoFilesEntry(pkg, packageJsonPath, entry) {
  if (Array.isArray(pkg.files) && pkg.files.includes(entry)) {
    fail(`${packageJsonPath} files[] must not include ${entry}`);
  }
}

function requireSameContents(left, right) {
  requireFile(left);
  requireFile(right);
  if (!existsSync(file(left)) || !existsSync(file(right))) return;
  if (readText(left) !== readText(right)) {
    fail(`${left} and ${right} must have identical contents`);
  }
}

requireContains("LICENSE.md", "MIT License");
requireContains("LICENSES/MIT.txt", "MIT License");
requireFile("LICENSES/Stinger-Royalty-Free-EULA-1.0.md");
requireFile("LICENSES/Stinger-Royalty-Free-EULA-1.0.ru.md");
requireMissing("LICENSE.ru.md");
requireMissing("NOTICE.ru.md");

const tsPkg = requirePackageLicense("packages/ts/package.json", "MIT");
if (tsPkg) {
  requireFilesEntry(tsPkg, "packages/ts/package.json", "LICENSE.md");
  requireFilesEntry(tsPkg, "packages/ts/package.json", "NOTICE.md");
  requireNoFilesEntry(tsPkg, "packages/ts/package.json", "LICENSE.ru.md");
  requireNoFilesEntry(tsPkg, "packages/ts/package.json", "NOTICE.ru.md");
}

const standalonePkg = requirePackageLicense("packages/javascript-standalone/package.json", "MIT");
if (standalonePkg) {
  requireFilesEntry(standalonePkg, "packages/javascript-standalone/package.json", "LICENSE.md");
  requireFilesEntry(standalonePkg, "packages/javascript-standalone/package.json", "NOTICE.md");
  requireNoFilesEntry(standalonePkg, "packages/javascript-standalone/package.json", "LICENSE.ru.md");
  requireNoFilesEntry(standalonePkg, "packages/javascript-standalone/package.json", "NOTICE.ru.md");
}

const unityPkg = requirePackageLicense("packages/unity/package.json", STINGER_LICENSE);
if (unityPkg) {
  const expectedLicenseUrl = "https://github.com/romanilyin/canonicalpath/blob/main/packages/unity/LICENSE.md";
  if (unityPkg.licensesUrl !== expectedLicenseUrl) {
    fail(`packages/unity/package.json licensesUrl must be ${expectedLicenseUrl}`);
  }

  for (const entry of [
    "LICENSE.md",
    "LICENSE.md.meta",
    "LICENSE.ru.md",
    "LICENSE.ru.md.meta",
    "NOTICE.md",
    "NOTICE.md.meta",
  ]) {
    requireFilesEntry(unityPkg, "packages/unity/package.json", entry);
    requireFile(`packages/unity/${entry}`);
  }
}

requireSameContents("LICENSES/Stinger-Royalty-Free-EULA-1.0.md", "packages/unity/LICENSE.md");
requireSameContents("LICENSES/Stinger-Royalty-Free-EULA-1.0.ru.md", "packages/unity/LICENSE.ru.md");

if (failed) process.exit(1);
console.log("License layout looks correct.");
