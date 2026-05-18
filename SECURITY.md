# Security Policy

`canonicalfs` is the security-sensitive package in this repository. Do not treat `canonicalpath` lexical normalization as a filesystem sandbox.

## Reporting Vulnerabilities

Report suspected vulnerabilities privately. Do not open a public issue or discussion with exploit details, traversal payloads, symlink-race steps, bearer tokens, or private project paths.

Use GitHub private vulnerability reporting or a private GitHub security advisory for `romanilyin/canonicalpath` when available. If that route is unavailable while the repository is private, contact the repository owner `@romanilyin` privately and include enough detail to reproduce the issue.

Please include:

- Affected package or surface: `canonicalfs`, daemon transport, archive extraction, `canonicalpath`, TypeScript helper, PowerShell client, Unity bridge, or workflow/release automation.
- Minimal reproduction steps and relevant platform details.
- Expected impact: path traversal, symlink escape, archive extraction escape, authorization bypass, token exposure, identity collision, or denial of service.
- Whether the issue is already public.

Expected response targets:

- Initial acknowledgement within 7 days.
- Triage update within 14 days after acknowledgement when the report is reproducible.
- Coordinated disclosure timing agreed per issue severity and fix availability.

## Current Guarantees

- Go `canonicalfs` uses Go `os.Root` for root-bound filesystem access.
- File operations validate relative paths before I/O and reject absolute paths, NUL, and lexical `..` escapes.
- ZIP extraction opens output files through `canonicalfs.Root` and rejects archive member paths that escape the destination.
- Symlink escape and symlink-swap race attempts are covered by Go filesystem tests.

## Non-Guarantees

- `canonicalpath` only provides deterministic lexical identity and serialization.
- TypeScript `canonicalfs` is best-effort/RPC-helper code and is not TOCTOU-proof.
- PowerShell 5.1 and PowerShell 7 lexical/client support goes through the Go daemon for security-sensitive filesystem I/O and is not a separate filesystem security layer.
- Go `canonicalfs.Rename` is unsupported on Go versions before `1.26`; do not replace it with string joining plus `os.Rename`.

## Scope

Security reports are especially relevant for traversal, symlink escape, symlink-swap race, archive extraction, daemon authorization, path aliasing, identity collision, workflow supply-chain, and package release issues.

`canonicalpath` lexical-only behavior bugs are security issues only when they can cause an identity collision, policy bypass, or unsafe handoff into filesystem access. Real filesystem access must stay behind Go `canonicalfs` or another explicitly reviewed root-bound implementation.
