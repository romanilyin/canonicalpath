# Unity MCP Path Contract

Stage 1 defines the lexical path contract for Unity MCP tools. It is not a runtime API commitment for TypeScript, Unity, or Go.

`CanonicalPath` is lexical-only. It provides deterministic identity, serialization, comparison, and payload normalization, but it does not inspect the filesystem and is not a sandbox boundary. `CanonicalFS` through the Go daemon is the filesystem security boundary for any security-sensitive read, write, stat, extract, or mutation.

Unity MCP tools must resolve every path through an explicit scope. Arbitrary project-root paths are not accepted. `.git`, `ProjectSettings`, and the full `Library` tree are not allowed unless a current or future explicit scope adds a narrow operation.

## Common Rules

- Relative inputs use `/` separators only.
- Empty inputs, empty components, `.`, `..`, NUL, Windows ADS `:`, trailing dot/space components, absolute POSIX paths, Windows drive paths, Windows drive-relative paths, UNC paths, `file://` inputs, encoded `/`, and encoded `\` are rejected before scope resolution.
- URI decoding, if used by a caller before this contract, must happen exactly once. Encoded separators and double-decode attempts such as `%252f` or `%255c` remain rejected.
- Limits are measured in Unicode scalar values after lexical validation. Implementations may use stricter byte limits for host filesystems.
- No Unicode case folding or Unicode normalization is performed by this contract. Inputs are preserved as provided after separator and component validation.
- Scope checks are component-aware. Prefix siblings such as `AssetsEvil`, `UnityMcpKnowledgeEvil`, or `PackagesEvil` are outside the scope.
- Symlinks and reparse points are not followed by lexical checks. Any filesystem access must delegate to `CanonicalFS` or the Go daemon and reject symlink/reparse escapes there.
- Go daemon scoped endpoints accept explicit `scope`, `operation`, and scope-relative `path`; they resolve only project-backed scopes to project-relative paths before calling root-bound `CanonicalFS`. `gateway_cache` remains outside project-root daemon I/O.
- Unity managed `ScopedPathGuard` and daemon HTTP helpers are client-side validation/transport conveniences. They are not filesystem sandboxes and do not replace Go `CanonicalFS` root-bound enforcement.

## JSON Schema Fragments

`spec/command-descriptors.schema.json` defines reusable `$defs` for command descriptors that carry paths:

- `scopedPath` for `{ scope, operation?, path }` command arguments.
- `canonicalRelativePath` for project-relative daemon payload paths.
- `artifactRef` for references into the `artifact` scope.
- `packageManifestPath` for exact `Packages/manifest.json` or `Packages/packages-lock.json` paths.
- `knowledgePath` for scope-relative knowledge files below `Assets/UnityMcpKnowledge`.
- `boundedReadOptions`, `boundedWriteOptions`, `boundedListOptions`, and `boundedGlobPattern` for capped knowledge/artifact workflows.

## Artifact References And Bounded Ops

Artifact references are data references, not host paths. A persisted artifact reference uses `{ "scope": "artifact", "path": "job-artifacts/..." }` or `{ "scope": "artifact", "path": "screenshots/..." }`; callers must combine it with an explicit `project_id` and re-run scope validation before I/O.

Knowledge and artifact workflow tools must be bounded:

- Read operations require an implementation default `max_chars` and a hard cap no higher than 1 MiB of text.
- Write operations require text length checks before dispatch and a hard cap no higher than 1 MiB of text.
- List and glob operations require an implementation default `max_entries` and a hard cap no higher than 1000 returned entries.
- Glob patterns are scope-relative selector strings only. They may select already-scoped candidates, but they must not become host filesystem globs or bypass `CanonicalFS` for security-sensitive I/O.
- Returned list/glob entries and artifact refs must not include arbitrary absolute host paths.

## Scope Matrix

| Scope | Allowed roots | Allowed operations | Relative input format | Max path | Max component | Separators | Symlink/reparse policy | Case expectation | Unicode policy | Absolute input | LLM/tool args | Persisted refs | Audit refs | Artifact refs |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `unity_asset` | Project-relative `Assets/...`, `Packages/...` | `validate`, `read`, `write`, `import`, `refresh` | Project-relative path beginning with exact `Assets` or `Packages` component | 4096 | 255 | `/` only | Lexical check only; Go daemon/Unity bridge must reject filesystem escape | Exact ordinal scope components; host FS may differ | Preserve input; no normalization | No | Yes | Yes | Yes | Yes |
| `knowledge` | Project-relative `Assets/UnityMcpKnowledge/...` | `read`, `write`, `list` | Scope-relative path below the knowledge root, for example `agent-instructions.md`; resolves to project-relative `Assets/UnityMcpKnowledge/...` | 2048 | 255 | `/` only | Lexical check only; Go daemon/Unity bridge must reject filesystem escape | Exact ordinal | Preserve input; no normalization | No | Yes | Yes | Yes | No |
| `package_manifest` | Project-relative `Packages/manifest.json`, `Packages/packages-lock.json` only | `read`, `write` | Exact project-relative file path | 128 | 64 | `/` only | Lexical check only; Go daemon/Unity bridge must reject filesystem escape | Exact ordinal | Preserve input; no normalization | No | Yes | Yes | Yes | Yes |
| `artifact` | Project-relative `Library/SGGUnityMcp/job-artifacts/...`, `Library/SGGUnityMcp/screenshots/...` | `read`, `write`, `list` | Scope-relative path beginning with exact `job-artifacts` or `screenshots` component; resolves to project-relative `Library/SGGUnityMcp/...` | 2048 | 255 | `/` only | Lexical check only; Go daemon/Unity bridge must reject filesystem escape | Exact ordinal | Preserve input; no normalization | No | Yes | Yes | Yes | Yes |
| `gateway_cache` | Platform-specific local cache root outside the Unity project | `read`, `write`, `delete`, `generated-key` | Scope-relative generated cache key under `index/...`, never a host path | 1024 | 255 | `/` only | Lexical check only; Go daemon must reject cache escape | Exact ordinal | Preserve input; no normalization | No | No for raw host paths; yes for generated keys | Yes | Yes | No |
| `temp_session` | Project-relative `Temp/SGGUnityMcp/<session>/...` | `read`, `write`, `delete` | Scope-relative path beginning with an exact session component; resolves to project-relative `Temp/SGGUnityMcp/...` | 1024 | 255 | `/` only | Lexical check only; Go daemon/Unity bridge must reject filesystem escape | Exact ordinal | Preserve input; no normalization | No | Yes | No | Yes | No |

## Disallowed Project Paths

These are rejected unless a future explicit scope adds a narrow contract:

- Arbitrary project-root paths such as `README.md`, `src/...`, `Library/...`, or `Temp/...` outside an explicit scope.
- `.git/...` and other VCS internals.
- `ProjectSettings/...`.
- The full `Library/...` tree; only `Library/SGGUnityMcp/job-artifacts/...` and `Library/SGGUnityMcp/screenshots/...` are in scope for artifacts.
- The full `Temp/...` tree; only `Temp/SGGUnityMcp/...` is in scope for temporary session files.
- Gateway cache files use a platform-specific local cache root outside the Unity project, not Unity `Library` as a general-purpose storage root.
