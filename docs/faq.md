# FAQ

## Is CanonicalPath another path standard?

No. It is a narrow contract for tool boundaries where paths already cross languages, processes, operating systems, and agents.

For simple local code, use the standard library.

## Why not just use `path.normalize`, `os.path.normpath`, `filepath.Clean`, or `Path.normalize`?

Those functions are useful local helpers, but they are not a cross-runtime security or identity model.

They are usually lexical. They do not prove that a future filesystem operation will stay inside a root. Their behavior can also differ by runtime and OS.

CanonicalPath uses lexical operations for identity, but it does not pretend lexical cleanup is filesystem safety. Real I/O belongs in CanonicalFS.

## Why not just use `realpath` or `canonicalize`?

Realpath-style APIs resolve existing filesystem objects. Many tool paths refer to files that do not exist yet: generated code, build artifacts, cache entries, package manifests, planned edits, and logs.

They also return host-specific paths, which is the wrong durable identity for cross-runtime tools.

## Why split CanonicalPath and CanonicalFS?

Because path identity and file access are different problems.

CanonicalPath answers:

> What path does this tool mean?

CanonicalFS answers:

> Is this operation allowed to touch this file under this root?

Mixing those two concerns leads to overclaiming and security bugs.

## Which language is the filesystem security boundary?

Today, the authoritative filesystem security boundary is Go CanonicalFS / Go daemon.

Other languages may have lexical helpers, wrappers, client transports, or Unity bridge surfaces. They must not claim independent security-sensitive filesystem access unless a native root-bound implementation is added and reviewed separately.

## Does TypeScript CanonicalFS mean TypeScript can safely open untrusted paths?

No. TypeScript may provide helpers and RPC/HTTP clients. For adversarial filesystem I/O, it should delegate to the Go daemon.

## Does Unity PathGuard replace CanonicalFS?

No. Unity PathGuard/scoped validation is a bridge-side lexical policy layer. It protects command payload shape and Unity scope semantics. Real security-sensitive filesystem I/O should still go through the Go daemon.

## Why is Windows path handling such a big part of this project?

Windows has path behaviors that are easy to miss in cross-platform tools: drive-relative paths such as `C:foo`, UNC paths, reserved device names such as `NUL`, alternate data streams using `:`, trailing dots/spaces, case-insensitive volume designators, and NUL restrictions.

A tool that only tests POSIX-style `../` traversal will miss important cases.

## Does CanonicalPath handle symlinks?

CanonicalPath is lexical and does not access the filesystem.

Symlink/reparse-point behavior belongs to CanonicalFS or a reviewed native root-bound filesystem layer.

## Can I use CanonicalPath for paths that do not exist yet?

Yes. That is one of the main reasons it exists. Generated artifacts, planned edits, cache entries, and manifests need stable identity before files exist.

## Can I use this with OS sandboxing or containers?

Yes. CanonicalFS complements OS sandboxing. OS sandboxes reduce ambient authority; CanonicalPath still provides deterministic identity and cross-runtime serialization.

## Is every language production-ready?

No. Some surfaces are primary and supported, while many are lexical/vector-checked or transport-only. Always read the language matrix and the security level for the specific runtime.

## What should package docs say?

Use this wording:

> This package participates in the CanonicalPath shared path contract. Unless explicitly documented as an authoritative CanonicalFS implementation, it is not the final filesystem security boundary for untrusted paths.
