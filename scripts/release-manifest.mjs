import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const RELEASE_REPOSITORY = "romanilyin/canonicalpath";
export const PREPARE_WORKFLOW = ".github/workflows/prepare-npm-release.yml";
export const RELEASE_MANIFEST = "release-manifest.json";
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const sha = /^[a-f0-9]{40}$/;
const id = /^[1-9][0-9]{0,19}$/;
const filename = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.tgz$/;
const fail = message => { throw new Error(message); };

export function parseReleaseTag(tag) {
  if (typeof tag !== "string" || tag.length > 100) fail("Unsupported release tag");
  const match = /^(unity\/com\.romanilyin\.canonicalpath\/)?([0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}-[0-9]+)$/.exec(tag);
  if (!match) fail("Unsupported release tag");
  return { kind: match[1] ? "unity" : "full", version: match[2] };
}

export function expectedPackages(kind) {
  if (kind === "full") return ["@romanilyin/canonicalpath", "@romanilyin/canonicalpath-standalone", "com.romanilyin.canonicalpath"];
  if (kind === "unity") return ["com.romanilyin.canonicalpath"];
  fail("Unsupported release kind");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`Invalid ${label} fields`);
}

export function hash(bytes, algorithm = "sha256", encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

export function readBoundedFile(file, maxBytes) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) fail(`Invalid file type or size: ${path.basename(file)}`);
  const bytes = readFileSync(file);
  if (bytes.length !== stat.size) fail("File changed while reading");
  return bytes;
}

export function validatePackageMetadata(metadata, entry) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.name !== entry.name ||
      metadata.version !== entry.version || metadata.private === true) fail(`Tarball identity mismatch: ${entry.filename}`);
  const config = metadata.publishConfig;
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(key => key !== "registry" && key !== "access") ||
      !["https://registry.npmjs.org", "https://registry.npmjs.org/"].includes(config.registry) || config.access !== "public") {
    fail(`Unsafe tarball publishConfig: ${entry.filename}`);
  }
}

export function verifyPackageFile(directory, entry) {
  const file = path.join(directory, entry.filename);
  const bytes = readBoundedFile(file, MAX_PACKAGE_BYTES);
  if (entry.bytes !== bytes.length || entry.sha256 !== hash(bytes) || entry.integrity !== `sha512-${hash(bytes, "sha512", "base64")}`) {
    fail(`Tarball digest or size mismatch: ${entry.filename}`);
  }
  // Read only metadata to stdout. No archive extraction or package code executes.
  const metadata = JSON.parse(execFileSync("tar", ["--extract", "--to-stdout", "--gzip", "--file", file, "--", "package/package.json"], {
    encoding: "utf8", timeout: 10000, maxBuffer: 64 * 1024,
    env: { PATH: process.env.PATH, LANG: "C" }, stdio: ["ignore", "pipe", "pipe"],
  }));
  validatePackageMetadata(metadata, entry);
}

function validateEntries(packages, kind, version) {
  const names = new Set(expectedPackages(kind));
  const files = new Set();
  if (!Array.isArray(packages) || packages.length !== names.size) fail("Unexpected package count");
  for (const entry of packages) {
    exactKeys(entry, ["name", "version", "filename", "bytes", "sha256", "integrity"], "package");
    if (!names.delete(entry.name) || entry.version !== version) fail("Unexpected or duplicate package identity");
    if (typeof entry.filename !== "string" || !filename.test(entry.filename) || entry.filename.length > 200 || files.has(entry.filename)) fail("Unsafe or duplicate tarball filename");
    files.add(entry.filename);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_PACKAGE_BYTES) fail("Invalid package size");
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail("Invalid package SHA-256");
    if (typeof entry.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity) ||
        Buffer.from(entry.integrity.slice(7), "base64").toString("base64") !== entry.integrity.slice(7)) fail("Invalid package integrity");
  }
}

export function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

export function validateReleaseManifest(bytes, expected) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 1 || bytes.length > 32 * 1024) fail("Invalid release manifest size");
  const manifest = JSON.parse(bytes.toString("utf8"));
  // Producer emits one exact JSON representation. This also rejects duplicate
  // keys, invalid UTF-8 replacements and ambiguous non-canonical JSON inputs.
  if (!bytes.equals(Buffer.from(serializeManifest(manifest)))) fail("Release manifest is not canonical JSON");
  exactKeys(manifest, ["schema", "repository", "repositoryId", "releaseId", "tag", "kind", "version", "sourceCommit", "producer", "packages"], "release manifest");
  if (manifest.schema !== 1 || manifest.repository !== RELEASE_REPOSITORY || manifest.repository !== expected.repository ||
      typeof manifest.repositoryId !== "string" || !id.test(manifest.repositoryId) || manifest.repositoryId !== expected.repositoryId ||
      typeof manifest.releaseId !== "string" || !id.test(manifest.releaseId) || manifest.releaseId !== expected.releaseId ||
      manifest.tag !== expected.tag) fail("Release manifest identity mismatch");
  const { kind, version } = parseReleaseTag(manifest.tag);
  if (manifest.kind !== kind || manifest.version !== version || typeof manifest.sourceCommit !== "string" || !sha.test(manifest.sourceCommit)) fail("Release source or version mismatch");
  if (expected.sourceCommit !== undefined && manifest.sourceCommit !== expected.sourceCommit) fail("Original release commit mismatch");
  exactKeys(manifest.producer, ["workflow", "workflowCommit", "runId", "runAttempt"], "producer");
  const producer = manifest.producer;
  if (producer.workflow !== PREPARE_WORKFLOW || typeof producer.workflowCommit !== "string" || !sha.test(producer.workflowCommit) ||
      typeof producer.runId !== "string" || !id.test(producer.runId) || typeof producer.runAttempt !== "string" || !id.test(producer.runAttempt)) fail("Invalid release producer identity");
  if (manifest.sourceCommit !== producer.workflowCommit) fail("Release source must be the original main workflow commit");
  validateEntries(manifest.packages, kind, version);
  return manifest;
}

