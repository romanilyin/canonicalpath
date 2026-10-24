import { execFileSync } from "node:child_process";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_REPOSITORY, RELEASE_MANIFEST, hash, readBoundedFile, readPackedArtifacts, makeReleaseManifest, serializeManifest } from "./release-manifest.mjs";

function executeCommand(command, args) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function createNpmReleaseDraft(env = process.env, execute = executeCommand) {
  // Called only in the fresh draft job at github.workflow_sha. No package code is
  // executed in this job. Source packages were built in the read-only build job.
  const directory = path.join(env.RUNNER_TEMP, "npm-packages");
  if (env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY || env.GITHUB_REF !== "refs/heads/main" ||
      !/^[a-f0-9]{40}$/.test(env.SOURCE_COMMIT ?? "") || env.SOURCE_COMMIT !== env.WORKFLOW_COMMIT) throw new Error("Draft source must equal the original main workflow commit");
  if (hash(readBoundedFile(path.join(directory, "manifest.tsv"), 4096)) !== env.MANIFEST_SHA256) throw new Error("Build artifact transfer digest mismatch");
  const packages = readPackedArtifacts(directory, env.RELEASE_TAG);
  const command = args => execute("gh", args);
  const api = (route, options = []) => JSON.parse(command(["api", `repos/${env.GITHUB_REPOSITORY}/${route}`, ...options]));
  const context = { repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID,
    tag: env.RELEASE_TAG, sourceCommit: env.SOURCE_COMMIT, workflowCommit: env.WORKFLOW_COMMIT,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
  // Validate all data before acquiring a release ID; the temporary ID is never
  // persisted or signed. The real immutable identity is set after draft creation.
  makeReleaseManifest({ ...context, releaseId: "1" }, packages);
  if (!["ahead", "identical"].includes(api(`compare/${env.SOURCE_COMMIT}...main`).status)) throw new Error("Release source is not on main");
  // REST lookup by tag returns published releases only. Authenticated listing
  // includes drafts; require every page before treating this tag as unused.
  const pages = api("releases?per_page=100", ["--paginate", "--slurp"]);
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("Malformed release inventory");
  for (const page of pages) {
    if (!Array.isArray(page) || page.length > 100) throw new Error("Malformed release inventory page");
    for (const release of page) {
      if (release === null || typeof release !== "object" || !Number.isSafeInteger(release.id) || release.id < 1 ||
          typeof release.tag_name !== "string" || release.tag_name.length === 0 || typeof release.draft !== "boolean") throw new Error("Malformed release inventory entry");
      if (release.tag_name === env.RELEASE_TAG) throw new Error("The release tag or draft already exists; use a new version, never replace original artifacts");
    }
  }
  try {
    api(`git/ref/tags/${env.RELEASE_TAG}`);
    throw new Error("The release tag or draft already exists; use a new version, never replace original artifacts");
  } catch (error) {
    if (!Number.isInteger(error.status) || error.status <= 0 || error.signal != null || !/\(HTTP 404\)/.test(String(error.stderr))) throw error;
  }
  const requestPath = path.join(env.RUNNER_TEMP, "npm-release-request.json");
  const body = `Prepared npm release ${env.RELEASE_TAG}\n\nSource commit: ${env.SOURCE_COMMIT}\nProducer: https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}\n\nReview the source, manifest and package assets. Publish this draft only after the preparation run succeeds and immutable releases are enabled.\n`;
  writeFileSync(requestPath, JSON.stringify({ tag_name: env.RELEASE_TAG, target_commitish: env.SOURCE_COMMIT,
    name: env.RELEASE_TAG, body, draft: true, prerelease: false }) + "\n", { flag: "wx", mode: 0o600 });
  let release;
  try {
    // Bind the ID returned by creation itself; a pending tag cannot be fetched
    // through the published-release endpoint, and must not select another draft.
    release = api("releases", ["--method", "POST", "--input", requestPath]);
  } finally {
    rmSync(requestPath, { force: true });
  }
  if (release === null || typeof release !== "object" || release.draft !== true || release.prerelease !== false ||
      release.tag_name !== env.RELEASE_TAG || release.target_commitish !== env.SOURCE_COMMIT ||
      !Number.isSafeInteger(release.id) || release.id < 1 || release.url !== `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases/${release.id}` ||
      !Array.isArray(release.assets) || release.assets.length !== 0) throw new Error("Unexpected newly created draft identity");
  const manifest = makeReleaseManifest({ ...context, releaseId: String(release.id) }, packages);
  writeFileSync(path.join(directory, RELEASE_MANIFEST), serializeManifest(manifest), { flag: "wx", mode: 0o600 });
  rmSync(path.join(directory, "manifest.tsv"));
  appendFileSync(env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = createNpmReleaseDraft();
  console.log(`Created draft ${manifest.releaseId}; publication is a separate reviewed action after attestation and upload`);
}
