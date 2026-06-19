import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scopes = ["unity_asset", "knowledge", "package_manifest", "artifact", "gateway_cache", "temp_session"];
const operations = ["validate", "read", "write", "list", "delete", "import", "refresh", "generated-key"];
const publicRepoUrl = "https://github.com/romanilyin/canonicalpath";
const mitLicense = "MIT";
const stingerLicense = "LicenseRef-Stinger-Royalty-Free-EULA-1.0";
const npmPackageName = "@romanilyin/canonicalpath";
const standalonePackageName = "@romanilyin/canonicalpath-standalone";
const unityPackageName = "com.romanilyin.canonicalpath";
const goModulePath = "github.com/romanilyin/canonicalpath/packages/go";
const releaseVersion = "2026.6.19-1";
const unityReleaseVersion = "2026.6.19-1";
const unityMcpErrors = [
  "ERR_ABSOLUTE_PATH",
  "ERR_DRIVE_RELATIVE_PATH",
  "ERR_EMPTY_PATH",
  "ERR_ENCODED_SEPARATOR",
  "ERR_INVALID_PATH",
  "ERR_NUL_BYTE",
  "ERR_OUTSIDE_ROOT",
  "ERR_UNSUPPORTED_URI_SCHEME",
];

function file(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return readFileSync(file(relativePath), "utf8");
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExists(relativePath) {
  assert(existsSync(file(relativePath)), `${relativePath}: missing file`);
}

function assertIncludes(label, text, needle) {
  assert(text.includes(needle), `${label}: missing ${needle}`);
}

function assertRegex(label, text, pattern) {
  assert(pattern.test(text), `${label}: missing pattern ${pattern}`);
}

function assertExactArray(label, actual, expected) {
  assert(Array.isArray(actual), `${label}: expected array`);
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, got ${actualJson}`);
}

function assertStringSet(label, actual, expected) {
  assert(Array.isArray(actual), `${label}: expected array`);
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  assert(missing.length === 0 && extra.length === 0, `${label}: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`);
}

function assertOneOfOutcome(testCase) {
  const outcomes = ["expectedProjectRelative", "expectedCacheRelative", "error"].filter((key) => Object.hasOwn(testCase, key));
  assert(outcomes.length === 1, `${testCase.id}: expected exactly one scoped vector outcome, got ${outcomes.join(", ")}`);
}

function schemaDef(schema, name) {
  const def = schema.$defs?.[name];
  assert(def && typeof def === "object", `spec/command-descriptors.schema.json: missing $defs.${name}`);
  return def;
}

function checkPackageScripts() {
  const pkg = json("package.json");
  assert(pkg.scripts?.["check:licenses"] === "node scripts/check-package-license-layout.mjs", "package.json: missing scripts.check:licenses");
  const script = pkg.scripts?.["check:unity-mcp-contract"];
  assert(typeof script === "string", "package.json: missing scripts.check:unity-mcp-contract");
  for (const part of ["pnpm spec:validate", "pnpm check:error-taxonomy", "pnpm unity:mcp:path-scopes:vectors", "node scripts/check-unity-mcp-contract.mjs"]) {
    assertIncludes("package.json scripts.check:unity-mcp-contract", script, part);
  }
  const verify = pkg.scripts?.verify ?? "";
  for (const part of ["pnpm check:licenses", "node scripts/check-unity-mcp-contract.mjs", "pnpm ts:build", "pnpm ts:package:smoke", "pnpm ts:pack:dry-run", "pnpm scoped-daemon:smoke"]) {
    assertIncludes("package.json scripts.verify", verify, part);
  }
  assert(pkg.scripts?.["ts:build"] === "pnpm -C packages/ts build", "package.json: missing scripts.ts:build");
  assert(pkg.scripts?.["ts:package:smoke"] === "pnpm -C packages/ts package:smoke", "package.json: missing scripts.ts:package:smoke");
  assert(pkg.scripts?.["ts:pack:dry-run"] === "pnpm -C packages/ts pack:dry-run", "package.json: missing scripts.ts:pack:dry-run");
  assert(pkg.scripts?.["scoped-daemon:smoke"] === "node scripts/run-scoped-daemon-smoke.mjs", "package.json: missing scripts.scoped-daemon:smoke");
}

function checkPublicIdentity() {
  const tsPackage = json("packages/ts/package.json");
  assert(tsPackage.name === npmPackageName, `packages/ts/package.json: expected package name ${npmPackageName}`);
  assert(tsPackage.version === releaseVersion, `packages/ts/package.json: expected version ${releaseVersion}`);
  assert(tsPackage.license === mitLicense, `packages/ts/package.json: expected license ${mitLicense}`);
  assert(!Object.hasOwn(tsPackage, "private"), "packages/ts/package.json: publishable package must not be private for release");
  assert(tsPackage.main === "./dist/canonicalpath/index.js", "packages/ts/package.json: root main must point at dist");
  assert(tsPackage.types === "./dist/canonicalpath/index.d.ts", "packages/ts/package.json: root types must point at dist");
  assertExactArray("packages/ts/package.json files", tsPackage.files, ["dist", "README.md", "LICENSE.md", "NOTICE.md"]);
  assert(tsPackage.scripts?.build === "tsc -p tsconfig.build.json", "packages/ts/package.json: missing build script");
  assert(tsPackage.scripts?.["package:smoke"] === "node test/package-smoke.mjs", "packages/ts/package.json: missing package:smoke script");
  assert(tsPackage.scripts?.prepack === "node ../../scripts/sync-npm-package-notices.mjs copy", "packages/ts/package.json: missing prepack notice sync");
  assert(tsPackage.scripts?.postpack === "node ../../scripts/sync-npm-package-notices.mjs clean", "packages/ts/package.json: missing postpack notice cleanup");
  assert(tsPackage.scripts?.["pack:dry-run"] === "npm pack --dry-run", "packages/ts/package.json: missing pack:dry-run script");

  const unityPackage = json("packages/unity/package.json");
  assert(unityPackage.name === unityPackageName, `packages/unity/package.json: expected package name ${unityPackageName}`);
  assert(unityPackage.version === unityReleaseVersion, `packages/unity/package.json: expected version ${unityReleaseVersion}`);
  assert(unityPackage.license === stingerLicense, `packages/unity/package.json: expected license ${stingerLicense}`);
  assert(unityPackage.licensesUrl === `${publicRepoUrl}/blob/main/packages/unity/LICENSE.md`, "packages/unity/package.json: unexpected licensesUrl");
  assertExactArray("packages/unity/package.json files", unityPackage.files, [
    "Runtime",
    "Runtime.meta",
    "Tests",
    "Tests.meta",
    "README.md",
    "README.md.meta",
    "CHANGELOG.md",
    "CHANGELOG.md.meta",
    "LICENSE.md",
    "LICENSE.md.meta",
    "LICENSE.ru.md",
    "LICENSE.ru.md.meta",
    "NOTICE.md",
    "NOTICE.md.meta",
    "package.json.meta",
  ]);

  const standalonePackage = json("packages/javascript-standalone/package.json");
  assert(standalonePackage.name === standalonePackageName, "packages/javascript-standalone/package.json: unexpected package name");
  assert(standalonePackage.version === releaseVersion, `packages/javascript-standalone/package.json: expected version ${releaseVersion}`);
  assert(standalonePackage.license === mitLicense, `packages/javascript-standalone/package.json: expected license ${mitLicense}`);
  assert(!Object.hasOwn(standalonePackage, "private"), "packages/javascript-standalone/package.json: publishable package must not be private for release");
  assertExactArray("packages/javascript-standalone/package.json files", standalonePackage.files, ["dist", "README.md", "LICENSE.md", "NOTICE.md"]);
  assert(standalonePackage.scripts?.prepack === "node ../../scripts/sync-npm-package-notices.mjs copy", "packages/javascript-standalone/package.json: missing prepack notice sync");
  assert(standalonePackage.scripts?.postpack === "node ../../scripts/sync-npm-package-notices.mjs clean", "packages/javascript-standalone/package.json: missing postpack notice cleanup");

  assertIncludes("packages/go/go.mod", read("packages/go/go.mod"), `module ${goModulePath}`);
  for (const relativePath of ["README.md", "NOTICE.md"]) {
    assertIncludes(relativePath, read(relativePath), publicRepoUrl);
  }

  const unityPackageText = read("packages/unity/package.json");
  assert(!/"license"\s*:\s*"(?:MIT|Apache-2\.0|ISC|BSD-[23]-Clause)"/.test(unityPackageText), "packages/unity/package.json: Unity package must not claim an OSI license");
}

function checkScopeSchema() {
  const schema = json("spec/unity-mcp-path-scopes.schema.json");
  assertExactArray("spec/unity-mcp-path-scopes.schema.json $defs.scopeName.enum", schema.$defs?.scopeName?.enum, scopes);
  assertExactArray("spec/unity-mcp-path-scopes.schema.json allowedOperations enum", schema.$defs?.scope?.properties?.allowedOperations?.items?.enum, operations);
  assertExactArray("spec/unity-mcp-path-scopes.schema.json errorCode enum", schema.$defs?.errorCode?.enum, unityMcpErrors);
  assertStringSet("spec/unity-mcp-path-scopes.schema.json case.required", schema.$defs?.case?.required, ["id", "scope", "operation", "raw"]);
  for (const key of ["absoluteInputAllowed", "llmToolArgsAllowed", "persistedRefsAllowed", "auditRefsAllowed", "artifactRefsAllowed"]) {
    assert(schema.$defs?.scope?.properties?.[key]?.type === "boolean", `spec/unity-mcp-path-scopes.schema.json scope.${key}: must be boolean`);
  }
}

function checkScopeVectors() {
  const vectors = json("spec/testdata/unity_mcp_path_scope_vectors.json");
  assert(vectors.version === 1, "spec/testdata/unity_mcp_path_scope_vectors.json: version must be 1");
  assertExactArray("spec/testdata/unity_mcp_path_scope_vectors.json scopes", Object.keys(vectors.scopes), scopes);
  assert(vectors.cases.length >= 41, "spec/testdata/unity_mcp_path_scope_vectors.json: expected at least 41 scoped vectors");

  const seenByScope = new Map(scopes.map((scope) => [scope, { success: 0, error: 0 }]));
  const ids = new Set();
  for (const testCase of vectors.cases) {
    assert(typeof testCase.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(testCase.id), `${testCase.id ?? "<missing>"}: invalid vector id`);
    assert(!ids.has(testCase.id), `${testCase.id}: duplicate vector id`);
    ids.add(testCase.id);
    assert(scopes.includes(testCase.scope), `${testCase.id}: unsupported scope ${testCase.scope}`);
    assert(vectors.scopes[testCase.scope].allowedOperations.includes(testCase.operation), `${testCase.id}: operation ${testCase.operation} is outside scope policy`);
    assertOneOfOutcome(testCase);
    if (testCase.error) {
      assert(unityMcpErrors.includes(testCase.error), `${testCase.id}: unsupported error ${testCase.error}`);
      seenByScope.get(testCase.scope).error += 1;
    } else {
      seenByScope.get(testCase.scope).success += 1;
    }
  }

  for (const scope of scopes) {
    const seen = seenByScope.get(scope);
    assert(seen.success > 0, `spec/testdata/unity_mcp_path_scope_vectors.json: ${scope} needs at least one success vector`);
  }
  for (const id of [
    "knowledge-reject-project-root-misuse",
    "artifact-reject-prefix-sibling",
    "common-reject-double-encoded-slash",
    "common-reject-double-encoded-backslash",
    "gateway-cache-reject-non-index-prefix",
    "temp-session-reject-traversal",
  ]) {
    assert(ids.has(id), `spec/testdata/unity_mcp_path_scope_vectors.json: missing ${id}`);
  }
}

function checkCommandDescriptorFragments() {
  const schema = json("spec/command-descriptors.schema.json");
  assertExactArray("spec/command-descriptors.schema.json $defs.pathScope.enum", schemaDef(schema, "pathScope").enum, scopes);
  assertExactArray("spec/command-descriptors.schema.json $defs.pathOperation.enum", schemaDef(schema, "pathOperation").enum, operations);

  const scopedPath = schemaDef(schema, "scopedPath");
  assertStringSet("spec/command-descriptors.schema.json $defs.scopedPath.required", scopedPath.required, ["scope", "path"]);
  assert(scopedPath.properties?.scope?.$ref === "#/$defs/pathScope", "spec/command-descriptors.schema.json: scopedPath.scope must reference pathScope");
  assert(scopedPath.properties?.path?.$ref === "#/$defs/scopedRelativePath", "spec/command-descriptors.schema.json: scopedPath.path must reference scopedRelativePath");
  assert(scopedPath.additionalProperties === false, "spec/command-descriptors.schema.json: scopedPath must reject additionalProperties");

  const artifactRef = schemaDef(schema, "artifactRef");
  assertStringSet("spec/command-descriptors.schema.json $defs.artifactRef.required", artifactRef.required, ["scope", "path"]);
  assert(artifactRef.properties?.scope?.const === "artifact", "spec/command-descriptors.schema.json: artifactRef.scope must be const artifact");
  assert(artifactRef.properties?.path?.$ref === "#/$defs/artifactPath", "spec/command-descriptors.schema.json: artifactRef.path must reference artifactPath");

  assertExactArray("spec/command-descriptors.schema.json $defs.packageManifestPath.enum", schemaDef(schema, "packageManifestPath").enum, ["Packages/manifest.json", "Packages/packages-lock.json"]);
  assert(schemaDef(schema, "knowledgePath").allOf?.some((entry) => typeof entry.pattern === "string" && entry.pattern.includes("UnityMcpKnowledgeEvil")), "spec/command-descriptors.schema.json: knowledgePath must reject raw knowledge-root misuse and siblings");
  assert(schemaDef(schema, "boundedReadOptions").properties?.max_chars?.maximum === 1_048_576, "spec/command-descriptors.schema.json: boundedReadOptions max_chars hard cap must be 1 MiB");
  assert(schemaDef(schema, "boundedWriteOptions").properties?.text?.maxLength === 1_048_576, "spec/command-descriptors.schema.json: boundedWriteOptions text hard cap must be 1 MiB");
  assert(schemaDef(schema, "boundedWriteOptions").properties?.max_chars?.maximum === 1_048_576, "spec/command-descriptors.schema.json: boundedWriteOptions max_chars hard cap must be 1 MiB");
  assert(schemaDef(schema, "boundedListOptions").properties?.max_entries?.maximum === 1000, "spec/command-descriptors.schema.json: boundedListOptions max_entries hard cap must be 1000");
  const glob = schemaDef(schema, "boundedGlobPattern");
  assert(glob.maxLength === 512, "spec/command-descriptors.schema.json: boundedGlobPattern maxLength must be 512");
  assert(typeof glob.pattern === "string" && glob.pattern.includes("[?*]"), "spec/command-descriptors.schema.json: boundedGlobPattern must require a wildcard");
}

function checkTypeScriptSurface() {
  const pkg = json("packages/ts/package.json");
  assert(pkg.name === npmPackageName, `packages/ts/package.json: expected package name ${npmPackageName}`);
  assert(pkg.license === mitLicense, `packages/ts/package.json: expected license ${mitLicense}`);
  assert(pkg.exports?.["."]?.import === "./dist/canonicalpath/index.js", "packages/ts/package.json: missing root canonicalpath dist export");
  assert(pkg.exports?.["."]?.types === "./dist/canonicalpath/index.d.ts", "packages/ts/package.json: missing root canonicalpath types export");
  assert(pkg.exports?.["./canonicalpath"]?.import === "./dist/canonicalpath/index.js", "packages/ts/package.json: missing ./canonicalpath dist export");
  assert(pkg.exports?.["./canonicalfs"]?.import === "./dist/canonicalfs/index.js", "packages/ts/package.json: missing ./canonicalfs dist export");
  assert(pkg.exports?.["./unity-gateway"]?.import === "./dist/unity-gateway/index.js", "packages/ts/package.json: missing ./unity-gateway dist export");
  assertExists("packages/ts/tsconfig.build.json");
  assertExists("packages/ts/test/package-smoke.mjs");
  assertIncludes("packages/ts/test/package-smoke.mjs", read("packages/ts/test/package-smoke.mjs"), "@romanilyin/canonicalpath/unity-gateway");

  const index = read("packages/ts/src/unity-gateway/index.ts");
  for (const moduleName of ["./broker.js", "./fake-bridge.js", "./mcp-tools.js", "./path-service.js", "./types.js"]) {
    assertIncludes("packages/ts/src/unity-gateway/index.ts", index, `export * from "${moduleName}"`);
  }

  const pathService = read("packages/ts/src/unity-gateway/path-service.ts");
  for (const scope of scopes) assertIncludes("packages/ts/src/unity-gateway/path-service.ts", pathService, `"${scope}"`);
  for (const symbol of ["export function normalizeScopedPath", "export function normalizeScopedGlobPattern", "export function toScopedCanonicalPath", "export type UnityMcpWorkflowScope"]) {
    assertIncludes("packages/ts/src/unity-gateway/path-service.ts", pathService, symbol);
  }
  for (const rootName of ["Assets/UnityMcpKnowledge", "Library/SGGUnityMcp", "Temp/SGGUnityMcp", "job-artifacts", "screenshots", "index"]) {
    assertIncludes("packages/ts/src/unity-gateway/path-service.ts", pathService, rootName);
  }
  for (const code of unityMcpErrors) assertIncludes("packages/ts/src/unity-gateway/path-service.ts", pathService, code);

  const types = read("packages/ts/src/unity-gateway/types.ts");
  assertIncludes("packages/ts/src/unity-gateway/types.ts", types, "export interface UnityMcpArtifactRef");
  assertIncludes("packages/ts/src/unity-gateway/types.ts", types, "scope: \"artifact\"");
  assertIncludes("packages/ts/src/unity-gateway/types.ts", types, "readScopedText");
  assertIncludes("packages/ts/src/unity-gateway/types.ts", types, "writeScopedText");
  assertIncludes("packages/ts/src/unity-gateway/types.ts", types, "globScoped");

  const tools = read("packages/ts/src/unity-gateway/mcp-tools.ts");
  for (const toolName of ["unity.knowledge.read", "unity.knowledge.write", "unity.knowledge.list", "unity.knowledge.glob", "unity.artifact.read", "unity.artifact.write", "unity.artifact.list", "unity.artifact.glob"]) {
    assertIncludes("packages/ts/src/unity-gateway/mcp-tools.ts", tools, `"${toolName}"`);
  }
  for (const bounded of ["maximum: 1_048_576", "maxLength: 1_048_576", "maximum: 1000", "maxLength: 512"]) {
    assertIncludes("packages/ts/src/unity-gateway/mcp-tools.ts", tools, bounded);
  }
}

function checkUnityPackageSurface() {
  const unityPackage = json("packages/unity/package.json");
  assert(unityPackage.name === unityPackageName, "packages/unity/package.json: package name changed unexpectedly");
  assert(unityPackage.license === stingerLicense, "packages/unity/package.json: package license changed unexpectedly");
  assertExists("packages/unity/Runtime/CanonicalPath.cs");
  assertExists("packages/unity/Runtime/CanonicalPathHttpClient.cs");
  assertExists("packages/unity/Runtime/CanonicalPath.UnityBridge.asmdef");
  const asmdef = json("packages/unity/Runtime/CanonicalPath.UnityBridge.asmdef");
  assert(asmdef.name === "CanonicalPath.UnityBridge", "packages/unity/Runtime/CanonicalPath.UnityBridge.asmdef: unexpected assembly name");
  assert(asmdef.rootNamespace === "CanonicalPath", "packages/unity/Runtime/CanonicalPath.UnityBridge.asmdef: unexpected rootNamespace");

  const canonicalPath = read("packages/unity/Runtime/CanonicalPath.cs");
  assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, "public enum UnityMcpPathScope");
  assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, "public static class ScopedPathGuard");
  assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, "public static ScopedPathResult NormalizeScopedPath");
  assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, "public static CanonicalPathValue ToScopedCanonicalPath");
  for (const member of ["UnityAsset", "Knowledge", "PackageManifest", "Artifact", "GatewayCache", "TempSession"]) {
    assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, member);
  }
  for (const rootName of ["Assets/UnityMcpKnowledge", "Library/SGGUnityMcp", "Temp/SGGUnityMcp", "job-artifacts", "screenshots", "index"]) {
    assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, rootName);
  }
  for (const code of unityMcpErrors) assertIncludes("packages/unity/Runtime/CanonicalPath.cs", canonicalPath, code);

  const httpClient = read("packages/unity/Runtime/CanonicalPathHttpClient.cs");
  for (const method of ["ReadScopedFileAsync", "ReadScopedTextAsync", "WriteScopedFileAsync", "WriteScopedTextAsync", "StatScopedAsync", "MkdirAllScopedAsync", "RemoveScopedAsync"]) {
    assertIncludes("packages/unity/Runtime/CanonicalPathHttpClient.cs", httpClient, method);
  }
  for (const endpoint of ["/v1/scoped/readFile", "/v1/scoped/writeFile", "/v1/scoped/stat", "/v1/scoped/mkdirAll", "/v1/scoped/remove"]) {
    assertIncludes("packages/unity/Runtime/CanonicalPathHttpClient.cs", httpClient, endpoint);
  }
  assertIncludes("packages/unity/Runtime/CanonicalPathHttpClient.cs", httpClient, "The Go daemon exposes CanonicalFS endpoints, not CanonicalPath normalization");

  const editMode = read("packages/unity/Tests/EditMode/CanonicalPathEditModeTests.cs");
  assertIncludes("packages/unity/Tests/EditMode/CanonicalPathEditModeTests.cs", editMode, "ScopedPathGuardMatchesRepresentativeScopeRules");
}

function checkGoSurface() {
  const scoped = read("packages/go/canonicalpath/unity_mcp_scoped.go");
  assertIncludes("packages/go/canonicalpath/unity_mcp_scoped.go", scoped, "func NormalizeUnityMCPScopedPath");
  for (const scope of scopes) assertIncludes("packages/go/canonicalpath/unity_mcp_scoped.go", scoped, `"${scope}"`);
  for (const rootName of ["Assets/UnityMcpKnowledge", "Library/SGGUnityMcp", "Temp/SGGUnityMcp", "job-artifacts", "screenshots", "index"]) {
    assertIncludes("packages/go/canonicalpath/unity_mcp_scoped.go", scoped, rootName);
  }
  for (const code of ["ErrAbsolutePath", "ErrDriveRelativePath", "ErrEmptyPath", "ErrEncodedSeparator", "ErrInvalidPath", "ErrNULByte", "ErrOutsideRoot", "ErrUnsupportedURIScheme"]) {
    assertIncludes("packages/go/canonicalpath/unity_mcp_scoped.go", scoped, code);
  }

  const scopedTest = read("packages/go/canonicalpath/unity_mcp_scoped_test.go");
  assertIncludes("packages/go/canonicalpath/unity_mcp_scoped_test.go", scopedTest, "unity_mcp_path_scope_vectors.json");
  assertIncludes("packages/go/canonicalpath/unity_mcp_scoped_test.go", scopedTest, "NormalizeUnityMCPScopedPath");

  const server = read("packages/go/canonicalfsrpc/server.go");
  for (const endpoint of ["/v1/scoped/readFile", "/v1/scoped/writeFile", "/v1/scoped/stat", "/v1/scoped/mkdirAll", "/v1/scoped/remove"]) {
    assertIncludes("packages/go/canonicalfsrpc/server.go", server, endpoint);
  }
  assertIncludes("packages/go/canonicalfsrpc/server.go", server, "NormalizeUnityMCPScopedPath");
  assertIncludes("packages/go/canonicalfsrpc/server.go", server, "scopedOperationAllowed");
  assertIncludes("packages/go/canonicalfsrpc/server.go", server, "ScopedPathKindProject");
  assertExists("scripts/run-scoped-daemon-smoke.mjs");
  const scopedSmoke = read("scripts/run-scoped-daemon-smoke.mjs");
  for (const endpoint of ["/v1/scoped/readFile", "/v1/scoped/writeFile", "/v1/scoped/stat", "/v1/scoped/mkdirAll", "/v1/scoped/remove"]) {
    assertIncludes("scripts/run-scoped-daemon-smoke.mjs", scopedSmoke, endpoint);
  }
  for (const code of ["ERR_UNAUTHORIZED", "ERR_ROOT_NOT_ALLOWED", "ERR_UNSUPPORTED_OPERATION", "ERR_OUTSIDE_ROOT", "ERR_ENCODED_SEPARATOR", "ERR_INVALID_PATH"]) {
    assertIncludes("scripts/run-scoped-daemon-smoke.mjs", scopedSmoke, code);
  }
}

function checkDocs() {
  const pathContract = read("docs/unity-mcp-path-contract.md");
  for (const phrase of [
    "`CanonicalPath` is lexical-only",
    "is not a sandbox boundary",
    "Go daemon scoped endpoints accept explicit `scope`, `operation`, and scope-relative `path`",
    "Unity managed `ScopedPathGuard` and daemon HTTP helpers are client-side validation/transport conveniences",
    "Artifact references are data references, not host paths",
    "hard cap no higher than 1 MiB",
    "hard cap no higher than 1000 returned entries",
  ]) {
    assertIncludes("docs/unity-mcp-path-contract.md", pathContract, phrase);
  }
  for (const scope of scopes) assertIncludes("docs/unity-mcp-path-contract.md", pathContract, `\`${scope}\``);

  const gateway = read("docs/unity-mcp-gateway.md");
  assertIncludes("docs/unity-mcp-gateway.md", gateway, "Downstream Unity MCP gateways should depend on the public CanonicalPath packages");
  assertIncludes("docs/unity-mcp-gateway.md", gateway, "do not create an independent filesystem security boundary");
  assertIncludes("docs/unity-mcp-gateway.md", gateway, "real bridge must delegate security-sensitive filesystem I/O to the Go daemon scoped endpoints");
  assertIncludes("docs/unity-mcp-gateway.md", gateway, "{ scope: \"artifact\", path }");

  const api = read("docs/api-compatibility.md");
  assertIncludes("docs/api-compatibility.md", api, "Go `canonicalfsrpc` exposes scoped project-root endpoints under `/v1/scoped/*`");
  assertIncludes("docs/api-compatibility.md", api, "Artifact references are scope-relative `{ scope: \"artifact\", path }` values");
  assertIncludes("docs/api-compatibility.md", api, "the Go daemon remains the filesystem security boundary");

  const release = read("docs/release-process.md");
  for (const phrase of [publicRepoUrl, npmPackageName, standalonePackageName, goModulePath, unityPackageName, stingerLicense, "Go `canonicalfs` daemon", "packages/ts/test/package-smoke.mjs", "npm pack --dry-run"]) {
    assertIncludes("docs/release-process.md", release, phrase);
  }
}

