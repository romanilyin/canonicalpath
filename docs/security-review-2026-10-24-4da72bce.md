# Security remediation — scan 4da72bce, 2026-10-24

This review maps the four findings in the [Codex Security scan of `124aced`](https://chatgpt.com/mcp-app/connector_openai_defense_factory/open_defense_factory#/runs/wfr_4da72bce40868cc1fa3c3fc43ea21916e66026b13a324ef22ca7c1ac8c292966) to source changes and regression evidence. The scan reports one High, one Medium and two Low findings, all with High confidence. Source remediation and test results are separate from a subsequent cloud assessment; this document does not claim scanning-service closure.

## Source and provenance

| Field | Value |
| --- | --- |
| Repository | `romanilyin/canonicalpath` |
| Scanned commit | `124aced342ade7bcc6a3a7cece48fba382ed07c1` |
| Scanned tree | `8faa90dc643519adef2d662e0e2e86f4a23ba378` |
| Workflow run | `wfr_4da72bce40868cc1fa3c3fc43ea21916e66026b13a324ef22ca7c1ac8c292966` |
| Workflow output | `wfo_10ba07644498defaf0baa1781772f93ce4b0d397eb1f45d3a41351e827b12465` |
| Snapshot digest | `codex-security-snapshot/v1:sha256:62946c6673babf5e23f6be0c9c2207415237064217d763f135b905a7a36c67f7` |
| Findings SHA-256 | `343bb27062b1232220af3cda0446ecd28c2d888c43b4a402c94885ab6c0a47c4` |
| Report SHA-256 | `abd77ff563b24f801690531f069cde908c59676cc26fb193fdd34ff4b6d60728` |

The scan was an offline static review. Its workflow completed with `output_validation_warning` and no successful `validated_at` value. The indexed-findings endpoint returned zero entries, while the retained findings and report contain four. The report, findings, manifest and coverage files were retrieved completely and their SHA-256 values matched the artifact metadata. An empty findings index is not evidence of a clean assessment.

## Finding-to-control mapping

| Finding | Severity | Source remediation | Regression evidence |
| --- | --- | --- | --- |
| `csf_473551462cd41330c162227d` — local npm publisher selected through inherited `PATH` | High | Retire the local token-bearing execution path. The compatibility wrapper refuses every invocation before reading credentials, creating configuration, resolving npm or spawning a child. | [`security-regression.test.mjs`](../scripts/security-regression.test.mjs): fake npm/npm.cmd first in PATH, all aliases, env-file-only credentials, instrumented credential/I/O guards and output checks. |
| `csf_b3a3248b76fd60be3a9774ac` — Unity alias normalized with one grammar and labeled with another | Medium | Select one native grammar for comparison and metadata; default omitted project grammar to POSIX, reject incompatible native kinds/options, and detach stored registration state from callers. | [`unity-registration-storage-security.test.ts`](../packages/ts/test/unity-registration-storage-security.test.ts): literal-backslash identities, explicit/inherited grammars, contradictory metadata, WSL mappings, trimming and mutation attempts. |
| `csf_23604825c4394270d7016f19` — unbounded retained fake scoped content | Low | Check aggregate entry and key/value quotas before every mutation, including construction; account for overwritten values and preserve the previous state on refusal. | The same TypeScript regression file exercises MCP writes, entry/content boundaries, replacement accounting, constructor validation and shared capacity across projects/scopes. |
| `csf_76d46f979bd394bd18ef7c7c` — unbounded concurrent daemon connections before authentication | Low | Admit a bounded number of sockets before TLS; reserve a smaller pending pool, expire unauthenticated sockets, promote only valid bearers, close unauthorized responses and bound HTTP headers. | [`connection_admission_test.go`](../packages/go/canonicalfsrpc/connection_admission_test.go): real sockets/TLS, quotas, deadlines, timer/promotion races, slot reuse and authenticated keep-alive service under pending saturation. |

## Local publication boundary

The previous wrapper scrubbed secret-named child environment variables but still passed a live token configuration path to a publisher chosen through inherited PATH. A private temporary file did not authenticate that publisher.

`scripts/run-npm-with-env-token.mjs` is now an unconditional refusal with exit code 1. Existing `unity:npm:*` token aliases remain compatibility entrypoints, including ping, whoami and dry-runs. Arguments, environment credentials and `--env-file` cannot enable publication. Local build and package inspection commands remain available without publishing credentials.

Publication uses the existing isolated GitHub OIDC workflow and its immutable-artifact/provenance checks. The [.env example](../.env.example), [release process](release-process.md), Unity README and historical local-release instructions no longer direct maintainers to the retired token path. Existing private credential files are not read or modified by this remediation.

## Native aliases and retained fake content

Omitted project grammar now selects `sourceHost: "posix"`. Windows and already-canonical project identities require their explicit input grammar. Native aliases use only `posix`, `win32` or `wsl`; a canonical representation or URI transport mode cannot label a physical host root. Alias `hostKind` and an explicit `sourceHost` must agree, and canonical equality uses that same selected grammar. POSIX backslashes remain literal component data. Options that trim the retained host-root string are rejected, and WSL aliases require explicit mapping options. Registration options and returned records are detached so ordinary caller mutation cannot change the stored mapping.

The fake scoped store has a maximum of 10,000 unique entries and 8,388,608 UTF-16 code units across stored keys and values, with the existing 1,048,576-unit per-value cap. These are logical storage limits, not an exact Node heap-size promise. Constructor seeds and writes use the same accounting. A replacement subtracts the previous key/value contribution before checking its projected size, and a refused update changes neither retained content nor counters. The bridge does not retain the caller's mutable scoped seed object. Existing query work and result limits remain independent controls. See the [Unity path contract](unity-mcp-path-contract.md).

## Daemon transport admission

The CLI applies the following defaults before the HTTP server begins TLS work:

| Control | Default |
| --- | --- |
| Total admitted connections | 256 |
| Pending unauthenticated connections | 32 |
| Absolute authentication deadline from acceptance | 5 seconds |
| HTTP `MaxHeaderBytes` setting | 16 KiB |
| Application protocol | HTTP/1.1 |

Positive configuration is required, with the pending cap smaller than the total cap. Excess accepted sockets are closed without creating an HTTP/TLS handler goroutine or a pending timer. Successful bearer authentication releases the pending slot; the connection still counts against the total cap. Deadline expiration and promotion use a coordinated state transition, so a queued expiration callback cannot later close a successfully promoted connection.

Unauthorized requests and unauthenticated health probes close their connection after the response. HTTP/1.1 is explicit in the CLI so HTTP/2 multiplexing cannot bypass that policy. The listener wrapper and `ConnContext` hook are available to embedded servers; using `Server.Handler()` by itself does not install listener admission. Configuration and embedding requirements are in [daemon TLS bootstrap](daemon-tls-bootstrap.md).

Already-authenticated keep-alive connections remain usable while the pending pool is full. A newly arriving legitimate client can be refused until pending capacity is available: its identity is unknown before TLS and bearer validation. These controls bound retained sockets and concurrent unauthenticated work; they do not promise per-source rate limiting or immunity to network-volume/CPU saturation.

## Verification record

Before-fix regressions reproduced npm PATH selection/credential access, all 15 new TypeScript alias/storage failures, and unauthenticated keep-alive retention for both `/v1/caps` and `/healthz` against the scanned source. No live publication token, package publication or external attack target was used.

The final source passed the following checks on Linux with Node 24.19.0, Go 1.26.10 and Rust 1.99.1:

| Check | Result |
| --- | --- |
| `pnpm verify` | Exit 0, with the unavailable runtime checks listed below explicitly skipped. |
| `pnpm go:race` | All Go packages passed, including real TCP/TLS admission and root-bound filesystem tests. |
| Security script regressions | 50 passed, 1 C# transport test skipped because .NET was unavailable. |
| TypeScript typecheck and full suite | Typecheck passed; 611 tests passed, 1 vector-output test skipped in the ordinary suite. The separate vector-output stage passed. |
| JavaScript standalone suite | 359 tests passed, 1 vector-output test skipped in the ordinary suite. The separate vector-output stage passed. |
| Shared Go/TypeScript/JavaScript vectors | All 335 shared results matched. |
| Required Rust verification | Both runner-failure checks, all 8 unit tests, documentation-test invocation and all 335 vectors passed. Missing Cargo was tested as a failure, not a successful skip. |
| Additional available ports | Python: 352 cases and operation chains; C: 335 shared cases, 6 invalid-UTF-8 cases and operation chains; C++: 341 cases and operation chains. |
| Integration smokes | Go `js/wasm` denial tests, scoped daemon smoke, Bash transport smoke and 41 TypeScript Unity MCP path-scope vectors passed. |
| Patch hygiene | `git diff --check` passed. |

This environment did not have Dart, .NET, Swift, Kotlin/Java, Haxe, Godot, Windows CMD, PowerShell 7 or Unity editors. Their optional runtime checks were reported as skipped, including the C# Unity vectors, transport and Burst surface checks. The opt-in Unity Burst compiler probe was also skipped. These skips are not runtime PASS results; GitHub-hosted Windows checks and any installed-editor runs have their own execution records.

No package version, release tag or publication workflow was activated. A fresh cloud assessment remains a separate validation step.