export function readPackedArtifacts(directory, tag) {
  const { kind, version } = parseReleaseTag(tag);
  const rows = readBoundedFile(path.join(directory, "manifest.tsv"), 4096).toString("utf8").trimEnd().split("\n");
  const packages = rows.map(row => {
    const fields = row.split("\t");
    if (fields.length !== 4) fail("Invalid pack manifest row");
    const [name, packageVersion, integrity, file] = fields;
    if (!filename.test(file) || file.length > 200) fail("Unsafe tarball filename");
    const bytes = readBoundedFile(path.join(directory, file), MAX_PACKAGE_BYTES);
    return { name, version: packageVersion, filename: file, bytes: bytes.length, sha256: hash(bytes), integrity };
  });
  validateEntries(packages, kind, version);
  verifyDirectoryEntries(directory, ["manifest.tsv", ...packages.map(entry => entry.filename)]);
  for (const entry of packages) verifyPackageFile(directory, entry);
  return packages;
}

export function makeReleaseManifest(context, packages) {
  const manifest = { schema: 1, repository: context.repository, repositoryId: context.repositoryId,
    releaseId: context.releaseId, tag: context.tag, ...parseReleaseTag(context.tag), sourceCommit: context.sourceCommit,
    producer: { workflow: PREPARE_WORKFLOW, workflowCommit: context.workflowCommit, runId: context.runId, runAttempt: context.runAttempt }, packages };
  return validateReleaseManifest(serializeManifest(manifest), context);
}

export function verifyDirectoryEntries(directory, expected) {
  if (readdirSync(directory).sort().join("\0") !== [...expected].sort().join("\0")) fail("Unexpected or missing release files");
}

export function verifyReleaseFiles(directory, manifest) {
  verifyDirectoryEntries(directory, [RELEASE_MANIFEST, ...manifest.packages.map(entry => entry.filename)]);
  for (const entry of manifest.packages) verifyPackageFile(directory, entry);
}

export function validateReleaseMetadata(release, expected) {
  parseReleaseTag(expected.tag);
  if (release.immutable !== true || release.draft !== false || release.prerelease !== false ||
      release.tag_name !== expected.tag || !Number.isSafeInteger(release.id) || release.id < 1 ||
      release.url !== `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/${release.id}` ||
      !release.published_at || !sha.test(release.target_commitish ?? "")) fail("An immutable published stable release targeting a full commit is required");
  if (expected.releaseId && String(release.id) !== expected.releaseId) fail("Release event ID mismatch");
  if (!Array.isArray(release.assets) || release.assets.length !== expectedPackages(parseReleaseTag(expected.tag).kind).length + 1) fail("Unexpected release asset set");
  const names = new Set();
  for (const asset of release.assets) {
    const limit = asset.name === RELEASE_MANIFEST ? 32 * 1024 : MAX_PACKAGE_BYTES;
    if (names.has(asset.name) || !(asset.name === RELEASE_MANIFEST || (typeof asset.name === "string" && filename.test(asset.name))) ||
        !Number.isSafeInteger(asset.id) || asset.id < 1 || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > limit ||
        asset.state !== "uploaded" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) fail("Invalid release asset metadata");
    names.add(asset.name);
  }
  if (!names.has(RELEASE_MANIFEST)) fail("Original release manifest is missing");
  return String(release.id);
}

export function validateProducerRun(run, manifest) {
  if (String(run.id) !== manifest.producer.runId || String(run.run_attempt) !== manifest.producer.runAttempt ||
      run.path !== PREPARE_WORKFLOW || run.event !== "workflow_dispatch" || run.head_branch !== "main" ||
      run.head_sha !== manifest.producer.workflowCommit || run.status !== "completed" || run.conclusion !== "success" ||
      String(run.repository?.id) !== manifest.repositoryId || run.repository?.full_name !== manifest.repository ||
      String(run.head_repository?.id) !== manifest.repositoryId) fail("Original release producer run is not trusted and successful");
}

export function publicationRows(manifest) {
  return manifest.packages.map(entry => [entry.name, entry.version, entry.integrity, entry.filename].join("\t")).join("\n") + "\n";
}
