# Changelog

## Unreleased

- No unreleased changes; the client security remediation is included in 2026.10.10-2 below.

## 2026.10.10-2

- Fixed all three findings from scan `2026-10-10-2`; see `docs/security-review-2026-10-10-2.md`.
- Enforced local 24 MiB decoded-response ceilings and 30-second overall request deadlines in TypeScript, PowerShell and Bash, including error bodies and compressed/chunked responses.
- Stored PowerShell bearer credentials in a sealed client with private state and safe display/serialization; construct clients with `New-CanonicalFSDaemonClient` instead of property bags.
- Rejected malformed UTF-16 Git-ref strings with `ERR_INVALID_COMPONENT` across TypeScript, standalone JavaScript, C#, Unity, Kotlin and PowerShell while preserving valid Unicode encodings.
- Added shared exact-code-unit vectors and hostile-server regression tests, including interrupted Bash response-file cleanup.

## 2026.10.10-1

- Fixed all seven findings from the 2026-10-10 security review; see `docs/security-review-2026-10-10.md` for controls and regression evidence.
- Confined scoped daemon operations to pinned scope handles and rejected linked file leaves before reads, metadata access, or writes.
- Rejected FIFO/device/socket inputs in high-level Go file and ZIP APIs without blocking on FIFO opens or truncating special files.
- Rejected malformed UTF-8 URI escapes across lexical ports and preserved U+FFFD identity in PowerShell 5.1.
- Prevented TypeScript root removal and root rename after lexical normalization.
- Replaced CMD positional arguments with bounded UTF-8 JSON stdin and a PowerShell transport; migrate scripts using the wrapper README.
- Restricted Unity bridge editor write commands to dry-run until a root-confined executor exists.
- Pinned npm publication to HTTPS npmjs, isolated npm configuration, and validated artifact identity and publish configuration before OIDC is used.

## 2026.10.9-1

- Replaced potentially quadratic JavaScript boundary-trimming regexes with linear scans and removed dynamic CMD strings from Dart runners to address the existing GitHub CodeQL backlog.
- Fixed all 18 findings from the 2026-10-09 repository security review; see `docs/security-review-2026-10-09.md` for controls and regression evidence.
- Bound daemon registration to pre-opened allowed roots, bounded project leases, required TLS for remote listeners, and removed bearer credentials from process arguments and runnable examples.
- Bounded ZIP metadata/decompression and confined extraction to pinned destination and member-parent handles.
- Rejected URI-decoded NUL across lexical ports and fixed Rust Unicode device-name checks.
- Routed Unity text reads through the bounded scoped Go daemon, rejected ADS paths, and discovered the installed Unity editor matrix, including beta and 7000 alpha versions.
- Isolated npm OIDC publication onto a fresh runner, pinned action/tool identities, and hardened local npm/UPM credential handling and cleanup.
- Merged Dependabot patch updates for fast-check 4.10.2, Vite 8.3.2, Vitest 5.0.3, and Node types 26.6.4.

## 2026.6.19-1

- Bumped npm and Unity package metadata to `2026.6.19-1` for the MIT-with-Unity-exception publication.
- Changed the repository default and non-Unity package licensing to MIT.
- Kept the Unity UPM/npm package `com.romanilyin.canonicalpath` under Stinger Royalty-Free EULA 1.0.
- Made npm license/notice prepack synchronization package-aware.
- Added committed Unity license/notice files and `.meta` files for package consumers.
- Prepared Unity npmjs scoped-registry packaging for `com.romanilyin.canonicalpath@2026.6.14-1`.

## 2026.5.18-2

- Added Phase 0 monorepo skeleton.
- Added repository hardening docs, CODEOWNERS ownership, private vulnerability reporting guidance, PR branch naming rules, and a manual release-readiness workflow.
- Prepared npm package metadata and license/notice packaging for future public publication.
- Added Russian localization for contributing and PR branch naming rules.
- Prepared full public release plan for source, npm, Go source, Unity Git UPM package, and experimental language targets.
- Bumped package metadata to `2026.5.18-2` for the release candidate.
- Added release notes draft, CodeQL workflow, public CI triggers, and Unity package metadata URLs for the public release candidate.
