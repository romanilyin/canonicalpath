# Release Process

Release publishing automation is not implemented yet. The repository has manual release-readiness and CodeQL workflows that validate release gates without publishing packages or creating releases.

Current release plan: `docs/release-2026.5.18-2.md`.

## Public Coordinates

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- Main npm package: `@romanilyin/canonicalpath`.
- Standalone browser-safe npm package: `@romanilyin/canonicalpath-standalone`.
- Go module path: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package: `com.romanilyin.canonicalpath`.
- License: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.

## Version Policy

Public package versions use calendar SemVer-compatible versions in this shape:

```text
YYYY.M.D-N
```

Example: `2026.5.18-2`.

The source release tag uses the same calendar version without a `v` prefix:

```text
2026.5.18-2
```

Do not move an existing pushed tag. If a release candidate changes after a tag was pushed, create a new `-N` suffix.

The Go module release tag uses the monorepo module prefix and a Go-compatible calendar SemVer variant:

```text
packages/go/v0.2026.5-18.2
```

This keeps the visible year/month/day/release number while staying under major version `v0`, so the current Go module path does not need a `/v2026` suffix. Do not use `packages/go/v2026.5.18-2` under the current module path because Go would treat `v2026` as a major version and require `github.com/romanilyin/canonicalpath/packages/go/v2026`.

## Release Scope

The `2026.5.18-2` public release is a full repository release. It includes the source repository, GitHub Release notes, npm publication for `@romanilyin/canonicalpath` and `@romanilyin/canonicalpath-standalone`, Go source and daemon packages with Go module tag `packages/go/v0.2026.5-18.2`, Unity UPM Git package, and the current experimental lexical/client-only language targets.

## Gates

- Keep GitHub Actions manual-only until the repository is public or the private Actions quota policy changes.
- Run `pnpm verify`, `pnpm go:race`, `pnpm check:changelog`, and `git diff --check` before release commits.
- Run `pnpm ts:pack:dry-run` and `pnpm js:standalone:pack:dry-run` before npm publication.
- `pnpm verify` includes `packages/ts/test/package-smoke.mjs`, `npm pack --dry-run`, and `scripts/run-scoped-daemon-smoke.mjs`.
- Run `pnpm audit --audit-level moderate` and `govulncheck ./...` from `packages/go` before opening the repository.
- The manual `release` workflow runs `pnpm check:changelog`, `pnpm verify`, `pnpm go:race`, and npm pack dry-runs for the TypeScript and JavaScript standalone packages.
- The manual `codeql` workflow is prepared for CodeQL analysis and must stay manual-only until the repository is public.
- The TypeScript package must build `dist` declarations and runnable ESM exports for `.`, `./canonicalpath`, `./canonicalfs`, and `./unity-gateway`.
- The Go `canonicalfs` daemon remains the filesystem security boundary. `CanonicalPath` is lexical-only, and TypeScript/Unity helpers must not claim TOCTOU-proof filesystem security.

## Public Switch

After the release commit and local gates pass, open the repository as public. Standard GitHub-hosted Actions are free for public repositories, so PR-triggered CI should be enabled immediately after the public switch.

After the repository is public:

- Enable `pull_request` and `push` triggers for `ci.yml` and `security.yml`; keep `workflow_dispatch`.
- Enable secret scanning and push protection if GitHub makes them available.
- Enable CodeQL default setup or add a CodeQL workflow.
- Enable private vulnerability reporting if available.
- Create a minimal test PR, wait for green checks, then configure required checks and the `protect-main` ruleset.

## Daemon Setup

Start the Go `canonicalfs` daemon with an explicit bearer token and allowed project root:

```sh
CANONICALFS_DAEMON_TOKEN=change-me go run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:8765 -allow-root /path/to/project
```

Clients should call `/v1/projects/open` with a known `project_id` and then use project-relative `/v1/fs/*` or scope-relative `/v1/scoped/*` requests. Do not send arbitrary absolute paths as file-operation payloads.
