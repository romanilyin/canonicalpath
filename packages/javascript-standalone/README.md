# JavaScript Standalone / Browser CanonicalPath

Status: supported experimental lexical package.

Browser-safe standalone CanonicalPath lexical identity helpers.

Use this package when browser or standalone JavaScript code needs to share the same path identity contract as the rest of the monorepo without importing Node filesystem APIs. It does not perform filesystem I/O and is not an authoritative filesystem security boundary.

Scope:

- Reuse shared vectors from `spec/testdata` for `canonicalpath` lexical behavior.
- No local filesystem operations in this target.
- No local `canonicalfs` security claims; delegate security-sensitive I/O to the Go daemon.
- Package exports point at generated `dist` ESM and declaration output; `dist` is built locally and not committed.
- Synchronous `encodeGitRef` uses an internal SHA-256 implementation so shared vector behavior matches Go and TypeScript.

Checks:

- `pnpm -C packages/javascript-standalone typecheck`
- `pnpm -C packages/javascript-standalone build`
- `pnpm -C packages/javascript-standalone build:smoke`
- `pnpm -C packages/javascript-standalone test`
- `pnpm js:standalone:alloc`

## License

`@romanilyin/canonicalpath-standalone` is licensed under the MIT License.

The Unity package `com.romanilyin.canonicalpath` is licensed separately under
Stinger Royalty-Free EULA 1.0.
