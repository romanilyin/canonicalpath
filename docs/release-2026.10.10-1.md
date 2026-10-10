# CanonicalPath / CanonicalFS 2026.10.10-1

One full release covers the source repository, TypeScript and standalone JavaScript npm packages, Go module/daemon, Unity UPM/npm package, and experimental lexical/client targets.

- Source tag and GitHub Release: `2026.10.10-1`.
- Go module tag: `packages/go/v0.2026.10-10.1`.
- npm coordinates: `@romanilyin/canonicalpath@2026.10.10-1`, `@romanilyin/canonicalpath-standalone@2026.10.10-1`, and `com.romanilyin.canonicalpath@2026.10.10-1`.
- License model remains MIT for repository/non-Unity packages and Stinger Royalty-Free EULA 1.0 for Unity.

The seven follow-up security findings and their regression coverage are recorded in `security-review-2026-10-10.md`.

Migration: CMD shims accept a UTF-8 JSON request on stdin; positional arguments are no longer processed. Use redirected request files or the PowerShell entry point. Unity bridge editor write commands are dry-run only and throw on `dryRun: false`. Go high-level file read/write and archive input APIs accept regular files only; low-level `Open`/`OpenFile` remain explicit filesystem primitives. TypeScript refuses removal or rename of paths that normalize to its root. Malformed UTF-8 URI escapes are rejected instead of producing invalid or replacement bytes.

Publish one full GitHub Release after the remediation PR is merged and main checks pass. Build artifacts without OIDC, then verify identity, digests and npm publish configuration on the isolated publisher runner before publishing all three packages. Do not create a separate Unity release for this batch.
