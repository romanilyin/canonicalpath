import { pathToFileURL } from "node:url";

// Fail closed until a supported Unity verifier can authenticate the signer and
// bind the signed manifest to every package byte. A .p7m filename is no proof.
export function packUnitySigned() {
  throw new Error("Local Unity-signed packaging is disabled: authenticated signature verification is unavailable. Use the digest-verified GitHub release workflow.");
}

export function verifySignedTarball() {
  throw new Error("Unity signature verification is unavailable; no archive is accepted or decompressed.");
}

// Retained for callers testing credential isolation; disabled helpers never
// load .env, start UPM, inspect an archive, or launch an npm publisher.
export function signingEnvironment(envValues = {}, source = process.env) {
  const env = {};
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "LANG", "LC_ALL"]);
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key.toUpperCase())) env[key] = value;
  }
  for (const key of ["UPM_ORGANIZATION_ID", "UPM_SERVICE_ACCOUNT_KEY_ID", "UPM_SERVICE_ACCOUNT_KEY_SECRET"]) env[key] = source[key] || envValues[key];
  return env;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { packUnitySigned(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
