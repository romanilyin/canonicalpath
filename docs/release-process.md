# Release Process

Full release publishing automation is not implemented yet. The repository has CI, security baseline, CodeQL, and manual release-readiness workflows that validate release gates without publishing packages or creating releases. Unity npmjs publication has local helpers for the current unsigned npm publish path and optional Unity-signed tarball publication, but it still requires an explicit maintainer command.

Current full release plan: `docs/release-2026.5.18-2.md`. Current Unity registry release plan: `docs/release-unity-2026.6.14-1.md`.

## Public Coordinates

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- Main npm package: `@romanilyin/canonicalpath`.
- Standalone browser-safe npm package: `@romanilyin/canonicalpath-standalone`.
- Go module path: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package: `com.romanilyin.canonicalpath`.
- Unity npmjs scoped-registry package: `com.romanilyin.canonicalpath` under npmjs with Unity manifest scope `com.romanilyin`.
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

Unity registry-only package releases may use the same calendar SemVer-compatible shape independently from full source releases. Example: `com.romanilyin.canonicalpath@2026.5.24-1` for a Unity npmjs scoped-registry package prepared after source release `2026.5.18-2`.

## Release Scope

The `2026.5.18-2` public release is a full repository release. It includes the source repository, GitHub Release notes, npm publication for `@romanilyin/canonicalpath` and `@romanilyin/canonicalpath-standalone`, Go source and daemon packages with Go module tag `packages/go/v0.2026.5-18.2`, Unity UPM Git package, and the current experimental lexical/client-only language targets.

The `2026.6.14-1` Unity registry release is scoped to `packages/unity` and publishes npmjs scoped-registry packaging with Unity `.meta` files for synced legal assets. It does not republish the TypeScript, JavaScript standalone, or Go packages.

## Gates

- CI, security baseline, and CodeQL workflows run on `pull_request`, `push` to `main`, and `workflow_dispatch` after the repository is public.
- Run `pnpm verify`, `pnpm go:race`, `pnpm check:changelog`, and `git diff --check` before release commits.
- Run `pnpm ts:pack:dry-run`, `pnpm js:standalone:pack:dry-run`, and `pnpm unity:pack:dry-run` before npm publication.
- Before optional signed Unity npmjs publication, run `pnpm unity:pack:signed` with UPM CLI credentials available; it must produce a `.tgz` containing `.attestation.p7m`.
- `pnpm verify` includes `packages/ts/test/package-smoke.mjs`, npm pack dry-runs, and `scripts/run-scoped-daemon-smoke.mjs`.
- Each package dry-run ultimately uses `npm pack --dry-run` to inspect the publish tarball without uploading it.
- Run `pnpm audit --audit-level moderate` and `govulncheck ./...` from `packages/go` before opening the repository.
- The manual `release` workflow runs `pnpm check:changelog`, `pnpm verify`, `pnpm go:race`, and npm pack dry-runs for the TypeScript and JavaScript standalone packages.
- The `codeql` workflow is enabled for `pull_request`, `push` to `main`, and `workflow_dispatch`.
- The TypeScript package must build `dist` declarations and runnable ESM exports for `.`, `./canonicalpath`, `./canonicalfs`, and `./unity-gateway`.
- The Unity package tarball must include `Runtime`, `Tests`, `README.md`, `CHANGELOG.md`, and synced `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` files with their Unity `.meta` files. Optional signed publication must also include Unity's `.attestation.p7m` signature file.
- The Go `canonicalfs` daemon remains the filesystem security boundary. `CanonicalPath` is lexical-only, and TypeScript/Unity helpers must not claim TOCTOU-proof filesystem security.

## Publishing Secrets

Token-based npm commands and optional Unity signing should use a local root `.env` file that is ignored by git:

```text
NPM_TOKEN=npm_...
UPM_ORGANIZATION_ID=...
UPM_SERVICE_ACCOUNT_KEY_ID=...
UPM_SERVICE_ACCOUNT_KEY_SECRET=...
```

The Unity service account must have the `Package Manager Package Signer` role for the selected Unity Cloud organization when using signed publication. Use the checked-in helpers so npm publication uses a temporary npm userconfig, and signed Unity publication signs the tarball before upload:

```sh
pnpm unity:npm:ping
pnpm unity:npm:whoami
pnpm unity:npm:publish:dry-run
pnpm unity:npm:publish
pnpm unity:npm:publish:unsigned
pnpm unity:npm:publish:unsigned:dry-run
pnpm unity:pack:signed
pnpm unity:npm:publish:signed:dry-run
pnpm unity:npm:publish:signed
```

Do not commit `.env`, `.npmrc`, npm automation tokens, Unity service account credentials, or command output that contains tokens.

## Public Switch

After the release commit and local gates pass, open the repository as public. Standard GitHub-hosted Actions are free for public repositories, so PR-triggered CI should be enabled immediately after the public switch.

After the repository is public:

- Keep `pull_request`, `push`, and `workflow_dispatch` triggers enabled for `ci.yml`, `security.yml`, and `codeql.yml`.
- Enable secret scanning and push protection if GitHub makes them available.
- Keep the repository CodeQL workflow enabled unless GitHub CodeQL default setup replaces it deliberately.
- Enable private vulnerability reporting if available.
- Create a minimal test PR, wait for green checks, then configure required checks and the `protect-main` ruleset.

## Daemon Setup

Start the Go `canonicalfs` daemon with an explicit bearer token and allowed project root:

```sh
CANONICALFS_DAEMON_TOKEN=change-me go run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:8765 -allow-root /path/to/project
```

Clients should call `/v1/projects/open` with a known `project_id` and then use project-relative `/v1/fs/*` or scope-relative `/v1/scoped/*` requests. Do not send arbitrary absolute paths as file-operation payloads.
