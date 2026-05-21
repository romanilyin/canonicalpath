# CanonicalPath compared with existing solutions

CanonicalPath is best understood as a boundary-layer project, not as a replacement for every language’s path utilities.

## Summary table

| Existing solution | What it solves well | Where it falls short for mixed-runtime tools | CanonicalPath positioning |
|---|---|---|---|
| Standard lexical normalizers: Node `path.normalize`, Python `os.path.normpath`, Go `filepath.Clean`, Java `Path.normalize` | Local path cleanup, removing redundant separators and `.` / `..` segments. | Per-language and OS-dependent; often lexical only; may change meaning in the presence of symlinks; not a security boundary. | Use them inside implementations, but expose CanonicalPath as the shared cross-runtime contract. |
| Absolute/real path APIs: Python `realpath`, Node `fs.realpath`, Java `toRealPath`, Rust `canonicalize` | Resolve existing filesystem objects and symlinks. | Requires files to exist, returns host-specific paths, can be wrong abstraction for generated artifacts, and is not enough for TOCTOU-safe root-bound access. | CanonicalPath covers identity for existing and missing files; CanonicalFS handles actual I/O. |
| Go `filepath.IsLocal` / `Localize` | Strong lexical validation for local paths, including Windows reserved-name handling. | Go-only and lexical-only; does not solve multi-language serialization or symlink/race-safe I/O. | Adopt the same kind of strict thinking, but make it cross-runtime and pair it with CanonicalFS. |
| Werkzeug `safe_join` / framework safe static-file helpers | Practical protection for web static-file serving and URL-style untrusted paths. | Usually framework-specific, URL-oriented, and not a general project-root filesystem boundary across languages and tools. | CanonicalPath targets build/editor/agent pipelines, not only web static files. |
| Go `os.Root` / `OpenInRoot` | Strong modern root-bound filesystem operations in Go. | Great API, but it is Go-local; non-Go tools still need a contract and transport. Some operations and platforms have caveats. | CanonicalFS should use this as the authoritative Go boundary and expose daemon/client flows for other runtimes. |
| `filepath-securejoin` | Go/Linux/container-oriented safe path resolution, with newer APIs using Linux hardening such as `openat2`. | Older `SecureJoin` string-returning API has TOCTOU concerns; newer APIs are Linux-only and not a cross-language identity layer. | Treat as a strong reference for threat modeling and Linux hardening, not as a replacement for the cross-runtime contract. |
| `libpathrs` | Very strong Linux path-resolution hardening, C-friendly API, procfs/magic-link awareness. | Linux-specific, lower-level, and not aimed at Unity/WSL/agent language-matrix identity. LGPL considerations may matter for some consumers. | CanonicalPath can coexist with or delegate to such native hardening where appropriate; its differentiator is multi-runtime identity plus daemon-backed I/O. |
| Rust `cap-std` | Capability-based filesystem API with directory-relative operations. | Rust ecosystem solution; uses Rust path types; not a shared path identity system for TypeScript/Unity/PowerShell/etc. | Similar philosophy, broader target: one contract for many runtimes. |
| chroot, containers, OS sandboxes, Landlock/AppArmor | Strong OS/process-level isolation. | Heavyweight, platform-specific, and does not provide deterministic path serialization or language parity. | CanonicalFS complements OS sandboxing; CanonicalPath still handles identity. |
| Custom project `PathGuard` helpers | Easy to add quickly in Unity/TS/etc. | Usually drift across languages; often miss Windows/UNC/ADS/NUL/symlink/TOCTOU cases. | Replace ad hoc checks with shared vectors and a single security-boundary design. |

## The core difference

Existing path tools usually answer one of two questions:

1. “How should this runtime clean up this local path string?”
2. “What existing file does this path resolve to on this machine?”

CanonicalPath answers a different question:

> “What is the stable project-scoped identity of this path when it crosses languages, processes, agents, editors, and operating systems?”

CanonicalFS then answers:

> “Can this identity be used for real I/O inside a specific root without escaping it?”

