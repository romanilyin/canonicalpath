# API Compatibility

The repository is still pre-1.0, but the MVP contract is intentionally narrow so downstream integrations can start testing without depending on unstable behavior.

## Stable For MVP

- `spec/testdata/*_cases.json` shape: `version`, `cases`, `id`, `operation`, `raw`, `root`, `target`, `relative`, `expected`, `error`, and `options`.
- `spec/testdata/fs_fixtures_manifest.json` shape: `version`, `fixtures`, `operation`, `path`, `target`, `expect`, `error`, and optional `errorMode`.
- `canonicalpath.Normalize` / TypeScript `normalize` lexical behavior covered by shared vectors.
- `canonicalpath.Relative` / `relative` component-aware root checks for canonical absolute paths.
- `canonicalpath.Join` / `join` rejecting absolute or escaping relative paths.
- `canonicalpath.ToWin32` / `toWin32`, `canonicalpath.ToWSL` / `toWSL`, and `canonicalpath.ToPOSIX` / `toPOSIX` serialization behavior covered by shared vectors.
- `canonicalpath.SanitizeComponent` / `sanitizeComponent` and `EncodeComponent` / `encodeComponent` behavior covered by shared vectors.
- `canonicalpath.IsEqual` / `isEqual` as normalize-then-compare helpers covered by shared vectors.
- Python `canonicalpath` lexical helpers covered by shared vectors.
- C# / .NET `CanonicalPath` lexical helpers covered by shared vectors.
- Swift `CanonicalPath` lexical helpers covered by shared vectors.
- Kotlin `CanonicalPath` lexical helpers covered by shared vectors.
- C `canonicalpath` lexical helpers covered by shared vectors.
- Rust `canonicalpath` lexical helpers covered by shared vectors.
- C++ `canonicalpath` lexical helpers covered by shared vectors.
- Haxe `CanonicalPath` lexical helpers covered by shared vectors.
- GDScript/Godot `CanonicalPath` lexical helpers covered by shared vectors.
- JavaScript standalone/browser `canonicalpath` lexical helpers covered by shared vectors.
- Git ref directory encoding as `slug--sha256-12`.
- Error code strings listed in the stable taxonomy below.

## Stable Error Taxonomy

`canonicalpath` lexical error codes:

- `ERR_ABSOLUTE_PATH`
- `ERR_ALTERNATE_DATA_STREAM`
- `ERR_DRIVE_RELATIVE_PATH`
- `ERR_EMPTY_PATH`
- `ERR_ENCODED_SEPARATOR`
- `ERR_INVALID_COMPONENT`
- `ERR_INVALID_PATH`
- `ERR_INVALID_PERCENT_ENCODING`
- `ERR_INVALID_URI`
- `ERR_NUL_BYTE`
- `ERR_OUTSIDE_ROOT`
- `ERR_RESERVED_DEVICE_NAME`
- `ERR_UNSUPPORTED_URI_SCHEME`

`canonicalfs` root-bound core and fixture error codes:

- `ERR_ABSOLUTE_PATH`
- `ERR_ARCHIVE_TRAVERSAL`
- `ERR_DRIVE_RELATIVE_PATH`
- `ERR_NUL_BYTE`
- `ERR_OUTSIDE_ROOT`
- `ERR_RACE_DETECTED`
- `ERR_READ_LIMIT_EXCEEDED`
- `ERR_SYMLINK_ESCAPE`

`canonicalfsrpc` daemon transport error codes:

- `ERR_DAEMON`
- `ERR_REQUEST_TOO_LARGE`
- `ERR_RESPONSE_TOO_LARGE`
- `ERR_ROOT_NOT_ALLOWED`
- `ERR_UNAUTHORIZED`
- `ERR_UNSUPPORTED_OPERATION`

Client-local error codes are not daemon wire codes:

- `ERR_DAEMON_CLIENT` is currently PowerShell-only for malformed local daemon client objects or missing local bearer token configuration.

## Security Boundaries

