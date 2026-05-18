import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const changelogPath = path.join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");

const heading = "## Unreleased";
const headingIndex = changelog.indexOf(`${heading}\n`);

if (headingIndex === -1) {
  throw new Error("CHANGELOG.md must contain a '## Unreleased' section");
}

const afterHeading = changelog.slice(headingIndex + heading.length + 1);
const nextHeadingIndex = afterHeading.search(/\n##\s+/);
const body = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
const hasEntry = body.split("\n").some((line) => /^-\s+\S/.test(line.trim()));

if (!hasEntry) {
  throw new Error("CHANGELOG.md '## Unreleased' must contain at least one bullet entry");
}

console.log("CHANGELOG.md has an Unreleased entry");
