import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASE_REPOSITORY, RELEASE_MANIFEST, PREPARE_WORKFLOW, hash, readBoundedFile,
  parseReleaseTag, validateReleaseManifest, validateReleaseMetadata, validateProducerRun,
  verifyReleaseFiles, publicationRows,
} from "./release-manifest.mjs";

function execute(command, args) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"] });
}

// This job has read permissions only. The caller transfers only verified data,
// never this helper or any downloaded executable, to the npm/OIDC runner.
export function verifyNpmRelease(context, run = execute) {
  if (context.repository !== RELEASE_REPOSITORY || !/^[1-9][0-9]*$/.test(context.repositoryId ?? "")) throw new Error("Unexpected repository");
  const tagInfo = parseReleaseTag(context.tag);
  const api = route => JSON.parse(run("gh", ["api", `repos/${context.repository}/${route}`]));
  const release = api(`releases/tags/${encodeURIComponent(context.tag)}`);
  const releaseId = validateReleaseMetadata(release, context);

  // GitHub's own release attestation proves the tag/assets were locked together.
  // It is a separate trust check from Actions producer provenance below.
  run("gh", ["release", "verify", context.tag, "--repo", context.repository, "--format", "json"]);
  let reference = api(`git/ref/tags/${context.tag}`).object;
  for (let depth = 0; reference?.type === "tag" && depth < 4; depth++) {
    if (!/^[a-f0-9]{40}$/.test(reference.sha ?? "")) throw new Error("Invalid annotated tag object");
    reference = api(`git/tags/${reference.sha}`).object;
  }
  if (reference?.type !== "commit" || !/^[a-f0-9]{40}$/.test(reference.sha ?? "")) throw new Error("Release tag does not resolve to a commit");
  const sourceCommit = reference.sha;
  if (release.target_commitish !== sourceCommit || (context.eventSha && context.eventSha !== sourceCommit)) throw new Error("Original release commit mismatch");
  const sourceComparison = api(`compare/${sourceCommit}...main`);
  if (!["ahead", "identical"].includes(sourceComparison.status)) throw new Error("Release source is not on main");

  mkdirSync(context.directory, { recursive: false });
  const manifestAsset = release.assets.find(asset => asset.name === RELEASE_MANIFEST);
  const download = asset => {
    run("gh", ["release", "download", context.tag, "--repo", context.repository, "--pattern", asset.name, "--dir", context.directory]);
    const file = path.join(context.directory, asset.name);
    const bytes = readBoundedFile(file, asset.size);
    if (bytes.length !== asset.size || `sha256:${hash(bytes)}` !== asset.digest) throw new Error("Release API asset digest mismatch");
    run("gh", ["release", "verify-asset", context.tag, file, "--repo", context.repository]);
    return bytes;
  };
  const manifestBytes = download(manifestAsset);
  const manifest = validateReleaseManifest(manifestBytes, { ...context, releaseId, sourceCommit });

  // The expected signer path, branch and repository are policy constants, not
  // artifact-selected trust roots. The claimed workflow commit must also be on main.
  run("gh", ["attestation", "verify", path.join(context.directory, RELEASE_MANIFEST),
    "--repo", context.repository,
    "--signer-workflow", `${context.repository}/${PREPARE_WORKFLOW}`,
    "--signer-digest", manifest.producer.workflowCommit,
    "--source-digest", manifest.producer.workflowCommit,
    "--source-ref", "refs/heads/main", "--deny-self-hosted-runners"]);
  const workflowComparison = api(`compare/${manifest.producer.workflowCommit}...main`);
  if (!["ahead", "identical"].includes(workflowComparison.status)) throw new Error("Producer workflow commit is not on main");
  validateProducerRun(api(`actions/runs/${manifest.producer.runId}/attempts/${manifest.producer.runAttempt}`), manifest);
  for (const entry of manifest.packages) {
    const asset = release.assets.find(value => value.name === entry.filename);
    if (!asset || asset.size !== entry.bytes || asset.digest !== `sha256:${entry.sha256}`) throw new Error("Original package asset mismatch");
    download(asset);
  }
  verifyReleaseFiles(context.directory, manifest);

  // Re-read the locked release identity before exporting any usable publication
  // data. A stale event, deleted release or changed asset list must fail closed.
  const after = api(`releases/${releaseId}`);
  validateReleaseMetadata(after, { ...context, releaseId });
  const assetIdentity = value => value.assets.map(asset => [asset.id, asset.name, asset.size, asset.digest].join(":")).sort().join("\n");
  if (after.target_commitish !== sourceCommit || assetIdentity(after) !== assetIdentity(release)) throw new Error("Release changed during verification");
  const rows = publicationRows(manifest);
  writeFileSync(path.join(context.directory, "manifest.tsv"), rows, { flag: "wx", mode: 0o600 });
  return { ...tagInfo, source_commit: sourceCommit, release_id: releaseId,
    manifest_sha256: hash(rows), release_manifest_sha256: hash(manifestBytes) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verified = verifyNpmRelease({ repository: process.env.GITHUB_REPOSITORY, repositoryId: process.env.GITHUB_REPOSITORY_ID,
    tag: process.env.RELEASE_TAG, releaseId: process.env.RELEASE_EVENT_ID || undefined, eventSha: process.env.RELEASE_EVENT_SHA || undefined,
    directory: path.join(process.env.RUNNER_TEMP, "npm-packages") });
  for (const [key, value] of Object.entries(verified)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`Verified immutable release ${verified.release_id} at ${verified.source_commit}`);
}