- `canonicalpath` is not a security boundary and must not access the filesystem.
- Go `canonicalfs` is the authoritative filesystem security package.
- TypeScript `canonicalfs` is best-effort/RPC-helper only and must not claim TOCTOU-proof security.
- Bash and Windows CMD/BAT wrappers are transport-only; security-sensitive filesystem I/O must still delegate to the Go daemon.
- PowerShell 5.1 and PowerShell 7 support is lexical/client-only; security-sensitive filesystem I/O must still delegate to the Go daemon.
- C# / .NET support is lexical-only; security-sensitive filesystem I/O must still delegate to the Go daemon.
- Swift support is lexical-only; security-sensitive filesystem I/O must still delegate to the Go daemon.
- Kotlin support is lexical-only; security-sensitive filesystem I/O must still delegate to the Go daemon.
- Haxe support is lexical-only; security-sensitive filesystem I/O must still delegate to the Go daemon.
- GDScript/Godot support is lexical-only; security-sensitive filesystem I/O must still delegate to the Go daemon or separately reviewed engine-native abstractions.
- Unity bridge `PathGuard` is payload validation before Unity write commands; it is not a root-bound filesystem security boundary.

## Supported Client Surfaces

- Go packages: `canonicalpath`, `canonicalfs`, and the `canonicalfsrpc` daemon/server surface.
- Python package: experimental lexical `canonicalpath` only, with no filesystem operations or daemon transport yet.
- Dart / Flutter package: experimental lexical `canonicalpath` only, with no filesystem operations or daemon transport yet.
- C# / .NET package: experimental lexical `CanonicalPath` only, with no filesystem operations or daemon transport yet.
- Swift package: experimental lexical `CanonicalPath` only, with no filesystem operations or daemon transport yet.
- Kotlin package: experimental lexical `CanonicalPath` only, with no filesystem operations or daemon transport yet.
- C package: experimental lexical `canonicalpath` only, with no filesystem operations or daemon transport yet.
- Rust crate: experimental lexical `canonicalpath` only, with no filesystem operations or daemon transport yet.
- C++ package: experimental lexical `canonicalpath` only, with no filesystem operations or daemon transport yet.
- Haxe package: experimental lexical `CanonicalPath` only, with no filesystem operations or daemon transport yet.
- GDScript/Godot script: experimental lexical `CanonicalPath` only, with no filesystem operations or daemon transport yet.
- JavaScript standalone/browser package: lexical `canonicalpath` only, with no filesystem operations.
- TypeScript package: `canonicalpath`, best-effort `canonicalfs`, and RPC/HTTP `canonicalfs` clients.
- Bash wrapper: experimental transport-only CLI wrapper for Go daemon health, caps, project open/close, and root-bound file operations; no independent filesystem security boundary.
- Windows CMD/BAT wrapper: experimental transport-only CLI wrapper for Go daemon health, caps, project open/close, and root-bound file operations via `curl.exe` and `powershell.exe`; no independent filesystem security boundary.
- PowerShell 5.1: experimental lexical module plus typed JSON HTTP client helpers to the Go `canonicalfs` daemon.
- PowerShell 7: experimental lexical module plus typed JSON HTTP client helpers to the Go `canonicalfs` daemon.
- Go `canonicalfsrpc` requires `Authorization: Bearer <capability-token>` for every endpoint except `GET /healthz`.
- Go `canonicalfsrpc` exposes authenticated `GET /v1/caps` for current endpoint and request/read/response cap discovery.
- Go `canonicalfsrpc` returns JSON error envelopes for authenticated unknown endpoints instead of plaintext HTTP 404 responses.
- Go `canonicalfsrpc` registers project roots only when `host_root` resolves to an existing directory at or under a configured allowed root; otherwise it returns `ERR_ROOT_NOT_ALLOWED`.
- Go `canonicalfsrpc` caps JSON requests at 1 MiB by default, uses a 1 MiB default `readFile` cap when `max_bytes` is omitted, enforces a 16 MiB hard read cap, and caps encoded JSON responses at 24 MiB by default.
- Go `canonicalfsrpc` exposes scoped project-root endpoints under `/v1/scoped/*` for `readFile`, `writeFile`, `stat`, `mkdirAll`, and `remove`. These endpoints accept `project_id`, Unity MCP `scope`, `operation`, and scope-relative `path`, then resolve to project-relative paths before delegating to Go `canonicalfs`.
- `canonicalfs-daemon` sets HTTP `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, and `IdleTimeout`; the CLI exposes flags for all request/read/response caps and timeout values.

## Early Bridge Surfaces

- Unity bridge adapter/facade has minimal `ICanonicalPathService`, `CanonicalPathValue`, and `PathGuard` for `Assets/...` / `Packages/...` payloads.
- Unity managed `CanonicalPath` runtime consumes the shared canonicalpath vectors and has a local dotnet allocation smoke gate.
- Unity managed `CanonicalFSDaemonHttpClient` covers health, capabilities, project open/close, root-bound read/write/stat/mkdir/remove/rename calls, and Unity MCP scoped read/write/stat/mkdir/remove helpers through the Go daemon, with `CancellationToken` overloads for editor-side bounded waits; the Go daemon remains the filesystem security boundary.
- Unity bridge payload and generated filename behavior is covered by `spec/testdata/unity_bridge_vectors.json` and consumed by the TypeScript gateway tests plus the local C# smoke gate.
- Unity bridge built-ins currently cover status, project info, recent logs, validated text reads, path validation, and guarded write command dispatch.
- Unity bridge write dispatch covers `assets.refresh`, `scene.save`, `asset.import`, and prefab/module command contracts; every path-bearing write must pass `PathGuard` before execution.
- TypeScript Unity gateway exposes bounded fake-bridge knowledge/artifact read, write, list, and glob tool contracts. Artifact references are scope-relative `{ scope: "artifact", path }` values and do not carry host filesystem paths.
- Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` have active local EditMode lanes via `pnpm unity:editmode:matrix` and active local Burst allocation lanes via `pnpm unity:burst:alloc:matrix`.