function checkRunnerCoverage() {
  const runner = read("scripts/run-unity-mcp-path-scope-vectors.mjs");
  assertIncludes("scripts/run-unity-mcp-path-scope-vectors.mjs", runner, "Unity MCP path scope vectors passed");
  assertIncludes("scripts/run-unity-mcp-path-scope-vectors.mjs", runner, "ScopedPathGuard.NormalizeScopedPath");
  assertIncludes("scripts/run-unity-mcp-path-scope-vectors.mjs", runner, "dotnet not found; skipping Unity MCP scoped path C# vector check");
  for (const scope of scopes) assertIncludes("scripts/run-unity-mcp-path-scope-vectors.mjs", runner, `"${scope}"`);
}

function checkRoadmap() {
  const roadmap = read("Documentation/04_LANGUAGE_ROADMAP.md");
  assertRegex("Documentation/04_LANGUAGE_ROADMAP.md", roadmap, /Stage 10 .*pnpm check:unity-mcp-contract/);
}

checkPackageScripts();
checkPublicIdentity();
checkScopeSchema();
checkScopeVectors();
checkCommandDescriptorFragments();
checkTypeScriptSurface();
checkUnityPackageSurface();
checkGoSurface();
checkDocs();
checkRunnerCoverage();
checkRoadmap();

console.log("Unity MCP contract check passed");
