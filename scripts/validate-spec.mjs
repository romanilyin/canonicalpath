import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const specDir = path.join(root, "spec");
const testdataDir = path.join(specDir, "testdata");

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const platforms = new Set(["linux", "macos", "windows", "wsl"]);
const caseOperations = new Set([
  "normalize",
  "relative",
  "join",
  "is-equal",
  "to-win32",
  "to-wsl",
  "to-posix",
  "sanitize-component",
  "encode-component",
  "encode-git-ref",
]);
const unityBridgeOperations = new Set(["normalize-unity-path", "from-unity-asset-path", "to-unity-asset-path", "make-safe-file-name"]);
const unityMcpScopeNames = new Set(["unity_asset", "knowledge", "package_manifest", "artifact", "gateway_cache", "temp_session"]);
const unityMcpScopeOperations = new Set(["validate", "read", "write", "list", "delete", "import", "refresh", "generated-key"]);
const commandDescriptorRequiredFragments = new Set([
  "scopedPath",
  "canonicalRelativePath",
  "artifactRef",
  "packageManifestPath",
  "knowledgePath",
  "boundedReadOptions",
  "boundedWriteOptions",
  "boundedListOptions",
  "boundedGlobPattern",
]);
const fixtureOperations = new Set(["read", "write", "stat", "mkdir", "remove", "rename", "extract"]);
const fixtureErrorModes = new Set(["exact", "reject-only"]);
const hostKinds = new Set(["posix", "win32", "wsl", "vscode-file-uri", "dev-container", "ssh-remote"]);
const targetProfiles = new Set(["portable", "win32-drive", "posix"]);
const componentProfiles = new Set(["portable", "win32", "posix"]);
const canonicalPathErrors = new Set([
  "ERR_ABSOLUTE_PATH",
  "ERR_ALTERNATE_DATA_STREAM",
  "ERR_DRIVE_RELATIVE_PATH",
  "ERR_EMPTY_PATH",
  "ERR_ENCODED_SEPARATOR",
  "ERR_INVALID_COMPONENT",
  "ERR_INVALID_PATH",
  "ERR_INVALID_PERCENT_ENCODING",
  "ERR_INVALID_URI",
  "ERR_NUL_BYTE",
  "ERR_OUTSIDE_ROOT",
  "ERR_RESERVED_DEVICE_NAME",
  "ERR_UNSUPPORTED_URI_SCHEME",
]);
const canonicalFSErrors = new Set([
  "ERR_ABSOLUTE_PATH",
  "ERR_ARCHIVE_TRAVERSAL",
  "ERR_DRIVE_RELATIVE_PATH",
  "ERR_NUL_BYTE",
  "ERR_OUTSIDE_ROOT",
  "ERR_RACE_DETECTED",
  "ERR_READ_LIMIT_EXCEEDED",
  "ERR_SYMLINK_ESCAPE",
]);
const unityMcpPathErrors = new Set([
  "ERR_ABSOLUTE_PATH",
  "ERR_DRIVE_RELATIVE_PATH",
  "ERR_EMPTY_PATH",
  "ERR_ENCODED_SEPARATOR",
  "ERR_INVALID_PATH",
  "ERR_NUL_BYTE",
  "ERR_OUTSIDE_ROOT",
  "ERR_UNSUPPORTED_URI_SCHEME",
]);

const caseKeys = new Set([
  "id",
  "operation",
  "raw",
  "root",
  "target",
  "relative",
  "profile",
  "options",
  "expected",
  "error",
  "notes",
  "platforms",
]);
const unityBridgeCaseKeys = new Set(["id", "operation", "raw", "root", "target", "maxLength", "expected", "error", "notes", "platforms"]);
const unityMcpScopeKeys = new Set([
  "allowedRoots",
  "allowedOperations",
  "relativeInputFormat",
  "maxPathLength",
  "maxComponentLength",
  "separatorPolicy",
  "symlinkReparsePolicy",
  "caseSensitivityExpectation",
  "unicodeNormalizationPolicy",
  "absoluteInputAllowed",
  "llmToolArgsAllowed",
  "persistedRefsAllowed",
  "auditRefsAllowed",
  "artifactRefsAllowed",
]);
const unityMcpCaseKeys = new Set(["id", "scope", "operation", "raw", "expectedProjectRelative", "expectedCacheRelative", "error", "notes", "platforms"]);
const optionsKeys = new Set(["sourceHost", "targetProfile", "wsl", "uri", "windows", "trimOuterWhitespace"]);
const wslKeys = new Set(["enabled", "mountRoot"]);
const uriKeys = new Set(["allowFileUri", "allowVSCodeFileUri", "rejectEncodedSlash"]);
const windowsKeys = new Set(["preserveExtendedLength", "rejectDeviceNames", "rejectADS"]);
const fixtureKeys = new Set(["id", "operation", "path", "target", "expect", "error", "errorMode", "notes", "platforms"]);
const languageTargetKeys = new Set(["id", "language", "status", "surfaces", "securityBoundary", "allocationChecks", "unityVersion", "burst", "notes"]);
const languageStatuses = new Set(["supported", "planned", "blocked"]);
const languageSurfaces = new Set(["canonicalpath", "canonicalfs", "daemon", "http-client", "rpc-client", "unity-managed", "unity-burst"]);
const allocationCheckKeys = new Set(["id", "status", "command", "metric", "notes"]);
const allocationStatuses = new Set(["active", "planned", "blocked"]);

