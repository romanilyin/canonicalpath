import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const STINGER_LICENSE = "LicenseRef-Stinger-Royalty-Free-EULA-1.0";

const profiles = {
  "@romanilyin/canonicalpath": {
    expectedLicense: "MIT",
    behavior: "temporary",
    files: [
      { source: "LICENSES/MIT.txt", target: "LICENSE.md" },
      { source: "NOTICE.md", target: "NOTICE.md" },
    ],
    forbiddenFiles: ["LICENSE.ru.md", "NOTICE.ru.md"],
  },

  "@romanilyin/canonicalpath-standalone": {
    expectedLicense: "MIT",
    behavior: "temporary",
    files: [
      { source: "LICENSES/MIT.txt", target: "LICENSE.md" },
      { source: "NOTICE.md", target: "NOTICE.md" },
    ],
    forbiddenFiles: ["LICENSE.ru.md", "NOTICE.ru.md"],
  },

  "com.romanilyin.canonicalpath": {
    expectedLicense: STINGER_LICENSE,
    behavior: "committed",
    files: [
      { source: "LICENSES/Stinger-Royalty-Free-EULA-1.0.md", target: "LICENSE.md" },
      { source: "LICENSES/Stinger-Royalty-Free-EULA-1.0.ru.md", target: "LICENSE.ru.md" },
    ],
    requiredFiles: [
      "LICENSE.md",
      "LICENSE.md.meta",
      "LICENSE.ru.md",
      "LICENSE.ru.md.meta",
      "NOTICE.md",
      "NOTICE.md.meta",
    ],
  },
};

export function copyPackageNotices(packageDir = process.cwd()) {
  syncPackageNotices("copy", packageDir);
}

export function cleanPackageNotices(packageDir = process.cwd()) {
  syncPackageNotices("clean", packageDir);
}

export function syncPackageNotices(mode, packageDir = process.cwd()) {
  if (mode !== "copy" && mode !== "clean") {
    fail("Usage: node scripts/sync-npm-package-notices.mjs <copy|clean>");
  }

  const resolvedPackageDir = path.resolve(packageDir);
  const pkg = packageJson(resolvedPackageDir);
  const profile = profiles[pkg.name];

  if (!profile) {
    fail(`No package license sync profile for package ${pkg.name}`);
  }

  validateProfile(pkg, profile);

  if (profile.behavior === "committed") {
    verifyCommitted(resolvedPackageDir, profile);
  } else if (mode === "copy") {
    copyTemporary(resolvedPackageDir, profile);
  } else {
    cleanTemporary(resolvedPackageDir);
  }
}

function fail(message) {
  throw new Error(`[license-sync] ${message}`);
}

function readText(file) {
  return readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function relativeToRoot(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function stateFileFor(packageDir) {
  return path.join(packageDir, ".canonicalpath-notice-sync-state.json");
}

function requireFile(file, label = file) {
  if (!existsSync(file)) fail(`Missing ${label}: ${relativeToRoot(file)}`);
}

function assertSameContents(source, target) {
  requireFile(source, "source file");
  requireFile(target, "target file");

  const sourceContents = readText(source);
  const targetContents = readText(target);

  if (sourceContents !== targetContents) {
    fail(
      `Committed package license file is out of sync. ` +
        `Expected ${relativeToRoot(target)} to match ${relativeToRoot(source)}.`,
    );
  }
}

function packageJson(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  requireFile(packageJsonPath, "package.json");
  return readJson(packageJsonPath);
}

function validateProfile(pkg, profile) {
  if (pkg.license !== profile.expectedLicense) {
    fail(
      `${pkg.name} must use license ${profile.expectedLicense}, ` +
        `but package.json says ${pkg.license}`,
    );
  }
}

function validateForbiddenFiles(packageDir, profile) {
  for (const file of profile.forbiddenFiles ?? []) {
    const target = path.join(packageDir, file);
    if (existsSync(target)) {
      fail(
        `MIT package contains stale ${file}. Remove it from the package directory ` +
          `and from package.json files[].`,
      );
    }
  }
}

function copyTemporary(packageDir, profile) {
  validateForbiddenFiles(packageDir, profile);

  const state = {
    version: 1,
    packageDir: relativeToRoot(packageDir),
    entries: [],
  };

  for (const entry of profile.files) {
    const source = path.join(root, entry.source);
    const target = path.join(packageDir, entry.target);

    requireFile(source, "source file");
    mkdirSync(path.dirname(target), { recursive: true });

    if (existsSync(target)) {
      if (readText(target) !== readText(source)) {
        fail(
          `${relativeToRoot(target)} already exists and differs from ` +
            `${relativeToRoot(source)}. Refusing to overwrite a committed package file.`,
        );
      }

      state.entries.push({ action: "left-existing", source: entry.source, target: entry.target });
      continue;
    }

    copyFileSync(source, target);
    state.entries.push({ action: "created", source: entry.source, target: entry.target });
  }

  writeFileSync(stateFileFor(packageDir), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function cleanTemporary(packageDir) {
  const stateFile = stateFileFor(packageDir);
  if (!existsSync(stateFile)) return;

  const state = readJson(stateFile);

  for (const entry of state.entries ?? []) {
    if (entry.action !== "created") continue;

    const source = path.join(root, entry.source);
    const target = path.join(packageDir, entry.target);

    if (!existsSync(target)) continue;

    if (existsSync(source) && readText(target) === readText(source)) {
      rmSync(target);
    }
  }

  rmSync(stateFile);
}

function verifyCommitted(packageDir, profile) {
  for (const file of profile.requiredFiles ?? []) {
    requireFile(path.join(packageDir, file), `committed package file ${file}`);
  }

  for (const entry of profile.files) {
    assertSameContents(path.join(root, entry.source), path.join(packageDir, entry.target));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncPackageNotices(process.argv[2]);
}
