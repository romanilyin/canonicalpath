# CanonicalPath positioning

## One-line pitch

CanonicalPath gives mixed-runtime tools one deterministic path identity. CanonicalFS gives them one reviewed root-bound filesystem boundary.

## Short description

CanonicalPath is a cross-runtime path identity and serialization layer for agents, build tools, game/editor pipelines, and Windows/WSL/macOS/Linux workflows. CanonicalFS is the separate root-bound I/O layer used when a path actually touches the filesystem.

The core message is simple:

> Every language has a path library. CanonicalPath is for the moment where a path leaves one language and enters another.

## What it is

CanonicalPath is:

- a deterministic lexical path contract;
- a shared test-vector suite across languages;
- a serialization and comparison layer for DB/IPC/logging/artifacts;
- a scoped path model for agents and MCP tools;
- a bridge for host-specific path aliases such as Windows, WSL, Unity project roots, gateway caches, artifacts, and temp sessions;
- a way for non-Go clients to delegate security-sensitive filesystem operations to the Go CanonicalFS daemon.

CanonicalFS is:

- the root-bound filesystem layer;
- the only layer that should claim direct filesystem security today;
- the place where untrusted paths become real reads/writes.

## What it is not

CanonicalPath is not:

- a replacement for standard path libraries in simple single-language code;
- a realpath/canonicalize clone;
- a magic sanitizer that makes every filesystem operation safe;
- a promise that every supported language has a native secure filesystem implementation;
- a general OS sandbox;
- a new global path standard for everyone.

## Why it exists

Path bugs happen at boundaries:

- TypeScript validates a string, Go opens it.
- Unity accepts `Assets/...`, a gateway writes an artifact somewhere else.
- Windows treats `C:foo` as drive-relative, not the same as `C:\foo`.
- A path is stored in a database before the file exists, so `realpath` cannot be used.
- A path is checked for symlinks and then opened later after the filesystem changed.
- An archive entry contains `../../evil` and extraction code concatenates it with a destination directory.

CanonicalPath exists to stop every tool from inventing a slightly different interpretation of “safe project path”.

## Primary users

### Agent and MCP developers

Need: small, explicit, auditable file tools. Agents should pass scoped paths, not raw host paths.

Message:

> Give the model project-scoped paths. Let the daemon decide what can touch disk.

### Unity/editor tooling developers

Need: distinguish `Assets/...`, `Packages/...`, `ProjectSettings/...`, generated files, artifacts, caches, temp sessions, and package manifests.

Message:

> Unity path validation belongs at the bridge boundary. Real filesystem writes belong in the root-bound daemon.

### Build tool and package authors

Need: stable path identity for generated files, missing files, artifacts, logs, and cross-platform CI.

Message:

> Store canonical identity; open files through a root-bound boundary.

### Security-minded infrastructure developers

Need: reduce traversal, symlink, reparse-point, and TOCTOU bugs without making every language port a security project.

Message:

> One reviewed filesystem boundary is safer than ten partial safe-join implementations.

## Differentiators

| Differentiator | Why it matters |
|---|---|
| Split between identity and I/O | Prevents the common mistake of treating lexical normalization as filesystem safety. |
| Shared vectors | Keeps behavior aligned across languages and prevents silent drift. |
| Root-bound Go CanonicalFS | Gives non-Go runtimes a concrete security boundary instead of best-effort string checks. |
| Explicit scopes | Fits agent/MCP tools where `project`, `artifact`, `cache`, `package_manifest`, and `temp_session` must not be interchangeable. |
| PathAliases | Handles the real-world case where one project root has different host representations. |
| Unity bridge path model | Covers a niche that generic path libraries do not: Unity project-relative semantics and editor/agent bridges. |
| Honest maturity labels | Makes lexical/client-only surfaces useful without overclaiming filesystem security. |

## Recommended tagline variants

Use one of these in public descriptions:

1. `Cross-runtime path identity and root-bound filesystem access.`
2. `One path contract for agents, build tools, and editor pipelines.`
3. `Deterministic path identity across runtimes. Root-bound I/O where the filesystem begins.`
4. `Stop passing raw host paths through agent tools.`
5. `Canonical paths for identity. Root-bound filesystem access for I/O.`

## Product narrative

Most path libraries answer local questions: “How do I normalize this string on this OS?” or “What is the real path of this existing file?” CanonicalPath answers a boundary question: “How do I keep the same path identity when it crosses TypeScript, Go, Unity, PowerShell, WSL, Windows, and an agent tool call?”

The answer is not to make every language a filesystem-security implementation. The answer is to split the problem:

1. CanonicalPath handles lexical identity, serialization, comparison, scopes, and aliases.
2. CanonicalFS handles real filesystem access under a root.
3. Client runtimes either stay lexical-only or call the daemon.

That split is the project’s main marketing point.

## Anti-positioning

Avoid these messages:

- “A better `path.normalize`.” Too small and misleading.
- “A secure path sanitizer for every language.” Overclaims security boundaries.
- “A universal path standard.” Invites the xkcd objection.
- “Canonicalize all paths.” Ambiguous because many ecosystems use canonicalize to mean realpath/symlink resolution.
- “Safe filesystem access in TypeScript/Python/C#/Unity.” Only true if delegated to the Go daemon or a separately reviewed native root-bound design.

Use instead:

- “shared path contract”;
- “lexical identity layer”;
- “root-bound filesystem boundary”;
- “daemon-backed secure I/O for non-Go clients”;
- “scope-aware paths for agent/editor tools”.