function readJSON(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    assert(allowed.has(key), `${label}: unexpected property ${key}`);
  }
}

function assertString(value, label) {
  assert(typeof value === "string", `${label} must be a string`);
}

function assertBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be a boolean`);
}

function assertEnum(value, allowed, label) {
  assert(allowed.has(value), `${label} has unsupported value ${JSON.stringify(value)}`);
}

function assertStringArray(value, allowed, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  const seen = new Set();
  for (const item of value) {
    assertString(item, `${label} item`);
    if (allowed) assertEnum(item, allowed, `${label} item`);
    assert(!seen.has(item), `${label}: duplicate item ${item}`);
    seen.add(item);
  }
}

function assertRef(value, expected, label) {
  assert(value === expected, `${label}: expected $ref ${expected}`);
}

function assertPatternExamples(pattern, label, accepted, rejected) {
  assertString(pattern, `${label}: pattern`);
  const regex = new RegExp(pattern);
  for (const value of accepted) assert(regex.test(value), `${label}: pattern should accept ${JSON.stringify(value)}`);
  for (const value of rejected) assert(!regex.test(value), `${label}: pattern should reject ${JSON.stringify(value)}`);
}

function assertAllOfPattern(fragment, label, accepted, rejected) {
  assert(Array.isArray(fragment.allOf), `${label}: allOf must be an array`);
  const patternFragment = fragment.allOf.find((item) => isPlainObject(item) && typeof item.pattern === "string");
  assert(patternFragment !== undefined, `${label}: allOf must include a pattern fragment`);
  assertPatternExamples(patternFragment.pattern, label, accepted, rejected);
}

function assertPlatforms(value, label) {
  if (value === undefined) return;
  assert(Array.isArray(value), `${label}: platforms must be an array`);
  const seen = new Set();
  for (const platform of value) {
    assertEnum(platform, platforms, `${label}: platform`);
    assert(!seen.has(platform), `${label}: duplicate platform ${platform}`);
    seen.add(platform);
  }
}

function assertOptions(options, label) {
  if (options === undefined) return;
  assert(isPlainObject(options), `${label}: options must be an object`);
  assertOnlyKeys(options, optionsKeys, `${label}: options`);

  if (options.sourceHost !== undefined) assertEnum(options.sourceHost, hostKinds, `${label}: options.sourceHost`);
  if (options.targetProfile !== undefined) assertEnum(options.targetProfile, targetProfiles, `${label}: options.targetProfile`);
  if (options.trimOuterWhitespace !== undefined) assertBoolean(options.trimOuterWhitespace, `${label}: options.trimOuterWhitespace`);

  if (options.wsl !== undefined) {
    assert(isPlainObject(options.wsl), `${label}: options.wsl must be an object`);
    assertOnlyKeys(options.wsl, wslKeys, `${label}: options.wsl`);
    if (options.wsl.enabled !== undefined) assertBoolean(options.wsl.enabled, `${label}: options.wsl.enabled`);
    if (options.wsl.mountRoot !== undefined) {
      assertString(options.wsl.mountRoot, `${label}: options.wsl.mountRoot`);
      assert(options.wsl.mountRoot.startsWith("/"), `${label}: options.wsl.mountRoot must be absolute POSIX-style`);
    }
  }

  if (options.uri !== undefined) {
    assert(isPlainObject(options.uri), `${label}: options.uri must be an object`);
    assertOnlyKeys(options.uri, uriKeys, `${label}: options.uri`);
    for (const key of Object.keys(options.uri)) assertBoolean(options.uri[key], `${label}: options.uri.${key}`);
  }

  if (options.windows !== undefined) {
    assert(isPlainObject(options.windows), `${label}: options.windows must be an object`);
    assertOnlyKeys(options.windows, windowsKeys, `${label}: options.windows`);
    for (const key of Object.keys(options.windows)) assertBoolean(options.windows[key], `${label}: options.windows.${key}`);
  }
}

function assertCanonicalPath(value, label) {
  assertString(value, label);
  assert(!value.includes("\0"), `${label}: canonical paths must not contain NUL`);
  assert(!value.includes("\\"), `${label}: canonical paths must use / separators`);
  assert(!/^[A-Z]:\//.test(value), `${label}: drive letter must be lowercase`);
  assert(!/^[A-Za-z]:($|[^/])/.test(value), `${label}: drive-relative path is not canonical`);

  if (value === "/" || /^[a-z]:\/$/.test(value)) return;

  let rest = value;
  if (/^[a-z]:\//.test(value)) {
    rest = value.slice(3);
  } else if (value.startsWith("//")) {
    const uncParts = value.slice(2).split("/");
    assert(uncParts[0] && uncParts[1], `${label}: UNC path requires server and share`);
    rest = uncParts.slice(2).join("/");
  } else if (value.startsWith("/")) {
    rest = value.slice(1);
  }

  assert(!value.endsWith("/"), `${label}: trailing slash is allowed only for roots`);
  assert(!rest.split("/").some((part) => part === ""), `${label}: canonical path contains an empty component`);
  assert(!rest.split("/").some((part) => part === "." || part === ".."), `${label}: canonical path must be lexically cleaned`);
}

function isAbsolutePathLike(value) {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function isDriveRelativePathLike(value) {
  return /^[A-Za-z]:($|[^\\/])/.test(value);
}

function assertCanonicalRelativePath(value, label) {
  assertString(value, label);
  assert(value.length > 0, `${label}: relative path must not be empty`);
  assert(!value.includes("\0"), `${label}: relative path must not contain NUL`);
  assert(!value.includes("\\"), `${label}: relative path must use / separators`);
  assert(!isAbsolutePathLike(value), `${label}: relative path must not be absolute`);
  assert(!isDriveRelativePathLike(value), `${label}: relative path must not be drive-relative`);
  if (value === ".") return;
  const parts = value.split("/");
  assert(!parts.some((part) => part === ""), `${label}: relative path contains an empty component`);
  assert(!parts.some((part) => part === "." || part === ".."), `${label}: relative path must be lexically cleaned`);
}

function gitRefSlug(raw) {
  return raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "ref";
}

function gitRefExpected(raw) {
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 12);
  return `${gitRefSlug(raw)}--${hash}`;
}

function validateLanguageTargets(data, label) {
  assert(isPlainObject(data), `${label}: root must be an object`);
  assert(Number.isInteger(data.version) && data.version > 0, `${label}: version must be a positive integer`);
  assert(Array.isArray(data.targets), `${label}: targets must be an array`);

  const targetIds = new Set();
  let allocationCheckCount = 0;
  for (const target of data.targets) {
    assert(isPlainObject(target), `${label}: each target must be an object`);
    assertOnlyKeys(target, languageTargetKeys, `${label}:${target.id ?? "<missing-id>"}`);
    assert(typeof target.id === "string" && idPattern.test(target.id), `${label}: target id must be kebab-case`);
    assertString(target.language, `${label}:${target.id}: language`);
    assertEnum(target.status, languageStatuses, `${label}:${target.id}: status`);
    assertStringArray(target.surfaces, languageSurfaces, `${label}:${target.id}: surfaces`);
    assert(target.surfaces.length > 0, `${label}:${target.id}: at least one surface is required`);
    assertString(target.securityBoundary, `${label}:${target.id}: securityBoundary`);
    if (target.notes !== undefined) assertString(target.notes, `${label}:${target.id}: notes`);

    if (target.id.startsWith("unity-")) {
      assertString(target.unityVersion, `${label}:${target.id}: unityVersion`);
      assertBoolean(target.burst, `${label}:${target.id}: burst`);
    }

    assert(Array.isArray(target.allocationChecks), `${label}:${target.id}: allocationChecks must be an array`);
    assert(target.allocationChecks.length > 0, `${label}:${target.id}: at least one allocation check plan is required`);
    const allocationIds = new Set();
    for (const check of target.allocationChecks) {
      assert(isPlainObject(check), `${label}:${target.id}: each allocation check must be an object`);
      assertOnlyKeys(check, allocationCheckKeys, `${label}:${target.id}:${check.id ?? "<missing-id>"}`);
      assert(typeof check.id === "string" && idPattern.test(check.id), `${label}:${target.id}: allocation check id must be kebab-case`);
      assertEnum(check.status, allocationStatuses, `${label}:${target.id}:${check.id}: status`);
      assertString(check.command, `${label}:${target.id}:${check.id}: command`);
      assertString(check.metric, `${label}:${target.id}:${check.id}: metric`);
      if (check.notes !== undefined) assertString(check.notes, `${label}:${target.id}:${check.id}: notes`);
      assert(!allocationIds.has(check.id), `${label}:${target.id}: duplicate allocation check id ${check.id}`);
      allocationIds.add(check.id);
      allocationCheckCount += 1;
    }

    assert(!targetIds.has(target.id), `${label}: duplicate target id ${target.id}`);
    targetIds.add(target.id);
  }

  return { targetCount: data.targets.length, allocationCheckCount };
}

function isAllowedUnityPath(value) {
  return value === "Assets" || value.startsWith("Assets/") || value === "Packages" || value.startsWith("Packages/");
}

function assertUnityBridgePath(value, label) {
  assertCanonicalRelativePath(value, label);
  assert(isAllowedUnityPath(value), `${label}: Unity bridge path must start with Assets/ or Packages/`);
}

function assertSafeFileName(value, maxLength, label) {
  assertString(value, label);
  assert(value.length > 0, `${label}: safe file name must not be empty`);
  assert(!value.includes("\0"), `${label}: safe file name must not contain NUL`);
  assert(!/[\\/:\t\n\r]/.test(value), `${label}: safe file name contains an unsafe separator or control character`);
  if (maxLength !== undefined) assert(value.length <= maxLength, `${label}: safe file name exceeds maxLength`);
}

function validateUnityBridgeCase(testCase, label, ids) {
  assert(isPlainObject(testCase), `${label}: each case must be an object`);
  assertOnlyKeys(testCase, unityBridgeCaseKeys, `${label}:${testCase.id ?? "<missing-id>"}`);
  assert(typeof testCase.id === "string" && idPattern.test(testCase.id), `${label}: case id must be kebab-case`);
  assertEnum(testCase.operation, unityBridgeOperations, `${label}:${testCase.id}: operation`);
  assertPlatforms(testCase.platforms, `${label}:${testCase.id}`);
  if (testCase.notes !== undefined) assertString(testCase.notes, `${label}:${testCase.id}: notes`);
  if (testCase.maxLength !== undefined) {
    assert(Number.isInteger(testCase.maxLength) && testCase.maxLength > 0, `${label}:${testCase.id}: maxLength must be a positive integer`);
  }

  const resultFields = Number(typeof testCase.expected === "string") + Number(typeof testCase.error === "string");
  assert(resultFields === 1, `${label}:${testCase.id}: exactly one of expected or error is required`);
  if (testCase.error !== undefined) assertEnum(testCase.error, canonicalPathErrors, `${label}:${testCase.id}: error`);

  if (["normalize-unity-path", "from-unity-asset-path", "make-safe-file-name"].includes(testCase.operation)) {
    assertString(testCase.raw, `${label}:${testCase.id}: raw`);
  }
  if (["from-unity-asset-path", "to-unity-asset-path"].includes(testCase.operation)) {
    assertCanonicalPath(testCase.root, `${label}:${testCase.id}: root`);
  }
  if (testCase.operation === "to-unity-asset-path") {
    assertCanonicalPath(testCase.target, `${label}:${testCase.id}: target`);
  }

  if (testCase.expected !== undefined) {
    if (testCase.operation === "normalize-unity-path" || testCase.operation === "to-unity-asset-path") {
      assertUnityBridgePath(testCase.expected, `${label}:${testCase.id}: expected`);
    }
    if (testCase.operation === "from-unity-asset-path") assertCanonicalPath(testCase.expected, `${label}:${testCase.id}: expected`);
    if (testCase.operation === "make-safe-file-name") assertSafeFileName(testCase.expected, testCase.maxLength, `${label}:${testCase.id}: expected`);
  }

  if (testCase.raw?.includes("\0")) assert(testCase.error === "ERR_NUL_BYTE", `${label}:${testCase.id}: NUL input must use ERR_NUL_BYTE`);
  assert(!ids.has(testCase.id), `${label}: duplicate case id ${testCase.id}`);
  ids.add(testCase.id);
}

function assertUnityMcpRelativePath(value, label) {
  assertCanonicalRelativePath(value, label);
  assert(!/%(?:2f|5c)/i.test(value), `${label}: encoded separators are not allowed`);
}

function validateUnityMcpPathScopes(data, label) {
  assert(isPlainObject(data.scopes), `${label}: scopes must be an object`);
  const scopeIds = new Set(Object.keys(data.scopes));
  for (const scopeName of unityMcpScopeNames) assert(scopeIds.has(scopeName), `${label}: missing scope ${scopeName}`);
  assert(scopeIds.size === unityMcpScopeNames.size, `${label}: unexpected scope count`);

  for (const [scopeName, scope] of Object.entries(data.scopes)) {
    assertEnum(scopeName, unityMcpScopeNames, `${label}: scope name`);
    assert(isPlainObject(scope), `${label}:${scopeName}: scope must be an object`);
    assertOnlyKeys(scope, unityMcpScopeKeys, `${label}:${scopeName}`);
    assertStringArray(scope.allowedRoots, undefined, `${label}:${scopeName}: allowedRoots`);
    assert(scope.allowedRoots.length > 0, `${label}:${scopeName}: allowedRoots must not be empty`);
    assertStringArray(scope.allowedOperations, unityMcpScopeOperations, `${label}:${scopeName}: allowedOperations`);
    assert(scope.allowedOperations.length > 0, `${label}:${scopeName}: allowedOperations must not be empty`);
    for (const key of ["relativeInputFormat", "separatorPolicy", "symlinkReparsePolicy", "caseSensitivityExpectation", "unicodeNormalizationPolicy"]) {
      assertString(scope[key], `${label}:${scopeName}: ${key}`);
    }
    assert(scope.separatorPolicy === "forward-slash-only", `${label}:${scopeName}: separatorPolicy must be forward-slash-only`);
    for (const key of ["maxPathLength", "maxComponentLength"]) {
      assert(Number.isInteger(scope[key]) && scope[key] > 0, `${label}:${scopeName}: ${key} must be a positive integer`);
    }
    for (const key of ["absoluteInputAllowed", "llmToolArgsAllowed", "persistedRefsAllowed", "auditRefsAllowed", "artifactRefsAllowed"]) {
      assertBoolean(scope[key], `${label}:${scopeName}: ${key}`);
    }
    assert(scope.absoluteInputAllowed === false, `${label}:${scopeName}: absoluteInputAllowed must be false`);
  }

  assert(Array.isArray(data.cases), `${label}: cases must be an array`);
  const ids = new Set();
  for (const testCase of data.cases) {
    assert(isPlainObject(testCase), `${label}: each case must be an object`);
    assertOnlyKeys(testCase, unityMcpCaseKeys, `${label}:${testCase.id ?? "<missing-id>"}`);
    assert(typeof testCase.id === "string" && idPattern.test(testCase.id), `${label}: case id must be kebab-case`);
    assertEnum(testCase.scope, unityMcpScopeNames, `${label}:${testCase.id}: scope`);
    assertEnum(testCase.operation, unityMcpScopeOperations, `${label}:${testCase.id}: operation`);
    assert(data.scopes[testCase.scope].allowedOperations.includes(testCase.operation), `${label}:${testCase.id}: operation is not allowed by scope`);
    assertString(testCase.raw, `${label}:${testCase.id}: raw`);
    assertPlatforms(testCase.platforms, `${label}:${testCase.id}`);
    if (testCase.notes !== undefined) assertString(testCase.notes, `${label}:${testCase.id}: notes`);

    const resultFields = Number(typeof testCase.expectedProjectRelative === "string") + Number(typeof testCase.expectedCacheRelative === "string") + Number(typeof testCase.error === "string");
    assert(resultFields === 1, `${label}:${testCase.id}: exactly one expectedProjectRelative, expectedCacheRelative, or error is required`);
    if (testCase.expectedProjectRelative !== undefined) assertUnityMcpRelativePath(testCase.expectedProjectRelative, `${label}:${testCase.id}: expectedProjectRelative`);
    if (testCase.expectedCacheRelative !== undefined) assertUnityMcpRelativePath(testCase.expectedCacheRelative, `${label}:${testCase.id}: expectedCacheRelative`);
    if (testCase.error !== undefined) assertEnum(testCase.error, unityMcpPathErrors, `${label}:${testCase.id}: error`);
    if (testCase.raw.includes("\0")) assert(testCase.error === "ERR_NUL_BYTE", `${label}:${testCase.id}: NUL input must use ERR_NUL_BYTE`);
    assert(!ids.has(testCase.id), `${label}: duplicate case id ${testCase.id}`);
    ids.add(testCase.id);
  }

  return { caseCount: data.cases.length, ids };
}

function validateCommandDescriptorFragments(data, label) {
  assert(isPlainObject(data), `${label}: root must be an object`);
  assert(isPlainObject(data.$defs), `${label}: $defs must be an object`);
  for (const fragmentName of commandDescriptorRequiredFragments) assert(data.$defs[fragmentName] !== undefined, `${label}: missing $defs.${fragmentName}`);

  assertStringArray(data.$defs.pathScope.enum, unityMcpScopeNames, `${label}: $defs.pathScope.enum`);
  assertStringArray(data.$defs.pathOperation.enum, unityMcpScopeOperations, `${label}: $defs.pathOperation.enum`);

  assertBoundedOptions(data.$defs.boundedReadOptions, `${label}: $defs.boundedReadOptions`, "max_chars", 1048576, false);
  assertBoundedOptions(data.$defs.boundedWriteOptions, `${label}: $defs.boundedWriteOptions`, "max_chars", 1048576, true);
  assertBoundedOptions(data.$defs.boundedListOptions, `${label}: $defs.boundedListOptions`, "max_entries", 1000, false);
  assertPatternExamples(
    data.$defs.boundedGlobPattern.pattern,
    `${label}: $defs.boundedGlobPattern`,
    ["*.md", "notes/**/*.md", "job-artifacts/run-1/*.json", "screenshots/request-?.png"],
    ["", "agent.md", "/absolute/*.md", "C:/Game/*.md", "notes\\*.md", "notes/../*.md", "notes//*.md", "notes/*.md/", "notes/bad.:*", "notes%2f*.md"]
  );

  const canonicalRelativePath = data.$defs.canonicalRelativePath;
  assert(isPlainObject(canonicalRelativePath), `${label}: $defs.canonicalRelativePath must be an object`);
  assert(canonicalRelativePath.type === "string", `${label}: $defs.canonicalRelativePath.type must be string`);
  assert(canonicalRelativePath.minLength === 1, `${label}: $defs.canonicalRelativePath.minLength must be 1`);
  assertPatternExamples(
    canonicalRelativePath.pattern,
    `${label}: $defs.canonicalRelativePath`,
    ["Assets/Scripts/App.cs", "Packages/manifest.json", "agent-instructions.md"],
    ["", "/absolute/path", "C:/Game/Assets/App.cs", "C:Assets/App.cs", "Assets\\Scripts\\App.cs", "Assets//App.cs", "Assets/./App.cs", "Assets/../App.cs", "Assets/"]
  );

  const scopedRelativePath = data.$defs.scopedRelativePath;
  assert(isPlainObject(scopedRelativePath), `${label}: $defs.scopedRelativePath must be an object`);
  assertRef(scopedRelativePath.allOf?.[0]?.$ref, "#/$defs/canonicalRelativePath", `${label}: $defs.scopedRelativePath.allOf[0]`);
  assertAllOfPattern(
    scopedRelativePath,
    `${label}: $defs.scopedRelativePath`,
    ["Assets/Scripts/App.cs", "job-artifacts/run-1/summary.json"],
    ["Assets/Scripts/App.cs:Zone.Identifier", "Assets/Scripts/App./Main.cs", "Assets/Scripts/App /Main.cs", "Assets%2fScripts/App.cs", "Assets%252fScripts/App.cs"]
  );

  const scopedPath = data.$defs.scopedPath;
  assert(isPlainObject(scopedPath), `${label}: $defs.scopedPath must be an object`);
  assertStringArray(scopedPath.required, new Set(["scope", "path"]), `${label}: $defs.scopedPath.required`);
  assert(scopedPath.required.length === 2, `${label}: $defs.scopedPath.required must include exactly scope and path`);
  assertRef(scopedPath.properties?.scope?.$ref, "#/$defs/pathScope", `${label}: $defs.scopedPath.properties.scope`);
  assertRef(scopedPath.properties?.operation?.$ref, "#/$defs/pathOperation", `${label}: $defs.scopedPath.properties.operation`);
  assertRef(scopedPath.properties?.path?.$ref, "#/$defs/scopedRelativePath", `${label}: $defs.scopedPath.properties.path`);
  assert(scopedPath.additionalProperties === false, `${label}: $defs.scopedPath.additionalProperties must be false`);

  const artifactPath = data.$defs.artifactPath;
  assert(isPlainObject(artifactPath), `${label}: $defs.artifactPath must be an object`);
  assertRef(artifactPath.allOf?.[0]?.$ref, "#/$defs/scopedRelativePath", `${label}: $defs.artifactPath.allOf[0]`);
  assertAllOfPattern(
    artifactPath,
    `${label}: $defs.artifactPath`,
    ["job-artifacts", "job-artifacts/run-1/summary.json", "screenshots/request-1.png"],
    ["job-artifacts-evil/run-1/summary.json", "Library/SGGUnityMcp/job-artifacts/run-1/summary.json"]
  );

  const artifactRef = data.$defs.artifactRef;
  assert(isPlainObject(artifactRef), `${label}: $defs.artifactRef must be an object`);
  assertStringArray(artifactRef.required, new Set(["scope", "path"]), `${label}: $defs.artifactRef.required`);
  assert(artifactRef.required.length === 2, `${label}: $defs.artifactRef.required must include exactly scope and path`);
  assert(artifactRef.properties?.scope?.const === "artifact", `${label}: $defs.artifactRef.properties.scope must be const artifact`);
  assertRef(artifactRef.properties?.path?.$ref, "#/$defs/artifactPath", `${label}: $defs.artifactRef.properties.path`);
  assert(artifactRef.additionalProperties === false, `${label}: $defs.artifactRef.additionalProperties must be false`);

  assertStringArray(data.$defs.packageManifestPath.enum, new Set(["Packages/manifest.json", "Packages/packages-lock.json"]), `${label}: $defs.packageManifestPath.enum`);

  const knowledgePath = data.$defs.knowledgePath;
  assert(isPlainObject(knowledgePath), `${label}: $defs.knowledgePath must be an object`);
  assertRef(knowledgePath.allOf?.[0]?.$ref, "#/$defs/scopedRelativePath", `${label}: $defs.knowledgePath.allOf[0]`);
  assertAllOfPattern(
    knowledgePath,
    `${label}: $defs.knowledgePath`,
    ["agent-instructions.md", "folder/note.md"],
    ["Assets/UnityMcpKnowledge/agent-instructions.md", "Library/note.md", "ProjectSettings/TagManager.asset", "UnityMcpKnowledge/note.md"]
  );

  return { fragmentCount: commandDescriptorRequiredFragments.size };
}

function assertBoundedOptions(fragment, label, limitKey, maximum, requiresText) {
  assert(isPlainObject(fragment), `${label} must be an object`);
  assert(fragment.type === "object", `${label}.type must be object`);
  assert(isPlainObject(fragment.properties), `${label}.properties must be an object`);
  assert(fragment.additionalProperties === false, `${label}.additionalProperties must be false`);
  const limit = fragment.properties[limitKey];
  assert(isPlainObject(limit), `${label}.properties.${limitKey} must be an object`);
  assert(limit.type === "integer", `${label}.properties.${limitKey}.type must be integer`);
  assert(limit.minimum === 1, `${label}.properties.${limitKey}.minimum must be 1`);
  assert(limit.maximum === maximum, `${label}.properties.${limitKey}.maximum must be ${maximum}`);
  if (requiresText) {
    assertStringArray(fragment.required, new Set(["text"]), `${label}.required`);
    assert(fragment.required.length === 1, `${label}.required must include only text`);
    assert(fragment.properties.text?.type === "string", `${label}.properties.text.type must be string`);
    assert(fragment.properties.text?.maxLength === 1048576, `${label}.properties.text.maxLength must be 1048576`);
  }
}

for (const file of ["canonical-path.schema.json", "canonical-fs.schema.json", "language-targets.schema.json", "unity-bridge.schema.json", "unity-mcp-path-scopes.schema.json", "command-descriptors.schema.json"]) {
  readJSON(path.join(specDir, file));
}

const languageTargetStats = validateLanguageTargets(readJSON(path.join(specDir, "language-targets.json")), "spec/language-targets.json");
const commandDescriptorFragmentStats = validateCommandDescriptorFragments(readJSON(path.join(specDir, "command-descriptors.schema.json")), "spec/command-descriptors.schema.json");

const allCaseIds = new Map();
let caseCount = 0;
let fixtureCount = 0;
let unityBridgeCaseCount = 0;
let unityMcpPathScopeCaseCount = 0;

for (const entry of readdirSync(testdataDir).filter((name) => name.endsWith(".json"))) {
  const file = path.join(testdataDir, entry);
  const data = readJSON(file);
  const label = path.relative(root, file);

  assert(Number.isInteger(data.version) && data.version > 0, `${label}: version must be a positive integer`);

  if (Array.isArray(data.cases)) {
    assert(entry !== "fs_fixtures_manifest.json", `${label}: fs fixture manifest must use fixtures, not cases`);
    const ids = new Set();
    if (entry === "unity_bridge_vectors.json") {
      for (const testCase of data.cases) {
        validateUnityBridgeCase(testCase, label, ids);
        assert(!allCaseIds.has(testCase.id), `${label}: duplicate global case id ${testCase.id} first seen in ${allCaseIds.get(testCase.id)}`);
        allCaseIds.set(testCase.id, label);
        unityBridgeCaseCount += 1;
      }
      continue;
    }
    if (entry === "unity_mcp_path_scope_vectors.json") {
      const stats = validateUnityMcpPathScopes(data, label);
      for (const id of stats.ids) {
        assert(!allCaseIds.has(id), `${label}: duplicate global case id ${id} first seen in ${allCaseIds.get(id)}`);
        allCaseIds.set(id, label);
      }
      unityMcpPathScopeCaseCount = stats.caseCount;
      continue;
    }
    for (const testCase of data.cases) {
      assert(isPlainObject(testCase), `${label}: each case must be an object`);
      assertOnlyKeys(testCase, caseKeys, `${label}:${testCase.id ?? "<missing-id>"}`);
      assert(typeof testCase.id === "string" && idPattern.test(testCase.id), `${label}: case id must be kebab-case`);
      assertEnum(testCase.operation, caseOperations, `${label}:${testCase.id}: operation`);
      assertPlatforms(testCase.platforms, `${label}:${testCase.id}`);
      assertOptions(testCase.options, `${label}:${testCase.id}`);
      if (testCase.notes !== undefined) assertString(testCase.notes, `${label}:${testCase.id}: notes`);

      const resultFields = Number(typeof testCase.expected === "string") + Number(typeof testCase.error === "string");
      assert(resultFields === 1, `${label}:${testCase.id}: exactly one of expected or error is required`);
      if (testCase.error !== undefined) assertEnum(testCase.error, canonicalPathErrors, `${label}:${testCase.id}: error`);

      if (["normalize", "to-win32", "to-wsl", "to-posix", "sanitize-component", "encode-component", "encode-git-ref"].includes(testCase.operation)) {
        assertString(testCase.raw, `${label}:${testCase.id}: raw`);
      }
      if (testCase.operation === "relative") {
        assertCanonicalPath(testCase.root, `${label}:${testCase.id}: root`);
        assertCanonicalPath(testCase.target, `${label}:${testCase.id}: target`);
      }
      if (testCase.operation === "is-equal") {
        assertString(testCase.root, `${label}:${testCase.id}: root`);
        assertString(testCase.target, `${label}:${testCase.id}: target`);
      }
      if (testCase.operation === "join") {
        assertCanonicalPath(testCase.root, `${label}:${testCase.id}: root`);
        assertString(testCase.relative, `${label}:${testCase.id}: relative`);
        if (testCase.expected !== undefined) assertCanonicalRelativePath(testCase.relative, `${label}:${testCase.id}: relative`);
      }
      if (["sanitize-component", "encode-component"].includes(testCase.operation)) {
        assertEnum(testCase.profile, componentProfiles, `${label}:${testCase.id}: profile`);
      }

      if (testCase.expected !== undefined) {
        if (["normalize", "join"].includes(testCase.operation)) assertCanonicalPath(testCase.expected, `${label}:${testCase.id}: expected`);
        if (testCase.operation === "relative") assertCanonicalRelativePath(testCase.expected, `${label}:${testCase.id}: expected`);
        if (testCase.operation === "is-equal") assert(["true", "false"].includes(testCase.expected), `${label}:${testCase.id}: expected must be true or false`);
        if (testCase.operation === "encode-git-ref") {
          assert(testCase.expected === gitRefExpected(testCase.raw), `${label}:${testCase.id}: expected must be slug--sha256-12`);
          assertCanonicalRelativePath(testCase.expected, `${label}:${testCase.id}: expected`);
        }
      }

      if (testCase.raw?.includes("\0")) assert(testCase.error === "ERR_NUL_BYTE", `${label}:${testCase.id}: NUL input must use ERR_NUL_BYTE`);
      if (testCase.operation === "is-equal" && (testCase.root?.includes("\0") || testCase.target?.includes("\0"))) {
        assert(testCase.error === "ERR_NUL_BYTE", `${label}:${testCase.id}: NUL input must use ERR_NUL_BYTE`);
      }
      assert(!ids.has(testCase.id), `${label}: duplicate case id ${testCase.id}`);
      ids.add(testCase.id);
      assert(!allCaseIds.has(testCase.id), `${label}: duplicate global case id ${testCase.id} first seen in ${allCaseIds.get(testCase.id)}`);
      allCaseIds.set(testCase.id, label);
      caseCount += 1;
    }
    continue;
  }

  if (Array.isArray(data.fixtures)) {
    assert(entry === "fs_fixtures_manifest.json", `${label}: only fs_fixtures_manifest.json may use fixtures`);
    const ids = new Set();
    for (const fixture of data.fixtures) {
      assert(isPlainObject(fixture), `${label}: each fixture must be an object`);
      assertOnlyKeys(fixture, fixtureKeys, `${label}:${fixture.id ?? "<missing-id>"}`);
      assert(typeof fixture.id === "string" && idPattern.test(fixture.id), `${label}: fixture id must be kebab-case`);
      assertEnum(fixture.operation, fixtureOperations, `${label}:${fixture.id}: operation`);
      assertString(fixture.path, `${label}:${fixture.id}: path`);
      assert(fixture.expect === "allow" || fixture.expect === "reject", `${label}:${fixture.id}: expect must be allow or reject`);
      assertPlatforms(fixture.platforms, `${label}:${fixture.id}`);
      if (fixture.notes !== undefined) assertString(fixture.notes, `${label}:${fixture.id}: notes`);
      if (["rename", "extract"].includes(fixture.operation)) assertString(fixture.target, `${label}:${fixture.id}: target`);
      if (fixture.expect === "reject") {
        assertEnum(fixture.error, canonicalFSErrors, `${label}:${fixture.id}: error`);
        if (fixture.errorMode !== undefined) assertEnum(fixture.errorMode, fixtureErrorModes, `${label}:${fixture.id}: errorMode`);
      } else {
        assert(fixture.error === undefined, `${label}:${fixture.id}: allowed fixtures must not declare error`);
        assert(fixture.errorMode === undefined, `${label}:${fixture.id}: allowed fixtures must not declare errorMode`);
        assert(!isAbsolutePathLike(fixture.path), `${label}:${fixture.id}: allowed fixture paths must be relative`);
        assert(!fixture.path.includes("\0"), `${label}:${fixture.id}: allowed fixture paths must not contain NUL`);
      }
      if (fixture.path.includes("\0")) assert(fixture.error === "ERR_NUL_BYTE", `${label}:${fixture.id}: NUL fixture must use ERR_NUL_BYTE`);
      if (isAbsolutePathLike(fixture.path)) assert(fixture.error === "ERR_ABSOLUTE_PATH", `${label}:${fixture.id}: absolute fixture path must use ERR_ABSOLUTE_PATH`);
      if (isDriveRelativePathLike(fixture.path)) assert(fixture.error === "ERR_DRIVE_RELATIVE_PATH", `${label}:${fixture.id}: drive-relative fixture path must use ERR_DRIVE_RELATIVE_PATH`);
      if (typeof fixture.target === "string" && isDriveRelativePathLike(fixture.target)) {
        assert(fixture.error === "ERR_DRIVE_RELATIVE_PATH", `${label}:${fixture.id}: drive-relative fixture target must use ERR_DRIVE_RELATIVE_PATH`);
      }
      assert(!ids.has(fixture.id), `${label}: duplicate fixture id ${fixture.id}`);
      ids.add(fixture.id);
      fixtureCount += 1;
    }
    continue;
  }

  throw new Error(`${label}: cases or fixtures array is required`);
}

console.log(
  `spec validation passed (${caseCount} canonicalpath cases, ${unityBridgeCaseCount} unity bridge cases, ${unityMcpPathScopeCaseCount} unity MCP path scope cases, ${fixtureCount} canonicalfs fixtures, ${languageTargetStats.targetCount} language targets, ${languageTargetStats.allocationCheckCount} allocation check plans, ${commandDescriptorFragmentStats.fragmentCount} command descriptor fragments)`,
);
