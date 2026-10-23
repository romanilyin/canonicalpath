import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { RELEASE_REPOSITORY, PREPARE_WORKFLOW, RELEASE_MANIFEST, hash, makeReleaseManifest,
  serializeManifest, validateReleaseManifest, validateProducerRun, publicationRows, expectedPackages } from "./release-manifest.mjs";
import { verifyNpmRelease } from "./verify-npm-release.mjs";
import { planPublication, preflightNpmPackages } from "./release-publication-plan.mjs";
import { createNpmReleaseDraft } from "./create-npm-release-draft.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceCommit = "a".repeat(40);
const version = "2026.10.22-1";
function tarball(name) {
  const data = Buffer.from(JSON.stringify({ name, version, publishConfig: { registry: "https://registry.npmjs.org/", access: "public" } }));
  const header = Buffer.alloc(512);
  header.write("package/package.json");
  for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, data.length], [136, 12, 0]]) {
    header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset);
  }
  header.fill(32, 148, 156); header[156] = 48;
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512 + 1024)]));
}
function fixture(kind = "unity") {
  const tag = kind === "full" ? version : `unity/com.romanilyin.canonicalpath/${version}`;
  const context = { repository: RELEASE_REPOSITORY, repositoryId: "1238638512", releaseId: "101", tag, sourceCommit,
    workflowCommit: sourceCommit, runId: "201", runAttempt: "1" };
  const files = new Map();
  const packages = expectedPackages(kind).map((name, index) => {
    const bytes = tarball(name), filename = `package-${index}.tgz`;
    files.set(filename, bytes);
    return { name, version, filename, bytes: bytes.length, sha256: hash(bytes), integrity: `sha512-${hash(bytes, "sha512", "base64")}` };
  });
  const manifest = makeReleaseManifest(context, packages);
  const release = { id: 101, tag_name: tag, target_commitish: sourceCommit, immutable: true, draft: false, prerelease: false,
    url: `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/101`, published_at: "2026-10-22T12:00:00Z", assets: [] };
  const producer = { id: 201, run_attempt: 1, path: PREPARE_WORKFLOW, event: "workflow_dispatch", head_branch: "main", head_sha: sourceCommit,
    status: "completed", conclusion: "success", repository: { id: 1238638512, full_name: RELEASE_REPOSITORY }, head_repository: { id: 1238638512 } };
  const sample = { context, files, manifest, release, producer, calls: [], tagObject: { type: "commit", sha: sourceCommit }, failCommand: undefined, after: undefined };
  sample.refresh = () => {
    files.set(RELEASE_MANIFEST, Buffer.from(serializeManifest(manifest)));
    release.assets = [...files].map(([name, bytes], index) => ({ id: index + 1001, name, size: bytes.length, digest: `sha256:${hash(bytes)}`, state: "uploaded" }));
  };
  sample.refresh();
  sample.run = (command, args) => {
    assert.equal(command, "gh", "The verifier must never rebuild or invoke npm");
    sample.calls.push(args);
    if (sample.failCommand && args.slice(0, sample.failCommand.length).join(" ") === sample.failCommand.join(" ")) throw new Error("Mocked external trust check failed");
    if (args[0] === "api") {
      const route = args[1];
      if (route.includes("/releases/tags/")) return JSON.stringify(release);
      if (route.endsWith("/releases/101")) return JSON.stringify(sample.after ?? release);
      if (route.includes("/git/ref/tags/")) return JSON.stringify({ object: sample.tagObject });
      if (route.includes("/git/tags/")) return JSON.stringify({ object: { type: "commit", sha: sourceCommit } });
      if (route.includes("/compare/")) return JSON.stringify({ status: "ahead" });
      if (route.includes("/actions/runs/")) return JSON.stringify(producer);
      throw new Error(`Unexpected API request ${route}`);
    }
    if (args[0] === "release" && args[1] === "download") {
      const name = args[args.indexOf("--pattern") + 1];
      if (!files.has(name)) throw new Error("Original release asset missing");
      writeFileSync(path.join(args[args.indexOf("--dir") + 1], name), files.get(name));
    }
    return "{}";
  };
  return sample;
}
function withDownload(sample, action) {
  const scratch = mkdtempSync(path.join(tmpdir(), "canonicalpath-release-"));
  try { return action({ ...sample.context, directory: path.join(scratch, "verified") }); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}

for (const kind of ["full", "unity"]) {
  test(`${kind}: retries transfer exactly the original digest-bound release bytes`, () => {
    const sample = fixture(kind);
    withDownload(sample, context => {
      const verified = verifyNpmRelease(context, sample.run);
      assert.equal(verified.source_commit, sourceCommit);
      assert.equal(verified.release_manifest_sha256, hash(sample.files.get(RELEASE_MANIFEST)));
      assert.equal(verified.manifest_sha256, hash(publicationRows(sample.manifest)));
      for (const [file, bytes] of sample.files) assert.deepEqual(readFileSync(path.join(context.directory, file)), bytes);
    });
    const attestation = sample.calls.find(args => args[0] === "attestation");
    assert.ok(attestation.includes(`${RELEASE_REPOSITORY}/${PREPARE_WORKFLOW}`));
    assert.ok(attestation.includes("refs/heads/main"));
    assert.ok(attestation.includes("--deny-self-hosted-runners"));
    assert.equal(sample.calls.filter(args => args[1] === "verify-asset").length, sample.files.size);
  });
}
test("Annotated original tags resolve to the same bound source commit", () => {
  const sample = fixture(); sample.tagObject = { type: "tag", sha: "b".repeat(40) };
  withDownload(sample, context => assert.equal(verifyNpmRelease(context, sample.run).source_commit, sourceCommit));
});
test("Draft preparation binds its new release ID and refuses any existing baseline", () => {
  for (const existing of [false, true]) {
    const sample = fixture(), scratch = mkdtempSync(path.join(tmpdir(), "canonicalpath-draft-"));
    const directory = path.join(scratch, "npm-packages"); mkdirSync(directory);
    const rows = publicationRows(sample.manifest);
    writeFileSync(path.join(directory, "manifest.tsv"), rows);
    writeFileSync(path.join(directory, "package-0.tgz"), sample.files.get("package-0.tgz"));
    const env = { RUNNER_TEMP: scratch, GITHUB_REPOSITORY: RELEASE_REPOSITORY, GITHUB_REPOSITORY_ID: sample.context.repositoryId,
      GITHUB_REF: "refs/heads/main", SOURCE_COMMIT: sourceCommit, WORKFLOW_COMMIT: sourceCommit,
      RELEASE_TAG: sample.context.tag, GITHUB_RUN_ID: "201", GITHUB_RUN_ATTEMPT: "1", GITHUB_OUTPUT: path.join(scratch, "output"),
      MANIFEST_SHA256: hash(rows) };
    let created = false;
    const run = (command, args) => {
      assert.equal(command, "gh");
      if (args[0] === "api") {
        if (args[1].includes("/compare/")) return '{"status":"ahead"}';
        if ((existing || created) && args[1].includes("/releases/tags/")) return JSON.stringify({ ...sample.release, draft: true, assets: [] });
        const error = new Error("missing"); error.status = 1; error.stderr = "gh: Not Found (HTTP 404)"; throw error;
      }
      assert.deepEqual(args.slice(0, 3), ["release", "create", sample.context.tag]);
      assert.ok(args.includes("--draft"));
      assert.equal(args[args.indexOf("--target") + 1], sourceCommit);
      assert.ok(!args.includes("--clobber"));
      created = true;
      return "";
    };
    try {
      if (existing) {
        assert.throws(() => createNpmReleaseDraft(env, run), /already exists/);
        assert.equal(created, false);
      } else {
        assert.throws(() => createNpmReleaseDraft({ ...env, SOURCE_COMMIT: "b".repeat(40) }, run), /original main workflow commit/);
        assert.equal(created, false);
        const manifest = createNpmReleaseDraft(env, run);
        assert.equal(created, true);
        assert.equal(manifest.releaseId, "101");
        validateReleaseManifest(readFileSync(path.join(directory, RELEASE_MANIFEST)), sample.context);
      }
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
});
const rejected = [
  ["moved source tag", sample => { sample.tagObject.sha = "b".repeat(40); }],
  ["moved tag and changed target", sample => { sample.tagObject.sha = "b".repeat(40); sample.release.target_commitish = "b".repeat(40); }],
  ["mutable historical release", sample => { sample.release.immutable = false; }],
  ["missing original manifest", sample => { sample.release.assets = sample.release.assets.filter(asset => asset.name !== RELEASE_MANIFEST); }],
  ["wrong original release ID", sample => { sample.manifest.releaseId = "102"; sample.refresh(); }],
  ["wrong repository ID", sample => { sample.manifest.repositoryId = "999"; sample.refresh(); }],
  ["wrong producer workflow", sample => { sample.manifest.producer.workflow = ".github/workflows/other.yml"; sample.refresh(); }],
  ["wrong producer source commit", sample => { sample.manifest.producer.workflowCommit = "b".repeat(40); sample.refresh(); }],
  ["failed producer attempt", sample => { sample.producer.conclusion = "failure"; }],
  ["forked producer run", sample => { sample.producer.head_repository.id = 999; }],
  ["changed workflow attempt", sample => { sample.producer.run_attempt = 2; }],
  ["unverified release attestation", sample => { sample.failCommand = ["release", "verify"]; }],
  ["unverified asset attestation", sample => { sample.failCommand = ["release", "verify-asset"]; }],
  ["unverified producer signature", sample => { sample.failCommand = ["attestation", "verify"]; }],
  ["altered original package bytes", sample => { sample.files.set("package-0.tgz", Buffer.from("corrupted")); }],
  ["missing package file", sample => { sample.files.delete("package-0.tgz"); }],
  ["wrong event source", sample => { sample.context.eventSha = "b".repeat(40); }],
  ["release changed during verification", sample => { sample.after = structuredClone(sample.release); sample.after.assets[0].id += 1; }],
];
for (const [name, alter] of rejected) test(`${name} fails before publication data is returned`, () => {
  const sample = fixture(); alter(sample);
  withDownload(sample, context => assert.throws(() => verifyNpmRelease(context, sample.run)));
});

test("Manifest parser rejects ambiguous fields, traversal and duplicate identities", () => {
  const sample = fixture("full");
  for (const mutate of [
    m => { m.extra = true; }, m => { m.schema = 2; }, m => { m.packages.pop(); },
    m => { m.packages[1] = m.packages[0]; }, m => { m.packages[0].filename = "../package.tgz"; },
    m => { m.packages[0].bytes = 64 * 1024 * 1024 + 1; }, m => { m.packages[0].sha256 = "0"; },
  ]) {
    const manifest = structuredClone(sample.manifest); mutate(manifest);
    assert.throws(() => validateReleaseManifest(serializeManifest(manifest), sample.context));
  }
  const duplicateKey = serializeManifest(sample.manifest).replace('"schema": 1,', '"schema": 9,\n  "schema": 1,');
  assert.throws(() => validateReleaseManifest(duplicateKey, sample.context), /canonical JSON/);
  assert.throws(() => validateReleaseManifest(Buffer.alloc(32769), sample.context), /size/);
  assert.throws(() => validateProducerRun({ ...sample.producer, head_branch: "feature" }, sample.manifest), /not trusted/);
});

test("Partial publication skips identical versions and retains original pending artifacts", () => {
  const sample = fixture("full"), rows = publicationRows(sample.manifest).trimEnd().split("\n");
  const first = sample.manifest.packages[0];
  const plan = planPublication(rows, name => name === first.name ? { integrity: first.integrity, latest: version } : { integrity: null, latest: "2026.10.21-1" });
  assert.deepEqual(plan.skipped, [{ name: first.name, version }]);
  assert.deepEqual(plan.pending.map(p => p.filename), sample.manifest.packages.slice(1).map(p => p.filename));
  assert.deepEqual(plan.pending.map(p => p.integrity), sample.manifest.packages.slice(1).map(p => p.integrity));
  assert.equal(planPublication(rows, name => ({ integrity: sample.manifest.packages.find(p => p.name === name).integrity, latest: version })).pending.length, 0);
});
test("Any registry mismatch, rollback or outage aborts the complete publication plan", () => {
  const sample = fixture("full"), rows = publicationRows(sample.manifest).trimEnd().split("\n");
  for (const conflict of [
    { integrity: "sha512-wrong", latest: version },
    { integrity: sample.manifest.packages[2].integrity, latest: "2026.10.23-1" },
  ]) assert.throws(() => planPublication(rows, name => name === sample.manifest.packages[2].name ? conflict : { integrity: null, latest: "2026.10.21-1" }));
  assert.throws(() => planPublication(rows, () => { throw new Error("network unavailable"); }), /network unavailable/);
});

test("A missing original version cannot roll latest back or bypass an unknown registry state", () => {
  const sample = fixture(), rows = publicationRows(sample.manifest).trimEnd().split("\n");
  for (const latest of [version, "2026.10.22-2", "2026.10.23-1", "2026.11.1-1", "2027.1.1-1"]) {
    assert.throws(() => planPublication(rows, () => ({ integrity: null, latest })), /refusing a rollback/);
  }
  for (const latest of ["1.2.3", "2026.10.22", "2026.10.22-01", "2026.2.30-1", "2026.13.1-1", "2026.10.21-1+build", "latest", "", undefined]) {
    assert.throws(() => planPublication(rows, () => ({ integrity: null, latest })));
  }
  for (const current of [null, undefined, { integrity: null }]) assert.throws(() => planPublication(rows, () => current), /both the target version and latest/);
});

test("Missing versions advance latest only from an older calendar version or an absent package", () => {
  const sample = fixture(), rows = publicationRows(sample.manifest).trimEnd().split("\n");
  for (const latest of [null, "2025.12.31-99", "2026.9.30-99", "2026.10.21-99", "2026.10.22-0"]) {
    assert.equal(planPublication(rows, () => ({ integrity: null, latest })).pending.length, 1);
  }
  const nextRows = rows.map(row => row.replace(`\t${version}\t`, "\t2026.10.22-10\t"));
  assert.equal(planPublication(nextRows, () => ({ integrity: null, latest: "2026.10.22-2" })).pending.length, 1);
  assert.throws(() => planPublication(rows, () => ({ integrity: null, latest: "2026.10.22-10" })), /refusing a rollback/);
});

test("Actual preflight checks latest after a missing version and writes no pending plan on failure", () => {
  const sample = fixture(), rows = publicationRows(sample.manifest);
  const scratch = mkdtempSync(path.join(tmpdir(), "canonicalpath-npm-preflight-"));
  const missing = () => { const error = new Error("missing"); error.status = 1; error.stdout = JSON.stringify({ error: { code: "E404" } }); throw error; };
  try {
    writeFileSync(path.join(scratch, "manifest.tsv"), rows);
    for (const latest of ["2026.10.23-1", "unsupported", "registry-error", "malformed-json"]) {
      const calls = [];
      const run = (command, args) => {
        assert.equal(command, "npm"); calls.push(args);
        if (args[2] === "dist.integrity") return missing();
        assert.equal(args[2], "dist-tags.latest");
        if (latest === "registry-error") { const error = new Error("unavailable"); error.status = 1; error.stdout = JSON.stringify({ error: { code: "E503" } }); throw error; }
        return latest === "malformed-json" ? "{" : JSON.stringify(latest);
      };
      assert.throws(() => preflightNpmPackages(scratch, run));
      assert.equal(calls.length, 2, "missing version must still perform its separate latest lookup");
      assert.equal(existsSync(path.join(scratch, "pending.tsv")), false);
    }
    let count = 0;
    preflightNpmPackages(scratch, () => { count++; return missing(); });
    assert.equal(count, 2, "a first package requires independent not-found results for version and latest");
    assert.ok(readFileSync(path.join(scratch, "pending.tsv"), "utf8").includes(version));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("Publisher uses the tested preflight and never rebuilds source on retry", () => {
  const readSource = name => readFileSync(path.join(root, name), "utf8").replace(/\r\n/g, "\n");
  const workflow = readSource(".github/workflows/publish-npm.yml");
  const step = workflow.split("- name: Preflight npm versions")[1].split("- name: Verify npm trusted publishing access")[0];
  const inline = step.match(/node --input-type=module <<'JS'\r?\n([\s\S]*?)\r?\n\s*JS/)[1].replace(/^          /gm, "");
  assert.equal(inline, readSource("scripts/release-publication-plan.mjs").trimEnd() + "\npreflightNpmPackages(process.env.RUNNER_TEMP + '/npm-packages');");
  assert.doesNotMatch(workflow, /npm pack\b|pnpm install\b|refs\/tags\/\$|needs: build/);
  const privileged = workflow.split("\n  publish:\n")[1];
  assert.match(privileged, /environment: npm-immutable/);
  assert.doesNotMatch(privileged, /actions\/checkout|run: node scripts\//);
  assert.match(privileged, /artifact-ids: \$\{\{ needs\.verify\.outputs\.artifact_id \}\}/);
  assert.match(privileged, /RELEASE_MANIFEST_SHA256/);
  assert.match(privileged, /--ignore-scripts=true/);
  const prepare = readSource(".github/workflows/prepare-npm-release.yml");
  assert.doesNotMatch(prepare.split("\n  draft:\n")[0], /id-token: write/);
  assert.match(prepare, /test "\$SOURCE_COMMIT" = "\$WORKFLOW_COMMIT"/);
  assert.match(prepare, /actions\/attest@[a-f0-9]{40}/);
  assert.doesNotMatch(prepare, /--clobber|npm publish|release edit/);
});
