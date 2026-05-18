# Shared Spec

`spec/testdata/*.json` is the source of truth for cross-language behavior. `spec/language-targets.json` is the source of truth for supported/planned language surfaces and allocation-check plans.

Rules:

- Go and TypeScript implementations must consume the same vectors; standalone C#/.NET, Swift, and the early Unity managed C# smoke gate also consume the canonicalpath vectors when their toolchains are available.
- `canonicalpath` vectors cover lexical identity only.
- `canonicalfs` fixtures must use real filesystem tests for traversal, symlink escape, archive traversal, and race attempts.
- `canonicalfs` reject fixtures use exact error codes by default; `errorMode: "reject-only"` means only rejection is portable across runtimes/platforms.
- `unity_bridge_vectors.json` covers early Unity bridge payload validation and generated filename behavior for `Assets/...` and `Packages/...`; TypeScript and the local C# smoke gate consume it, and it is not a filesystem security boundary.
- Every `canonicalpath` case declares an explicit `operation` such as `normalize`, `relative`, `join`, or `encode-git-ref`.
- Successful canonical path outputs use `/`, lowercase only the Windows drive letter, contain no NUL, and are lexically cleaned.
- URI decoding happens exactly once. Encoded `/` and `\` are rejected when `uri.rejectEncodedSlash` is enabled.
- WSL drive mapping is controlled by `options.wsl`; `/mnt/<drive>/...` is not treated as a universal truth unless that mapping is enabled.
- Git ref directory encoding is `slug--shortHash`, where `shortHash` is the first 12 hex chars of `SHA-256(raw)`. The slug replaces runs outside `[A-Za-z0-9._-]` with `-` and trims leading/trailing `.`, `_`, and `-`.
- Every language target must declare at least one allocation-check plan before it can be tracked in the repo.

Validation:

```bash
pnpm spec:validate
```

If `pnpm` is unavailable, use:

```bash
corepack pnpm spec:validate
```
