# Security remediation — 2026-10-24

Source remediation is implemented for the three findings in the [follow-up Codex Security scan](https://chatgpt.com/mcp-app/connector_openai_defense_factory/open_defense_factory#/runs/wfr_0fe15518666fc0239ead62d4e2006982029f84e709ee3998ae7d944a3f7c2636). All three findings have **Low severity and High confidence**. Local verification is complete on the source changes described below. A new cloud scan remains **pending**; this document does not claim that the findings have been closed by the scanning service.

The subsequent scan of `124aced` is recorded in the [next remediation review](security-review-2026-10-24-4da72bce.md), including retirement of the local token-publishing fallback and additional connection/storage limits. The results below retain the original source-and-test record.

## Source and scope

| Field | Value |
| --- | --- |
| Repository | `romanilyin/canonicalpath` |
| Scan run | `wfr_0fe15518666fc0239ead62d4e2006982029f84e709ee3998ae7d944a3f7c2636` |
| Scan output | `wfo_e890b832aff779d755bd60103ddf1a4604f0b531b900ad2012330dd1cb7a862d` |
| Scanned/base commit | `61155e8b94015f5cc9a4e0a93ab615494bc95a21` |
| Verified base Git tree | `6726b118b5b974f606b5bb8370c3834f5fa04f75` |
| Snapshot digest | `codex-security-snapshot/v1:sha256:d42ddbc5c6851117a0c611fa77cdcf3da6a1a599dd2c4d81d683f68276afa251` |
| Retrieved `findings.json` SHA-256 | `bbf029b74f3e83b61904a52328443c910abf2562005c7e802efc3bb798655776` |
| Review type | Static, offline, whole-repository review; repository code and runtime proofs were not executed by the scan |

The run completed on 2026-10-23 with `output_validation_warning`: “Workflow output failed validation; retained files may be incomplete or invalid.” No successful output validation is recorded. The indexed-findings endpoint returned zero entries when retrieved, while the retained `findings.json` and report describe three findings. The mapping below uses those retained artifacts; an empty index is not evidence of a clean scan. External deployment configuration and GitHub/npm account settings were outside the scanned source snapshot.

This review follows the [2026-10-22 source remediation](security-review-2026-10-22.md). `CanonicalPath` remains lexical identity and serialization. Go `CanonicalFS` provides the root-bound filesystem boundary on explicitly supported targets; TypeScript fake-bridge behavior remains a local/test adapter.

## Finding-to-control mapping

| Finding | Severity / confidence | Source remediation | Executed regression evidence |
| --- | --- | --- | --- |
| `csf_60dac7cc00298482915c9100` — CanonicalFS remains callable where `os.Root` cannot enforce root confinement | Low / High; CWE-367 | Explicit supported-platform allowlist and a guard at `OpenRoot` and every exported `Root` method; all other targets return `ErrUnsupportedOperation` before I/O or callbacks | [`platform_unsupported_test.go`](../packages/go/canonicalfs/platform_unsupported_test.go) covers every exported method and nil, zero, raw and scoped roots; [`run-go-unsupported-platform-tests.mjs`](../scripts/run-go-unsupported-platform-tests.mjs) executes the suite under `js/wasm` |
| `csf_96b98c9c21af152f02bc5469` — Daemon reopens a checked allowed-root pathname before pinning it | Low / High; CWE-367 | The initial directory handle remains authority; configured and resolved aliases must match its handle-backed identity; temporary and partially constructed roots are closed on failure | [`allowed_root_startup_test.go`](../packages/go/canonicalfsrpc/allowed_root_startup_test.go) deterministically replaces roots, ancestors and aliases; [`allowed_root_cleanup_linux_test.go`](../packages/go/canonicalfsrpc/allowed_root_cleanup_linux_test.go) checks failure-path descriptor cleanup |
| `csf_3ea3e14c9e58fa6daa9de8f6` — Scoped Unity globs compile into catastrophic-backtracking regular expressions | Low / High; CWE-1333 | Iterative glob matching with bounded state; list/glob queries reject stores above 10,000 entries and share a 4,000,000-unit work budget | [`unity-glob-security.test.ts`](../packages/ts/test/unity-glob-security.test.ts) checks compatibility, output caps, aggregate budgets and adversarial patterns; a separate child-process fixture enforces a deadline |

## Filesystem platform boundary

[`canonicalfs/platform_supported.go`](../packages/go/canonicalfs/platform_supported.go) explicitly enables `aix`, `android`, `darwin`, `dragonfly`, `freebsd`, `illumos`, `ios`, `linux`, `netbsd`, `openbsd`, `solaris`, and `windows`. Every other target is denied at the package constructor and all `Root` methods, including raw opens, metadata, mutation, walking, scoped roots, ZIP extraction and `Close`. Guards precede filesystem access, context use and caller callbacks. Nil or zero-value roots cannot bypass the guard.

`js/wasm` and `plan9` have name-based standard-library roots that do not satisfy this package's confinement contract. `wasip1` is unsupported until the complete CanonicalFS backend is validated there. New Go targets require an explicit backend review before joining the allowlist. This is separate from lexical `canonicalpath` support.

The new `pnpm go:unsupported-platforms` gate builds `canonicalfs` tests for `GOOS=js GOARCH=wasm` and executes them through the selected Go toolchain's Node runner. The tests check every exported root method, rejection before callbacks, unchanged fixture contents, and an untouched raw standard-library handle. The gate is part of `pnpm verify` and fails if compilation, the runner or a test fails. Native security fixtures retain explicit supported-platform build constraints so an unsupported-target test run cannot silently skip the denial contract.

The actual module/workspace language floor is Go `1.25.0`; the workspace toolchain recommendation and current CI pins are Go `1.26.10`. The documentation correction removes stale Go 1.24 claims. On supported platforms, `Rename` still requires Go 1.26; Go 1.25 returns `ErrUnsupportedOperation`. See [API compatibility](api-compatibility.md#go-version-compatibility).

## Allowed-root acquisition and identity

[`canonicalfsrpc/server.go`](../packages/go/canonicalfsrpc/server.go) validates configuration options before acquiring roots, normalizes each configured alias lexically, and opens the directory once as the authority for that allowed root. It obtains the initial object's identity through `Root.Stat(".")`. Symlink resolution supplies alias metadata only; it never chooses a replacement authority handle.

Both the configured alias and its resolved name are opened as temporary directory handles. Their `Root.Stat(".")` identities must match the retained initial object's identity through `os.SameFile`. Using handle-backed metadata on both sides also avoids deferred pathname identity reads on Windows. Temporary handles are closed after their checks, including on stat failure. A mismatch or an unverifiable alias aborts construction and closes the initial handle. If a later configured root fails, previously acquired roots are also closed.

The security invariant is object continuity from the first successful acquisition through server lifetime. A replacement that causes an alias check to identify another object is rejected. If a name changes after validation, subsequent registrations and operations still use the retained original root. The configuration and its ancestors remain trusted bootstrap inputs at initial acquisition; lexical normalization alone does not authenticate a filesystem object.

The deterministic regressions exercise replacement of the root itself, replacement of its ancestor and retargeting of a symlink alias after initial acquisition and before binding. They also check a universally available different-directory mismatch, exact original-handle retention, missing aliases, invalid and duplicate root lists, and cleanup after partial construction. Existing post-acquisition rename and registration regressions remain in place. Tests that depend on host rename or symlink permissions may report SKIP; those outcomes must be recorded separately from passing execution. See [daemon bootstrap](daemon-tls-bootstrap.md#allowed-root-acquisition).

## Bounded scoped list/glob queries

[`FakeUnityBridge`](../packages/ts/src/unity-gateway/fake-bridge.ts) no longer translates caller patterns into a backtracking regular expression. It uses iterative state-machine/dynamic-programming matching with `O(m × n)` work for pattern length `m` and path length `n`, and `O(m)` state. Existing scope validation, case sensitivity, literal metacharacters, UTF-16 wildcard behavior, slash/line-terminator rules, numeric ordering and artifact references are preserved.

Both scoped list and glob queries enforce two independent work controls:

- The complete scoped store must contain at most 10,000 entries, including entries for unrelated projects and scopes. A larger store fails before iteration. This limits query input; it does not cap writes or allocated store size.
- One 4,000,000-unit budget covers key-prefix checks, stored-path validation, prefix/glob matching and sorting comparisons. Matcher work is charged before a candidate is processed. Exceeding the budget returns `ERR_INVALID_PATH` without partial entries.

The existing default response cap of 100 and hard cap of 1000 remain in effect after matching and sorting. Lowering `max_entries` does not disable the work controls. Glob patterns retain their 512-code-unit maximum and 255-code-unit component limit in the TypeScript implementation. Work units bound the implemented loops; they are not a wall-clock service guarantee.

Adversarial regression cases use the actual current TypeScript source compiled into an isolated directory and run MCP tool calls in a child Node process with a five-second enforced deadline. Compatibility cases compare only small bounded inputs against the prior grammar; long attack patterns are never passed to that reference regex. The backend remains in-memory and local/test-only. See the [Unity MCP path contract](unity-mcp-path-contract.md#fake-bridge-list-and-glob-limits).

## Verification status

Local runs used Go **1.26.10**, Node **22.23.3**, pnpm **10.0.0**, WSL Ubuntu 24.04 and native Windows on 2026-10-24. The native Windows test executable was freshly cross-compiled from the same source and run through PowerShell 7.6.6. Logs and exit receipts were retained in the task's local verification evidence directory. No package version, release tag or publication was created.

| Check | Command or scope | Result |
| --- | --- | --- |
| Native Unix filesystem and RPC regressions | `go test -count=1 ./packages/go/canonicalfs ./packages/go/canonicalfsrpc` in WSL | **PASS**; deterministic startup namespace and descriptor-cleanup regressions executed |
| Native Windows RPC regressions | Fresh Windows RPC test binary, `-test.count=1 -test.v` | **PASS**; different-directory identity, retained handle and retargeted alias tests executed. Two startup open-directory rename subtests and the existing post-registration open-directory rename test explicitly **SKIP** because Windows denied the host rename |
| Go race detector | `pnpm go:race` | **PASS** |
| Unsupported-platform runtime denial | `pnpm go:unsupported-platforms` | **PASS**; real `js/wasm` execution under Node, including every exported Root method |
| Additional unsupported targets | `GOOS=plan9 GOARCH=amd64` and `GOOS=wasip1 GOARCH=wasm` test builds | **Compile PASS only**; no runtime execution claimed |
| TypeScript types and tests | Typecheck and full tests in `pnpm verify` | **PASS**; 364 tests passed, one vector-export test deferred to the separate vector-export invocation, which also passed |
| Focused gateway/glob regressions | Existing gateway plus new glob security tests | **19/19 PASS**, including seven adversarial child-process cases with an enforced deadline |
| Repository security and compatibility gate | `pnpm verify` | **PASS**, exit 0; security runner regressions, package checks, Go/TS/JS result comparison, all locally available lexical ports, wrappers, Unity and PowerShell 7 gates completed |
| Installed Unity EditMode matrix | Nine installed stable/beta/alpha editors | **9/9 PASS**; completed editor processes and fresh nonce-bearing receipts verified |
| Optional Burst compiler probe and allocation matrix | `UNITY_BURST_PROBE=1`, `pnpm alloc` | **NOT RUN**; the compiler probe reported its explicit optional skip. The Burst surface smoke passed; this is not an allocation/compiler result |
| Follow-up cloud assessment | New scan of the resulting source revision | **PENDING**; no new scan started and no service finding status changed |

The Unity matrix covered `2022.3.62f3`, `6000.1.17f1`, `6000.2.15f1`, `6000.3.26f1`, `6000.5.11f1`, `6000.6.2f1`, `6000.6.5f1`, `6000.7.0b3` and `7000.0.0a7`. A platform SKIP is separate from passing execution; the open-directory replacement scenarios ran on the supported Unix host.

The existing scan is a static assessment of the base commit. Source fixes, local test results and a subsequent cloud assessment are separate evidence; none substitutes for another.