## Planned Client Surfaces

- Planned language targets start from `canonicalpath` parity; targets with `http-client` in `spec/language-targets.json` add daemon HTTP transport without becoming independent filesystem security boundaries.
- C# / .NET daemon HTTP transport remains planned; the current package support is lexical `CanonicalPath` only.
- Swift daemon HTTP transport remains planned; the current package support is lexical `CanonicalPath` only.
- Kotlin daemon HTTP transport remains planned; the current package support is lexical `CanonicalPath` only.
- Haxe daemon HTTP transport remains planned; the current package support is lexical `CanonicalPath` only.
- GDScript/Godot daemon HTTP transport remains planned; the current package support is lexical `CanonicalPath` only.
- PowerShell module 5.1 + 7 has experimental `CanonicalPath` vector parity and typed daemon HTTP client helpers, but no independent root-bound `CanonicalFS` security boundary.
- Full Unity hardening remains planned, while the early package lanes currently cover `2022.3`, `6000.1`, `6000.2`, `6000.3`, and `6000.4` with managed EditMode and Burst-compatible allocation gates.
- Allocation-check plans for all supported and planned targets are tracked in `spec/language-targets.json`.

## Go Version Compatibility

- Go `1.24.x` is the minimum CI target for `canonicalfs` because it provides `os.Root`.
- Go latest is covered by the manual CI workflow with `go-version: 1.x` and `check-latest: true`; locally use the installed latest Go shim.
- `canonicalfs.Rename` returns `ErrUnsupportedOperation` on Go versions before `1.26`.
- `canonicalfs.Rename` uses `os.Root.Rename` on Go `1.26+` via build tags.

## Experimental

- `canonicalfs.ExtractZip` is an MVP helper for root-bound ZIP extraction and may be generalized before 1.0.
- Race fixture coverage may be expanded; current tests and fixture manifest assert that symlink-swap attempts do not read outside-root content.
- TS local `BestEffortCanonicalFSRoot` read, write, stat, mkdir, remove, and rename APIs are explicitly non-authoritative; use RPC/HTTP clients backed by the Go daemon for security-sensitive I/O.
- TS `CanonicalFSRPCRoot` validates project-relative paths before delegating read, write, stat, mkdir, remove, and rename operations to a daemon/client implementation.
- TS `unity-gateway` includes fake bridge support for read/status/log/path-validation and guarded write tool contracts. Fake writes record only; real Unity writes must call Unity-side `PathGuard`.
