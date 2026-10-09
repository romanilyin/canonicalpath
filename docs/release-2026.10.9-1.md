# CanonicalPath / CanonicalFS 2026.10.9-1

One full release covers the repository, TypeScript npm package, standalone JavaScript npm package, Go module/daemon, Unity UPM/npm package, and experimental lexical/client targets.

- Source tag and GitHub Release: `2026.10.9-1`.
- Go module tag: `packages/go/v0.2026.10-9.1`.
- npm coordinates: `@romanilyin/canonicalpath@2026.10.9-1`, `@romanilyin/canonicalpath-standalone@2026.10.9-1`, and `com.romanilyin.canonicalpath@2026.10.9-1`.
- License model remains MIT for repository/non-Unity packages and Stinger Royalty-Free EULA 1.0 for Unity.

The security review remediation and verification matrix are recorded in `security-review-2026-10-09.md`. Remote daemon listeners now require TLS; bearer tokens move from argv to private files or environment variables; Unity bridge text reads require an injected registered daemon client. ZIP64, embedded-prefix ZIPs, and existing destination-file overwrites are refused by the bounded ZIP extraction API. Update hosts that relied on those older behaviors before adopting this release.

Publish the single full GitHub Release after the security PR and all Dependabot updates are merged and checks pass. The npm workflow builds without OIDC and publishes checked artifacts from a fresh runner. Do not create a separate Unity release for this batch.
