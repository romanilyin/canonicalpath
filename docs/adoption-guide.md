# Adoption guide

This guide explains which CanonicalPath/CanonicalFS layer to use for each kind of project.

## Decision tree

### I only need to manipulate trusted local paths in one language

Use your standard library. CanonicalPath is probably unnecessary.

### I need to store or transmit a project path across languages/processes

Use CanonicalPath.

Examples:

- TypeScript gateway sends a path to a Go daemon.
- Unity sends `Assets/...` to an MCP bridge.
- A generated artifact path is stored in JSON before the file exists.
- Windows and WSL clients refer to the same project root with different host paths.

### I need to read/write/delete files under a trusted root using untrusted path input

Use CanonicalFS.

- In Go, use the root-bound CanonicalFS implementation.
- In other runtimes, validate/serialize locally and delegate I/O to the Go daemon.

Do not build a host path string and open it later.

### I need to extract archives

Use a root-bound destination. Archive entry names are untrusted path input.

Recommended rule:

- Parse/validate archive entry identity lexically.
- Reject unsafe scopes/components.
- Write through CanonicalFS under the destination root.
- Treat symlinks/reparse points as policy-sensitive entries, not as ordinary files.

### I need Unity integration

Use Unity managed CanonicalPath/PathGuard for lexical scope validation and user-facing/editor-facing path identity.

Use the Go daemon for security-sensitive filesystem I/O.

Recommended Unity scopes:

- `unity_asset`
- `unity_package`
- `package_manifest`
- `artifact`
- `gateway_cache`
- `knowledge`
- `temp_session`

Do not let the model pass arbitrary absolute host paths to Unity write commands.

### I need PowerShell, Bash, or CMD automation

Use wrappers as transport clients to the Go daemon. Treat them as command surfaces, not as standalone filesystem security layers.

### I need Python/Dart/C#/Swift/Kotlin/C/Rust/C++/Haxe/GDScript

Use lexical CanonicalPath for identity and shared-vector parity.

For real filesystem access:

- call the Go daemon; or
- implement a native root-bound design and document/review it separately.

## Recommended integration patterns

### Pattern 1: Agent/MCP safe file tool

1. Agent provides `{ project, scope, path }`, not a raw absolute host path.
2. Gateway validates lexical shape with CanonicalPath and scope rules.
3. Gateway resolves the project root through PathAliases.
4. Real I/O is sent to CanonicalFS daemon.
5. Response returns canonical/scoped path identity plus operation result.

### Pattern 2: Unity bridge write command

1. Unity command accepts a scoped project-relative path.
2. `PathGuard` validates allowed Unity scopes.
3. The bridge rejects absolute paths, drive-relative paths, UNC paths, traversal, NUL, ADS, and reserved names according to policy.
4. Any security-sensitive file operation uses the daemon.
5. Unity code receives editor-safe result data, not arbitrary host path authority.

### Pattern 3: Build artifact generation

1. Tool computes CanonicalPath for the future artifact.
2. Path is stored in manifest/cache/logs as canonical identity.
3. When writing the artifact, use CanonicalFS under the artifact root.
4. Logs display friendly aliases where needed, but do not treat display paths as authority.

### Pattern 4: Cross-host project aliasing

1. Register one canonical project identity.
2. Add aliases for host contexts: Windows, WSL, Unity Editor, gateway daemon, CI checkout.
3. Convert at the boundary only.
4. Store canonical identity in durable data.

## Anti-patterns

Do not do this:

```ts
const p = path.normalize(userInput)
if (!p.startsWith(projectRoot)) throw new Error('bad path')
await fs.writeFile(path.join(projectRoot, p), data)
```

Problems:

- `startsWith` can be path-boundary unsafe.
- Normalization semantics differ by platform.
- Symlinks and races are not handled.
- The final open happens outside a root-bound filesystem boundary.

Better pattern:

```text
user input -> CanonicalPath lexical validation -> scope policy -> CanonicalFS daemon write under registered root
```

## Minimal onboarding copy for README/package docs

Use this short paragraph in package READMEs:

> This package participates in the CanonicalPath shared path contract. It may provide lexical identity helpers, client transport, or integration glue. Unless this package explicitly says it is an authoritative CanonicalFS implementation, do not use it as the final filesystem security boundary for untrusted paths. Delegate security-sensitive I/O to the Go CanonicalFS daemon.
