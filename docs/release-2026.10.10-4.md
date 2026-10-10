# CanonicalPath / CanonicalFS 2026.10.10-4

One full release covers the source repository, all three npm packages, the Go module and the experimental language targets.

- Source tag and GitHub Release: `2026.10.10-4`.
- Go module tag: `packages/go/v0.2026.10-10.4`.
- npm: `@romanilyin/canonicalpath@2026.10.10-4`, `@romanilyin/canonicalpath-standalone@2026.10.10-4`, `com.romanilyin.canonicalpath@2026.10.10-4`.
- Unity Git UPM: `https://github.com/romanilyin/canonicalpath.git?path=/packages/unity#2026.10.10-4`.

Fixes both findings in scan `2026-10-10-4`: TypeScript client bearer exposure through ordinary object diagnostics and Unix token-file validation without an owner check. Details and regression coverage: `security-review-2026-10-10-4.md`.

Migration: Unix token files must be owned by the daemon's effective UID and have owner-only permissions. Windows DACL requirements remain in effect. Rotate tokens if previous clients entered logs or a deployment used attacker-controlled token files. TypeScript request APIs are unchanged; JSON and Node diagnostics expose only the client type. Go continues to require 1.25+. Unity retains the transport, signature-publication restrictions and GDScript migration described in 2026.10.10-3.

Publish only after main CI/security/CodeQL pass. Source and Go tags must identify the same merged commit. The release triggers isolated npm trusted publication of all three packages after built artifact validation. Repository/non-Unity licensing stays MIT; Unity stays under Stinger Royalty-Free EULA 1.0.