## Why not just use standard path libraries?

Because standard path libraries are local. They are necessary, but they are not a shared product boundary.

Examples:

- Node’s `path` behavior differs between Windows and POSIX. Its documentation explicitly says `path.isAbsolute()` is not safe for mitigating path traversal.
- Python’s `os.path.normpath()` is a string manipulation and can change meaning when symlinks are involved.
- Java’s `Path.normalize()` does not access the filesystem, and eliminating `..` can change which file is located when a preceding component is a symlink.
- Go’s `filepath.Clean()` is lexical. `filepath.IsLocal()` is useful, but it explicitly does not account for symlinks.

CanonicalPath should not pretend those libraries are bad. It should say: use them as implementation details, not as the public cross-runtime contract.

## Why not just use `realpath` / `canonicalize`?

`realpath`-style APIs resolve existing objects. That is not enough for:

- generated files that do not exist yet;
- artifact IDs and cache keys;
- project-relative paths stored in configs or logs;
- Unity asset paths where the stable identity is `Assets/...`, not a host absolute path;
- WSL/Windows aliases where different host strings refer to the same project root;
- security-sensitive opens where a checked path can be raced before use.

CanonicalPath handles identity before the file exists. CanonicalFS handles safe access when the file is opened.

## Why not just use Go `os.Root`?

Go `os.Root` is one of the best foundations for CanonicalFS. It is not a competitor so much as the primitive the Go implementation should rely on.

The remaining product gap is:

- TypeScript, Unity, PowerShell, Bash/CMD, Python, Dart, C#, Rust, C++, and other clients need a safe way to talk to that boundary.
- Agents need explicit scopes and stable JSON/IPC shapes.
- Projects need shared test vectors so client code does not drift.
- Tooling needs PathAliases for host-specific path representations.

CanonicalFS should openly say: Go is the authoritative filesystem boundary; other languages are clients or lexical layers unless separately reviewed.

## Why not use `filepath-securejoin` or `libpathrs`?

Those are strong references for Linux/container path hardening. They solve a narrower and lower-level problem than CanonicalPath.

Use them as inspiration or potential platform-specific backends. Do not position CanonicalPath as beating them at Linux kernel-level path resolution. Position it as solving the broader multi-runtime and agent/tooling contract.

## Why not use Rust `cap-std`?

`cap-std` is philosophically close: avoid ambient filesystem access and operate through directory capabilities. The difference is scope. `cap-std` is a Rust API. CanonicalPath is a cross-runtime contract with a Go daemon boundary and language ports/wrappers.

## Recommended comparison wording

Use:

> CanonicalPath does not replace standard path libraries; it standardizes the boundary where their results must become portable across runtimes.

Use:

> CanonicalFS does not make string sanitization safer. It avoids relying on strings as the final security boundary.

Avoid:

> Better than `os.Root`.

Better:

> Built around the same root-bound idea as `os.Root`, but packaged for mixed-runtime clients and agents.

## Source/reference links

- OWASP Path Traversal: `https://owasp.org/www-community/attacks/Path_Traversal`
- Snyk Zip Slip: `https://security.snyk.io/research/zip-slip-vulnerability`
- Node.js path docs: `https://nodejs.org/api/path.html`
- Python `os.path` docs: `https://docs.python.org/3/library/os.path.html`
- Go `filepath` docs: `https://pkg.go.dev/path/filepath`
- Go `os.Root` docs: `https://pkg.go.dev/os#Root`
- Go traversal-resistant file APIs blog: `https://go.dev/blog/osroot`
- Werkzeug safe_join docs: `https://werkzeug.palletsprojects.com/en/stable/utils/#werkzeug.security.safe_join`
- Rust cap-std docs: `https://docs.rs/cap-std/latest/cap_std/fs/index.html`
- filepath-securejoin: `https://github.com/cyphar/filepath-securejoin`
- libpathrs: `https://github.com/openSUSE/libpathrs`
- Microsoft Windows file naming: `https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file`
- Microsoft NTFS file streams: `https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams`
