# JavaScript Standalone / Browser CanonicalPath

Status: supported experimental lexical package.

This package provides a browser-safe CanonicalPath lexical surface without Node-only imports.

Scope:

- Reuse shared vectors from `spec/testdata` for `canonicalpath` lexical behavior.
- No local filesystem operations in this target.
- No local `canonicalfs` security claims.
- Package exports point at generated `dist` ESM and declaration output; `dist` is built locally and not committed.
- Synchronous `encodeGitRef` uses an internal SHA-256 implementation so shared vector behavior matches Go and TypeScript.

Checks:

- `pnpm -C packages/javascript-standalone typecheck`
- `pnpm -C packages/javascript-standalone build`
- `pnpm -C packages/javascript-standalone build:smoke`
- `pnpm -C packages/javascript-standalone test`
- `pnpm js:standalone:alloc`
