import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const root = fileURLToPath(new URL("..", import.meta.url));
const packageDir = process.cwd();
const noticeFiles = ["LICENSE.md", "LICENSE.ru.md", "NOTICE.md"];

if (mode !== "copy" && mode !== "clean") {
  throw new Error("Usage: node scripts/sync-npm-package-notices.mjs <copy|clean>");
}

for (const file of noticeFiles) {
  const source = path.join(root, file);
  const target = path.join(packageDir, file);

  if (mode === "copy") {
    copyFileSync(source, target);
    continue;
  }

  if (!existsSync(target)) continue;

  const sourceContents = readFileSync(source, "utf8");
  const targetContents = readFileSync(target, "utf8");

  if (sourceContents === targetContents) {
    rmSync(target);
  }
}
