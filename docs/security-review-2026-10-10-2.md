# Security remediation: 2026-10-10-2

Scan `025f5cbe-0d5e-4d85-8a6d-2f2021d4fb59` reviewed commit `edb5725b2f10d6a589e69f69269aa861fa2c6fff` and reported three medium-severity findings. Release `2026.10.10-2` closes all three.

## Client response resource limits

Finding `csf_0be29f5561190c7db7dc365e`: TypeScript, PowerShell and Bash buffered responses without independent byte ceilings or overall network deadlines.

Each client now imposes a 24 MiB local hard ceiling and 30-second overall network deadline. Options can lower these ceilings but cannot disable or increase them. Bytes are counted before JSON parsing, including chunked bodies, decoded compressed responses, and HTTP error bodies. Oversized responses fail with `ERR_RESPONSE_TOO_LARGE`; timeouts fail with `ERR_DAEMON`. Server-advertised metadata cannot raise the initial safety boundary. Redirects are rejected.

TypeScript passes an AbortSignal to fetch, streams decoded bytes and independently races a deadline, including custom fetch implementations that ignore cancellation. PowerShell uses a sealed managed transport with bounded reads and an overall wait/abort spanning connection, upload, headers and body. Bash uses curl's overall/connect deadlines plus a Python counter on decoded output; its EXIT/signal handlers remove the temporary response file and the helper terminates its curl child on failure or interruption.

Regression tests exercise exact byte boundaries in TypeScript, fixed/chunked/compressed and error responses, stalled headers/bodies, continuously slow bodies and interrupted Bash cleanup. Ordinary Go daemon operation smoke tests remain in the default verification gate.

## PowerShell bearer privacy

Finding `csf_c0a93db06896f13a439cc954`: a public `Token` note property exposed the bearer through ordinary object display and serialization.

`New-CanonicalFSDaemonClient` now returns a sealed managed client with a private readonly bearer. Public properties and ToString contain only non-secret diagnostics. Helpers reject lookalike objects and deserialized property bags. PowerShell 5.1/7 tests verify default/expanded display, JSON, CLIXML, ToString, authenticated requests and invalid client rejection with synthetic credentials.

Migration: recreate clients through the constructor rather than setting a public Token property or restoring serialized clients. Formatting metadata alone is not used as a credential boundary. This protects routine diagnostics, not against code with reflection/debugger access inside the credential-owning process.

## Exact Unicode identity

Finding `csf_dfef16e476d4e68376cf4e35`: distinct unpaired surrogate code units collapsed to identical replacement UTF-8 bytes and Git-ref keys.

TypeScript/standalone JavaScript explicitly validate surrogate pairs. C#/Unity/PowerShell use strict UTF-8 conversion; Kotlin uses a CharsetEncoder configured to report malformed input. All reject malformed Git refs with `ERR_INVALID_COMPONENT`. NUL keeps `ERR_NUL_BYTE`; valid Unicode preserves existing SHA-256 suffixes.

The shared exact-code-unit vectors cover empty input, lone high/low surrogates, reversed/repeated pairs, malformed prefixes/suffixes, NUL, U+FFFD and valid supplementary-plane boundaries. Every affected language gate and the installed Unity EditMode matrix consumes these vectors. Go filesystem authority and lexical identity remain separate.
