# Changelog

## Unreleased

- Retired the local token-based npm wrapper and all compatibility aliases before credential reads, temporary configuration or publisher execution; use the existing isolated OIDC publication workflow.
- Bound Unity project and native alias normalization to the same declared grammar, defaulted omitted project input to POSIX, rejected contradictory/identity-changing alias options, and detached stored registrations from caller mutation.
- Enforced fake scoped-store quotas during construction and every write: 10,000 entries and 8,388,608 UTF-16 key/value units, with atomic replacement accounting.
- Added pre-TLS daemon connection admission, separate pending/total limits, an absolute authentication deadline, unauthorized-connection closure and explicit HTTP/1.1/header limits.
- Recorded source remediation for the four findings in scan `wfr_4da72bce40868cc1fa3c3fc43ea21916e66026b13a324ef22ca7c1ac8c292966` in [the follow-up security review](docs/security-review-2026-10-24-4da72bce.md).

- Defined explicit native POSIX and canonical-input grammars, preserving literal backslashes, POSIX drive-like components, and collision-free relative `./` markers across normalization, equality, relative/join, and host serialization. See [path identity contract](docs/path-identity-contract.md) and [migration guidance](docs/path-identity-migration.md) before changing stored keys.
- Parsed preserved extended drive and UNC roots atomically, retained complete root boundaries during lexical dot cleanup, and accepted preserved drive roots under the `win32-drive` target profile.
- Unified WSL mount-root defaults, validation, and normalization across lexical ports, including `/`, dot segments, literal backslash, and rejection of NUL/relative/UNC configuration. Retained configured Windows policy checks before cleanup and strict raw filesystem validators.
- Added the length-aware C `mount_root_len` field, requiring callers and FFI bindings to rebuild against the updated structure layout, and Godot `from_utf8` plus byte-oriented mount validation before String conversion.
- Made Rust runner checks, unit/documentation tests, and shared vectors mandatory in `pnpm verify`; missing or failed Rust toolchains no longer produce a successful skip.

- Implemented source remediation for the three Low findings in scan `wfr_0fe15518666fc0239ead62d4e2006982029f84e709ee3998ae7d944a3f7c2636`; local verification passed as recorded in `docs/security-review-2026-10-24.md`; the subsequent assessment is covered by `docs/security-review-2026-10-24-4da72bce.md`.
- Made all Go `canonicalfs` entrypoints fail closed on unsupported targets, including `js/wasm`, `plan9` and `wasip1`; added a Node-backed `js/wasm` denial gate to `pnpm verify`.
- Retained the first daemon allowed-root handle and checked configured/resolved aliases against handle-backed identities, with deterministic startup replacement and failure-cleanup regressions.
- Replaced fake Unity scoped-glob regex backtracking with iterative matching and capped list/glob queries at a 10,000-entry scoped store and a shared 4,000,000-unit work budget, independently of response limits.
- Corrected compatibility documentation to the existing Go 1.25 module floor and Go 1.26.10 workspace/CI toolchain.

- Implemented source remediation for the seven findings in scan `wfr_19a78830a145faebf05e2a070963b3e3d82394513b4ee5afe75423949bc46019`; see `docs/security-review-2026-10-22.md` for coverage, migration and the remaining external npm authorization cutover.
- Bound npm retries to original immutable release assets, an attested source/producer manifest and a fresh verified publication job; documented the mandatory `npm-immutable` trusted-publisher cutover.
- Normalized POSIX dot segments before WSL drive mapping and rejected ambiguous host-root registrations.
- Added ZIP path/depth/component/directory/object budgets checked before output creation, plus cancellation checks during directory walks.
- Replaced 48-bit Git-ref suffixes with versioned full SHA-256 identities across ports, strict raw Unicode handling and a read-only ownership-migration inventory.
- Required authenticated HTTPS and out-of-band pins before daemon bearer transmission on every listener, added private per-launch TLS/token bootstrap, and retained response/deadline limits.
- Preserved exact UTF-8 identities in Swift equality, root checks, slicing and vector assertions.
- Moved Bash write payloads from argv/environment to bounded stdin and private request files with deterministic cleanup.
- Selected PowerShell 7/Core for local tools without a Windows PowerShell fallback; kept the historical compatibility lane as explicit CI opt-in.
- Updated verification/release Go pins and the workspace toolchain recommendation to 1.26.10 for GO-2026-6809, retaining the Go 1.25 module language floor.

- Updated Vite to 8.3.4, Vitest to 5.0.5 and Node types to 26.6.5, reconciling their shared lockfile.
- Updated setup-node, artifact upload/download actions and all CodeQL steps to compatible pinned revisions; grouped coupled Dependabot updates to prevent mixed CodeQL versions.
- Added a small CI artifact transfer check for the new upload/download pair, without package publication. Kept Go 1.25 support and the current x/sys dependency; the proposed x/sys 0.49.0 requires Go 1.26.

## 2026.10.10-4

- Fixed both findings from scan `2026-10-10-4`; see `docs/security-review-2026-10-10-4.md`.
- Kept the TypeScript daemon bearer in an ECMAScript private field; JSON and Node diagnostics expose only the client type, and generic enumeration cannot read the token.
- Required Unix token files to belong to the daemon's effective UID, checking descriptor metadata before reading secret bytes; rejected unknown ownership and unsupported ownership platforms.
- Added credential-disclosure regressions and Unix ownership tests, including a privileged daemon rejecting another user's mode-0600 file.

## 2026.10.10-3

- Addressed all eight findings from scan `2026-10-10-3`; see `docs/security-review-2026-10-10-3.md`.
- Required the same minimum 32-character randomly generated bearer for embedded Go RPC servers and CLI startup, and validated Windows token-file DACLs on the opened handle.
- Required Go 1.25+ and pinned the Windows ACL dependency to patched `golang.org/x/sys v0.44.0`, avoiding the known `NewNTUnicodeString` overflow even though this daemon does not call that function.
- Made GDScript `normalize`, `relative` and `join` return tagged dictionaries instead of silently substituting empty identities on errors.
- Rejected malformed UTF-16 in Dart Git refs and Dart/Kotlin URI literals without replacing distinct inputs; added shared exact-code-unit regressions.
- Enforced Unity health/body response caps and non-resettable network deadlines, and reused the bounded PowerShell transport for CMD with a common pre-expansion request ceiling.
- Replaced the raw PowerShell example with the bounded client. Disabled unsafe optional local Unity signed packaging/publication until authentic signature verification exists; standard digest-verified GitHub/npm publication remains available.

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
