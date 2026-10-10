# CanonicalPath / CanonicalFS 2026.10.10-3

One full release covers the source repository, all three npm packages, the Go module and the experimental language targets.

- Source tag and GitHub Release: `2026.10.10-3`.
- Go module tag: `packages/go/v0.2026.10-10.3`.
- npm: `@romanilyin/canonicalpath@2026.10.10-3`, `@romanilyin/canonicalpath-standalone@2026.10.10-3`, `com.romanilyin.canonicalpath@2026.10.10-3`.
- Unity Git UPM: `https://github.com/romanilyin/canonicalpath.git?path=/packages/unity#2026.10.10-3`.

Addresses all eight findings in scan `2026-10-10-3`. Details and regression coverage: `security-review-2026-10-10-3.md`.

Migration: Go now requires 1.25+ for the patched Windows ACL dependency. GDScript `normalize`, `relative`, and `join` return tagged dictionaries; check `ok` before using `value`. Embedded Go RPC requires CSPRNG-generated bearer tokens of at least 32 bytes; Windows token files require private DACLs. CMD installations need the sibling PowerShell `DaemonClient.cs`. Unity/CMD enforce 30-second total deadlines and 24 MiB decoded-response caps, with options to lower them. Dart Git refs and Dart/Kotlin URI literals reject malformed UTF-16. Optional local Unity signed packaging/publication is disabled until authentic signature verification exists; standard GitHub/npm publication remains available and digest-verified.

Publish only after main CI/security/CodeQL pass. Both source and Go tags identify the same merged commit. The release triggers the isolated npm trusted-publishing workflow for all three packages. Repository/non-Unity licensing stays MIT; Unity stays under Stinger Royalty-Free EULA 1.0.
