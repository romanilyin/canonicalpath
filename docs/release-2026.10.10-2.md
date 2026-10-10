# CanonicalPath / CanonicalFS 2026.10.10-2

One full release covers the source repository, all three npm packages, the Go module and the experimental language targets.

- Source tag and GitHub Release: `2026.10.10-2`.
- Go module tag: `packages/go/v0.2026.10-10.2`.
- npm: `@romanilyin/canonicalpath@2026.10.10-2`, `@romanilyin/canonicalpath-standalone@2026.10.10-2`, `com.romanilyin.canonicalpath@2026.10.10-2`.
- Unity Git UPM: `https://github.com/romanilyin/canonicalpath.git?path=/packages/unity#2026.10.10-2`.

Fixes all three findings in scan `2026-10-10-2`: bounded daemon client responses/deadlines, private PowerShell bearer state, and malformed UTF-16 Git-ref rejection. Details and regression coverage: `security-review-2026-10-10-2.md`.

Migration: PowerShell clients must be constructed through `New-CanonicalFSDaemonClient`; public Token property bags and deserialized clients are rejected. TypeScript/PowerShell/Bash enforce 24 MiB response and 30-second overall network ceilings; options may lower them. Git-ref encoders reject malformed Unicode with `ERR_INVALID_COMPONENT`; valid encodings are unchanged. Bash installations must include `canonicalfs_transport.py` alongside the shell wrapper.

Publish after the remediation PR is merged and the main CI/security/CodeQL checks pass. The published release triggers the existing isolated npm trusted-publishing workflow. Repository/non-Unity licensing stays MIT; Unity stays under Stinger Royalty-Free EULA 1.0.
