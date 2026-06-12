import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const noticeFiles = ["LICENSE.md", "LICENSE.ru.md", "NOTICE.md"];
const unityPackageName = "com.romanilyin.canonicalpath";
const unityNoticeMetaFiles = new Map([
  [
    "LICENSE.md",
    `fileFormatVersion: 2
guid: 22836aa5098440e5bb54d782763f0c75
TextScriptImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`,
  ],
  [
    "LICENSE.ru.md",
    `fileFormatVersion: 2
guid: 1393847b992b469eb68ee96ee25566aa
TextScriptImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`,
  ],
  [
    "NOTICE.md",
    `fileFormatVersion: 2
guid: a646ff64ebaa47a7bdaf4493c9ffb99f
TextScriptImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`,
  ],
]);

export function copyPackageNotices(packageDir = process.cwd()) {
  const isUnityPackage = packageManifestName(packageDir) === unityPackageName;

  for (const file of noticeFiles) {
    const source = path.join(root, file);
    const target = path.join(packageDir, file);
    const unityMeta = unityNoticeMetaFiles.get(file);
    const unityMetaTarget = `${target}.meta`;

    copyFileSync(source, target);
    if (isUnityPackage && unityMeta !== undefined) {
      writeFileSync(unityMetaTarget, unityMeta, "utf8");
    }
  }
}

export function cleanPackageNotices(packageDir = process.cwd()) {
  const isUnityPackage = packageManifestName(packageDir) === unityPackageName;

  for (const file of noticeFiles) {
    const source = path.join(root, file);
    const target = path.join(packageDir, file);
    const unityMeta = unityNoticeMetaFiles.get(file);
    const unityMetaTarget = `${target}.meta`;

    if (isUnityPackage && unityMeta !== undefined && existsSync(unityMetaTarget)) {
      const targetMetaContents = readFileSync(unityMetaTarget, "utf8");
      if (targetMetaContents === unityMeta) {
        rmSync(unityMetaTarget);
      }
    }

    if (!existsSync(target)) continue;

    const sourceContents = readFileSync(source, "utf8");
    const targetContents = readFileSync(target, "utf8");

    if (sourceContents === targetContents) {
      rmSync(target);
    }
  }
}

function packageManifestName(packageDir) {
  const packageManifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  return packageManifest.name;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];

  if (mode !== "copy" && mode !== "clean") {
    throw new Error("Usage: node scripts/sync-npm-package-notices.mjs <copy|clean>");
  }

  if (mode === "copy") {
    copyPackageNotices();
  } else {
    cleanPackageNotices();
  }
}
