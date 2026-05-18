# Release Process

Release automation is not implemented yet. Follow SemVer and keep shared spec changes explicit.

## Public Coordinates

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- Main npm package: `@romanilyin/canonicalpath`.
- Standalone browser-safe npm package: `@romanilyin/canonicalpath-standalone`.
- Go module: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package: `com.romanilyin.canonicalpath`.
- License: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.

## Gates

- Keep packages private until the repository is explicitly opened for public release.
- Run `pnpm verify`, `pnpm go:race`, and `git diff --check` before release commits.
- `pnpm verify` includes `packages/ts/test/package-smoke.mjs`, `npm pack --dry-run`, and `scripts/run-scoped-daemon-smoke.mjs`.
- The TypeScript package must build `dist` declarations and runnable ESM exports for `.`, `./canonicalpath`, `./canonicalfs`, and `./unity-gateway`.
- The Go `canonicalfs` daemon remains the filesystem security boundary. `CanonicalPath` is lexical-only, and TypeScript/Unity helpers must not claim TOCTOU-proof filesystem security.

## Daemon Setup

Start the Go `canonicalfs` daemon with an explicit bearer token and allowed project root:

```sh
CANONICALFS_DAEMON_TOKEN=change-me go run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:8765 -allow-root /path/to/project
```

Clients should call `/v1/projects/open` with a known `project_id` and then use project-relative `/v1/fs/*` or scope-relative `/v1/scoped/*` requests. Do not send arbitrary absolute paths as file-operation payloads.
