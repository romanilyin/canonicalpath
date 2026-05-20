# Repository metadata and description snippets

Use these snippets to make GitHub, package metadata, and short docs consistent.

## GitHub repository description

Recommended:

> Cross-runtime path identity and root-bound filesystem access for agents, build tools, and editor pipelines.

Shorter alternative:

> Deterministic path identity across runtimes, plus root-bound filesystem access.

Security-focused alternative:

> Shared path contract and root-bound I/O boundary for mixed-runtime tools.

## GitHub topics

Recommended topics:

```text
path
filesystem
path-traversal
canonicalization
security
root-bound
agents
mcp
unity
build-tools
go
typescript
windows
wsl
cross-platform
```

Use no more than GitHub’s topic limit. If trimming is needed, keep:

```text
path filesystem path-traversal security agents mcp unity go typescript cross-platform
```

## README hero copy

Use:

> Every runtime has a path library. CanonicalPath is for the moment where a path leaves one runtime and enters another.

Or:

> Store canonical identity. Open files through a root-bound boundary.

## NPM package description

For `@romanilyin/canonicalpath`:

> Shared CanonicalPath identity and daemon client helpers for cross-runtime tools.

For `@romanilyin/canonicalpath-standalone`:

> Browser-safe standalone CanonicalPath lexical identity helpers.

## Go module description

> Go CanonicalPath plus authoritative CanonicalFS root-bound filesystem access and daemon.

## Unity package description

> CanonicalPath lexical identity, scoped PathGuard validation, and daemon transport for Unity editor/tooling integrations.

Add this warning in Unity package docs:

> Unity code is a lexical/client integration surface. Security-sensitive filesystem I/O should delegate to the Go CanonicalFS daemon.

## Package README security note

Use this in every non-Go package README:

> This package is not an authoritative filesystem security boundary. Use it for lexical identity, scope validation, or daemon transport. Delegate security-sensitive filesystem I/O to the Go CanonicalFS daemon unless this package explicitly documents a reviewed native root-bound implementation.

## Social/announcement copy

Long:

> CanonicalPath is a path identity layer for mixed-runtime tools: agents, Unity editor bridges, build systems, WSL/Windows workflows, and package generators. CanonicalFS keeps real file access behind a root-bound Go boundary, while other runtimes share lexical vectors and client transports.

Short:

> One path contract for agents and build tools. One root-bound boundary for real filesystem I/O.

## Bad descriptions to avoid

Avoid:

> A path normalization library.

Too small and misleading.

Avoid:

> Secure filesystem access for every language.

Overclaims security.

Avoid:

> Universal path standard.

Invites the wrong framing.

Avoid:

> Realpath for agents.

Wrong abstraction: many tool paths do not exist yet.
