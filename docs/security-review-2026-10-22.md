# Security remediation — 2026-10-22

Source scan: `wfr_19a78830a145faebf05e2a070963b3e3d82394513b4ee5afe75423949bc46019`, repository `romanilyin/canonicalpath`, source commit `8bbbabf01f59413253db0190f937cdd6fe526887`.

The retrieved artifacts describe seven unique findings: five Medium and two Low. The original run is marked `completed`, with an output-validation warning and no successful output validation recorded. This change implements the source-level remediation and regression checks; it does not claim a clean follow-up cloud scan. F01 also requires an external npm/GitHub authorization cutover before operational closure.

## Finding-to-control mapping

| ID | Scan finding | Source remediation | Verification |
|---|---|---|---|
| F01 | `csf_961f6a4e5f5f5c71b9f9458a` | Original immutable assets, signed manifest binding repository/release/source/producer, provenance verification, fresh isolated publisher, no retry rebuild, guarded partial retry/latest | `release-manifest.test.mjs`; fixture tests do not replace live settings/provenance verification |
| F02 | `csf_4613e2c9e81790835273aaf1` | POSIX dot cleanup before explicit WSL drive mapping in every lexical port; reject ambiguous/raw dot-segment host roots at broker registration | Shared WSL vectors, TS identity security tests, Go identity security tests, language vector runners |
| F03 | `csf_2879b9833eb081d8252bc0bb` | Bound raw name length, depth, total components, directories and objects before ZIP output; cancellation inside pinned directory walks | `archive_path_budget_test.go`, complete canonicalfs race suite |
| F04 | `csf_2d4abc153754ff8a6b6bf48d` | `v2-<bounded ASCII slug>--<full SHA-256>`, exact raw UTF-8, malformed Unicode rejection across ports; explicit read-only migration inventory | Shared ref/scalar vectors and migration inventory regressions |
| F05 | `csf_bb562a92a087ce0ee39321b2` | HTTPS on every daemon listener; chain, hostname and local pin before bearer; private per-launch token/CA/key bootstrap, no redirect/proxy bypass in default transports | TLS authentication/resource fixtures, live daemon smoke, bootstrap ownership/DACL tests |
| F06 | `csf_b9195133a487b0a89d1ba73d` | Swift exact UTF-8 equality/root checks and slicing; scalar-based ref encoding and byte-exact test oracle | NFC/NFD and combining-character shared vectors, Swift runner |
| F07 | `csf_368865aa3cf4a2e3a3ed78eb` | Bash payload only through bounded stdin/private request files, never argv/environment; helper bearer environment removed; cleanup on success/error/signals | `bash-payload-security.test.mjs`, Bash live transport smoke |

## Required adoption

1. Migrate Git-ref directory identities using [the inventory and ownership procedure](../Documentation/IDENTITY_V2_MIGRATION.md). Do not rename or attach a legacy directory solely by its old short digest. This patch does not move existing worktrees or data.
2. Configure daemon clients with a private local CA and expected pin, and rotate the token/certificate bundle for each instance. See [TLS bootstrap](daemon-tls-bootstrap.md). Plaintext URLs and missing pins now fail closed.
3. Change Bash `write-text project path text` calls to `write-text project path < payload-file`. Input preserves UTF-8 bytes, including NUL and final newlines, within request limits.
4. Complete the **external** cutover in [release process](release-process.md): replace all three npm trusted-publisher environment bindings with `npm-immutable`, protect the new environment and source/tag refs, and enable immutable releases. Old saved workflow runs retain their old authorization until the npm binding is replaced. No npm package is published by this remediation.

## Boundaries preserved

CanonicalPath remains lexical identity, not a filesystem access control boundary. Security-sensitive I/O stays in Go `canonicalfs` and pinned `os.Root` handles. ZIP extraction remains non-transactional after successful preflight: runtime errors can leave bounded directories and earlier completed entries; no unsafe recursive rollback was introduced. Host OS/volume roots, the private launcher and same-account/admin code remain trusted bootstrap prerequisites.

TLS pinning is in addition to chain/hostname validation. TypeScript rejects arbitrary custom `fetch`. Unity's explicitly supplied custom handler is trusted application code; its default production handler enforces authenticated transport. PowerShell retains per-request certificate callbacks and isolated connection groups, uses OS TLS defaults without changing global settings, and connects to a daemon requiring TLS 1.2 or later. Local scripts select PowerShell 7/Core; Windows PowerShell 5.1 is only an explicit compatibility CI opt-in.

## Verification record — 2026-10-23

Both required local gates, `pnpm verify` and `pnpm go:race`, completed successfully on the target Windows/WSL workstation. The results below are from the final target run and the dedicated native Windows checks. Earlier checks in the Linux build environment are superseded by this platform verification.

