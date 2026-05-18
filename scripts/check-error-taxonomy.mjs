import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const taxonomy = {
  canonicalPath: [
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
  ],
  canonicalFsCore: [
    "ERR_ABSOLUTE_PATH",
    "ERR_ARCHIVE_TRAVERSAL",
    "ERR_DRIVE_RELATIVE_PATH",
    "ERR_NUL_BYTE",
    "ERR_OUTSIDE_ROOT",
    "ERR_RACE_DETECTED",
    "ERR_READ_LIMIT_EXCEEDED",
    "ERR_SYMLINK_ESCAPE",
  ],
  canonicalFsTransport: [
    "ERR_DAEMON",
    "ERR_REQUEST_TOO_LARGE",
    "ERR_RESPONSE_TOO_LARGE",
    "ERR_ROOT_NOT_ALLOWED",
    "ERR_UNAUTHORIZED",
    "ERR_UNSUPPORTED_OPERATION",
  ],
  unityBridge: ["ERR_ABSOLUTE_PATH", "ERR_EMPTY_PATH", "ERR_INVALID_COMPONENT", "ERR_INVALID_PATH", "ERR_NUL_BYTE", "ERR_OUTSIDE_ROOT"],
  unityMcpPath: [
    "ERR_ABSOLUTE_PATH",
    "ERR_DRIVE_RELATIVE_PATH",
    "ERR_EMPTY_PATH",
    "ERR_ENCODED_SEPARATOR",
    "ERR_INVALID_PATH",
    "ERR_NUL_BYTE",
    "ERR_OUTSIDE_ROOT",
    "ERR_UNSUPPORTED_URI_SCHEME",
  ],
  clientLocal: ["ERR_DAEMON_CLIENT"],
};

const canonicalFsAll = [...taxonomy.canonicalFsCore, ...taxonomy.canonicalFsTransport];
const documentedCodes = [...taxonomy.canonicalPath, ...canonicalFsAll, ...taxonomy.clientLocal];

function file(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return readFileSync(file(relativePath), "utf8");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function errorLiteralsInText(text) {
  return uniqueSorted(text.match(/\bERR_[A-Z_]+\b/g) ?? []);
}

function errorLiterals(relativePath) {
  return errorLiteralsInText(read(relativePath));
}

function schemaErrorEnum(relativePath) {
  const schema = JSON.parse(read(relativePath));
  return uniqueSorted(schema.$defs.errorCode.enum);
}

function validatorErrorSet(name) {
  const source = read("scripts/validate-spec.mjs");
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!match) throw new Error(`scripts/validate-spec.mjs: missing ${name}`);
  return errorLiteralsInText(match[1]);
}

function goErrorCodeConstants(relativePath) {
  const matches = read(relativePath).matchAll(/\b[A-Za-z]\w*\s+ErrorCode\s*=\s*"(ERR_[A-Z_]+)"/g);
  return uniqueSorted([...matches].map((match) => match[1]));
}

function assertSet(label, actual, expected) {
  const actualSorted = uniqueSorted(actual);
  const expectedSorted = uniqueSorted(expected);
  const missing = expectedSorted.filter((code) => !actualSorted.includes(code));
  const extra = actualSorted.filter((code) => !expectedSorted.includes(code));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${label}: taxonomy mismatch${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""}${extra.length > 0 ? `; extra ${extra.join(", ")}` : ""}`);
  }
}

function assertSubset(label, actual, allowed) {
  const allowedSorted = uniqueSorted(allowed);
  const extra = uniqueSorted(actual).filter((code) => !allowedSorted.includes(code));
  if (extra.length > 0) throw new Error(`${label}: unsupported error codes ${extra.join(", ")}`);
}

function assertIncludes(label, actual, required) {
  const actualSorted = uniqueSorted(actual);
  const missing = uniqueSorted(required).filter((code) => !actualSorted.includes(code));
  if (missing.length > 0) throw new Error(`${label}: missing error codes ${missing.join(", ")}`);
}

assertSet("spec/canonical-path.schema.json", schemaErrorEnum("spec/canonical-path.schema.json"), taxonomy.canonicalPath);
assertSet("spec/canonical-fs.schema.json", schemaErrorEnum("spec/canonical-fs.schema.json"), taxonomy.canonicalFsCore);
assertSet("spec/unity-bridge.schema.json", schemaErrorEnum("spec/unity-bridge.schema.json"), taxonomy.unityBridge);
assertSet("spec/unity-mcp-path-scopes.schema.json", schemaErrorEnum("spec/unity-mcp-path-scopes.schema.json"), taxonomy.unityMcpPath);

assertSet("scripts/validate-spec.mjs canonicalPathErrors", validatorErrorSet("canonicalPathErrors"), taxonomy.canonicalPath);
assertSet("scripts/validate-spec.mjs canonicalFSErrors", validatorErrorSet("canonicalFSErrors"), taxonomy.canonicalFsCore);
assertSet("scripts/validate-spec.mjs unityMcpPathErrors", validatorErrorSet("unityMcpPathErrors"), taxonomy.unityMcpPath);

assertSet("Go canonicalpath ErrorCode constants", goErrorCodeConstants("packages/go/canonicalpath/errors.go"), taxonomy.canonicalPath);
assertSet("Go canonicalfs ErrorCode constants", goErrorCodeConstants("packages/go/canonicalfs/errors.go"), taxonomy.canonicalFsCore);
assertSet("TS canonicalpath ErrorCode union", errorLiterals("packages/ts/src/canonicalpath/errors.ts"), taxonomy.canonicalPath);
assertSet("TS canonicalfs ErrorCode union", errorLiterals("packages/ts/src/canonicalfs/errors.ts"), canonicalFsAll);

assertSubset("Go canonicalfsrpc server literals", errorLiterals("packages/go/canonicalfsrpc/server.go"), canonicalFsAll);
assertSubset("TS canonicalfs HTTP literals", errorLiterals("packages/ts/src/canonicalfs/http.ts"), canonicalFsAll);
assertIncludes("TS canonicalfs HTTP mapped literals", errorLiterals("packages/ts/src/canonicalfs/http.ts"), canonicalFsAll);
assertSubset("Unity CanonicalPath literals", errorLiterals("packages/unity/Runtime/CanonicalPath.cs"), [...taxonomy.canonicalPath, ...taxonomy.unityMcpPath]);
assertSubset("Unity daemon HTTP literals", errorLiterals("packages/unity/Runtime/CanonicalPathHttpClient.cs"), canonicalFsAll);
assertSubset("PowerShell literals", errorLiterals("packages/powershell/CanonicalPath/CanonicalPath.psm1"), [
  ...taxonomy.canonicalPath,
  ...canonicalFsAll,
  ...taxonomy.clientLocal,
]);

const docs = read("docs/api-compatibility.md");
for (const code of uniqueSorted(documentedCodes)) {
  if (!docs.includes(code)) throw new Error(`docs/api-compatibility.md: missing ${code}`);
}

console.log(
  `error taxonomy check passed (${taxonomy.canonicalPath.length} canonicalpath, ${taxonomy.canonicalFsCore.length} canonicalfs core, ${taxonomy.canonicalFsTransport.length} daemon transport, ${taxonomy.clientLocal.length} client-local codes)`,
);
