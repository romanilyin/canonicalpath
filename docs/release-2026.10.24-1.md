# CanonicalPath / CanonicalFS 2026.10.24-1

This full source release combines path identity contract corrections and security remediation since `2026.10.10-4`.

## Coordinates and scope

- Source tag and non-prerelease GitHub Release: `2026.10.24-1`.
- Go module tag: `packages/go/v0.2026.10-24.1`.
- npm: `@romanilyin/canonicalpath@2026.10.24-1`, `@romanilyin/canonicalpath-standalone@2026.10.24-1` and `com.romanilyin.canonicalpath@2026.10.24-1`.
- Unity Git UPM: `https://github.com/romanilyin/canonicalpath.git?path=/packages/unity#2026.10.24-1`.
- PowerShell source module version: `2026.10.24.1`.

The source and Go tags must identify the same merged commit. Experimental lexical/client-only targets are included as source at that tag; this release does not publish them to additional language registries. Repository and non-Unity licensing remains MIT; Unity remains under Stinger Royalty-Free EULA 1.0.

## Changes

Native POSIX input now uses slash-only grammar and preserves literal backslashes, drive-like components and required relative `./` markers. Already canonical strings have an explicit input mode. Preserved extended drive/UNC roots retain their complete root boundary, and WSL mount-root defaults, validation and mapping agree across lexical ports. Shared vectors exercise normalization, exact relative/join results and supported host round trips. Rust runner checks, unit/documentation tests and shared vectors are mandatory verification gates.

Security changes include authenticated and pinned daemon HTTPS on every listener, retained allowed-root handles, denial on unsupported Go filesystem platforms, ZIP path/object budgets, full SHA-256 Git-ref identities, exact Swift UTF-8 comparisons, bounded Bash stdin payloads, and native Unity alias validation. Fake scoped storage and query work have aggregate limits. The daemon bounds sockets before TLS, limits pending sockets separately from total connections, and enforces an absolute authentication deadline.

Source remediation and regression evidence for the 14 findings across the three assessments are recorded in the [first security review](security-review-2026-10-22.md), [second review](security-review-2026-10-24.md), and [follow-up review](security-review-2026-10-24-4da72bce.md). Those records describe the original scan provenance and verification limits; this release note does not assert a new clean cloud scan.

## Upgrade requirements

- Review persisted keys using the [path identity migration guide](path-identity-migration.md). Recompute from original input and verified source context, retain ambiguity for review, and preserve canonical markers and Unicode bytes. Do not blindly renormalize saved keys or replace backslashes globally.
- Migrate Git-ref directory identities with the [v2 ownership procedure](../Documentation/IDENTITY_V2_MIGRATION.md). Do not reuse a legacy directory merely because its old name matches.
- Configure every daemon client for authenticated HTTPS and a trusted certificate/public-key pin, including loopback. Create a fresh private [TLS bootstrap bundle](daemon-tls-bootstrap.md) for each launch. Bash `write-text` now receives its payload through stdin.
- Rebuild C libraries, callers and FFI bindings together: `mount_root_len` changes the options structure layout. In Godot, validate byte input with `from_utf8` before String conversion and pass byte-oriented mount input without lossy conversion. Details are in the path identity migration guide.
- Register native Unity aliases with matching `hostKind` and input grammar; WSL aliases require enabled mapping, and retained native roots reject outer-whitespace trimming. Omitted project grammar defaults to POSIX; use explicit canonical mode for stored canonical roots.
- Allow for daemon defaults of 256 total sockets, 32 pending sockets, a 5-second authentication deadline and HTTP/1.1 with a 16 KiB header setting. Embedded servers need the bounded listener and connection-context integration described in the TLS guide. Fake scoped storage allows at most 10,000 entries and 8,388,608 UTF-16 key/value units.
- Keep a supported patched Go toolchain. The module language floor remains Go 1.25, while the workspace and release workflows use Go 1.26.10. Local tooling uses PowerShell 7/Core.

CanonicalPath remains a lexical identity layer. Security-sensitive filesystem I/O belongs to Go CanonicalFS and its root-bound operations; TypeScript, Unity and other clients do not create an independent filesystem security boundary.

## Release validation and publication

Apply the [release gates and trust policy](release-process.md) to the exact merged release commit: local verification and Go race tests, license/changelog checks, all three package dry-runs, and passing main CI, security and CodeQL checks. Preserve the original package artifacts and producer evidence.

The preparation workflow must create a new source release draft from that exact `main` commit; do not pre-create its tag or reuse an earlier draft. After preparation succeeds, review the manifest and its three package archives, publish the completed immutable non-prerelease release, and use the isolated `npm-immutable` OIDC publisher. The npm trusted-publisher cutover and repository protections described in the release process are prerequisites. Local token-based publication is disabled, and provenance failures must not be bypassed with local credentials or rebuilt archives.
