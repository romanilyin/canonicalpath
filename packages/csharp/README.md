# C# / .NET Package

Status: supported experimental lexical `canonicalpath` package checked against shared JSON vectors.

C# support is intended for .NET consumers. Full Unity package support remains separate from this standalone package.

Use this package to share CanonicalPath lexical identity with Go, TypeScript, Unity, and other runtimes. It is not an authoritative filesystem security boundary; security-sensitive filesystem I/O must delegate to the Go daemon unless a native root-bound implementation is separately reviewed and documented.

Current scope:

- `canonicalpath` lexical identity and serialization from shared JSON vectors.
- No independent secure filesystem layer unless a platform-specific root-bound design is added.

Planned scope:

- Daemon HTTP client for `canonicalfs` operations. The current `CanonicalPathHttpClient` file is a placeholder and is not a supported transport API yet.

Local note:

- Windows `dotnet.exe` is available from WSL in the current workspace. A separate WSL .NET SDK is not required unless Windows-side tooling becomes insufficient for local checks.

Allocation gate plan:

- `pnpm csharp:alloc` uses `GC.GetAllocatedBytesForCurrentThread` for repeated `Normalize`, `Relative`, `Join`, equality, serialization, sanitization, and Git ref encoding calls.
- The allocation-check command is tracked in `spec/language-targets.json`.

Local checks:

```bash
pnpm csharp:vectors
pnpm csharp:alloc
```