| Gate | Result |
|---|---|
| Security regression suite | PASS: 55 tests, 0 SKIP |
| TypeScript full suite | 355 PASS, 1 conditional vector-export SKIP; the exporter subsequently passed with `VECTOR_RESULTS_OUT` |
| JavaScript standalone full suite | 187 PASS, 1 conditional vector-export SKIP; the exporter subsequently passed with `VECTOR_RESULTS_OUT` |
| Go / TypeScript / JavaScript lexical vectors and exported results | PASS; all three result sets match |
| Python / Dart / C# / Swift / Kotlin lexical vectors | PASS: 185 / 193 / 185 / 168 / 193 cases respectively |
| C / Rust / C++ / Haxe / Godot lexical vectors | PASS: C 168 plus 6 invalid-UTF-8 cases; Rust 168; C++ 174; Haxe 168; Godot 168 |
| `pnpm go:race` in WSL | PASS, exit 0 on Go 1.26.10 |
| `govulncheck` v1.8.0 on Go 1.26.10 | PASS: no vulnerabilities found |
| Native Windows bootstrap and DACL tests | PASS on Go 1.26.10: 6 top-level test groups and 3 host subcases, no SKIP; fresh private process-local temporary root |
| Windows CMD transport smoke | PASS; warning output no longer contaminates protocol stdout |
| Native Windows PowerShell 7 lexical and live TLS-daemon integration | PASS: 185 lexical cases and live daemon smoke |
| Optional Unity Burst compiler probe | SKIP by default; opt-in probe, separate from the allocation matrix |
| Complete target `pnpm verify` | PASS, exit 0 on Go 1.26.10 |
| Installed Unity editor matrix | PASS: all 9 installed editor executables, each with exit 0 and a matching per-run completion nonce |
| Follow-up Codex Security Cloud scan | NOT PERFORMED: the service is currently unavailable for a new run |

The Unity matrix covered 2022.3.62f3, 6000.1.17f1, 6000.2.15f1, 6000.3.26f1, 6000.5.11f1, 6000.6.2f1, 6000.6.5f1, 6000.7.0b3 and 7000.0.0a7. Two other version directories contained no editor executable and are not installed lanes. The optional Burst compiler probe remained disabled; `pnpm alloc` and its separate allocation matrix were not part of these required gates.

The TypeScript and JavaScript conditional skips above concern vector export, not allocation tests. Haxe now hashes explicit UTF-8 bytes with SHA-256. PowerShell path/URI delimiter comparisons use ordinal semantics, preserving roots before combining characters. The CMD request fixture waits for upload completion and checks the full 1,046,714-byte request; production limits were not relaxed. Windows bootstrap correctly rejected the shared ambient temporary directory. Its native tests passed with a dedicated private temporary root, without changing existing user ACLs or weakening validation.

The existing Windows CI job now includes a dedicated bootstrap/DACL step with the same private temporary-root setup. That setup was validated natively with the compiled bootstrap test executable; the GitHub-hosted execution is a separate CI result.

The PowerShell smoke runner builds the daemon into its own temporary directory before starting health polling. Cold compilation no longer consumes the unchanged 80-attempt health budget; build failures, early exits and health timeouts retain diagnostic output. Startup failures and completed shell tests clean up the owned process, binary, project and TLS fixture.

TLS authentication fixtures distinguish a normal rejected request from a timed-out, signalled or failed child process. Managed fixtures also require their startup marker, report the client/scenario and safe exception type, and use a 15-second process budget around explicit 3-second request deadlines. The expected HTTP-header delivery and connection-pool isolation assertions remain mandatory for every case.

The first PR security baseline identified [GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809) in the previously pinned Go 1.26.9 `crypto/x509` implementation. Verification and release workflows now pin Go 1.26.10, and the workspace recommends that patched toolchain without raising the Go 1.25 module language floor. Security-sensitive builds require a supported patched toolchain, including when workspace toolchain selection is disabled. The Windows release-workflow parity fixture also normalizes CRLF to LF before comparison; the original failure was reproduced with CRLF, and all 29 release fixture tests pass with either line-ending form while preserving every content assertion. GitHub check results are attached to [PR #76](https://github.com/romanilyin/canonicalpath/pull/76).

All three Unity launchers use PowerShell `ProcessStartInfo`, wait for their child process and propagate its exit code. A native PS7 check preserved both output streams and returned a deliberately failing child's exit code 7. EditMode additionally requires a fresh per-run completion receipt, so compiler failures cannot be mistaken for passing tests.

F01 external cutover and live provenance remain **UNVERIFIED**: all three npm trusted-publisher bindings must use `npm-immutable`, the environment and source/tag refs must be protected, and immutable releases must be enabled and verified. The npm preparation/publisher fixtures use synthetic assets and mocked GitHub/registry data; no release or package was published. A fresh cloud scan of the pushed remediation commit, successful output validation and review of its results remain required before claiming cloud closure.
