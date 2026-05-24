# Release Plan 2026.5.18-2

This is the working plan for the first public release. The repository stays private until the release preparation is reviewed and committed.

## Scope

Release `2026.5.18-2` includes everything currently shipped in the repository:

- Source repository and GitHub Release notes.
- GitHub Release notes drafted in `docs/release-notes-2026.5.18-2.md`.
- npm package `@romanilyin/canonicalpath`.
- npm package `@romanilyin/canonicalpath-standalone`.
- Go `canonicalpath`, `canonicalfs`, and `canonicalfsrpc` source under `packages/go`.
- Go `canonicalfs` daemon source under `packages/go/cmd/canonicalfs-daemon`.
- Unity UPM Git package `com.romanilyin.canonicalpath` under `packages/unity`.
- Experimental lexical/client-only targets for Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, GDScript/Godot, Bash, Windows CMD/BAT, and PowerShell.

## Version And Tags

Use calendar version `2026.5.18-2` for release metadata.

Planned tags after the final release commit:

```text
2026.5.18-2
packages/go/v0.2026.5-18.2
```

Existing remote tag `2026.5.18-1` must not be moved. It points at an older commit and remains historical.

Go-specific mapping:

```text
source release: 2026.5.18-2
Go module tag: packages/go/v0.2026.5-18.2
```

The Go module tag keeps the release visibly calendar-based while remaining valid for the current module path `github.com/romanilyin/canonicalpath/packages/go`. Do not use `packages/go/v2026.5.18-2`; Go would treat `v2026` as a major version and require a `/v2026` module path suffix.

Unity UPM Git consumers can target the repository tag with a path dependency after the repository is public:

```text
https://github.com/romanilyin/canonicalpath.git?path=/packages/unity#2026.5.18-2
```

## Prepared State

- `CODEOWNERS` requires `@romanilyin` review.
- `SECURITY.md` documents private vulnerability reporting.
- `.github/ISSUE_TEMPLATE/config.yml` redirects security reports to private advisory flow.
- `CONTRIBUTING.md` and `CONTRIBUTING.ru.md` document PR and branch naming rules, including `l10n` for localization-only documentation changes.
- npm package metadata is publish-ready and includes `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` in pack dry-runs.
- GitHub repository settings are squash-only, delete merged branches, and keep Actions token permissions read-only.
- GitHub Actions were manual-only while the repository was private.
- CI, security baseline, and CodeQL workflows are enabled on `pull_request`, `push` to `main`, and `workflow_dispatch` after the public switch.

## Pre-Public Checklist

Run locally before the release commit is tagged:

```bash
pnpm check:changelog
pnpm verify
pnpm go:race
pnpm ts:pack:dry-run
pnpm js:standalone:pack:dry-run
pnpm audit --audit-level moderate
git diff --check
```

Run Go vulnerability scan from `packages/go`:

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
"$(go env GOPATH)/bin/govulncheck" ./...
```

If the public switch has already happened, run the manual `release` and `security` workflows before publishing packages.

Create and push tags only after the final release commit passes gates:

```bash
git tag 2026.5.18-2
git tag packages/go/v0.2026.5-18.2
git push origin 2026.5.18-2 packages/go/v0.2026.5-18.2
```

## Public Switch Checklist

After review, commit, local gates, and tag creation:

- Open `romanilyin/canonicalpath` as public.
- Enable secret scanning and push protection if GitHub exposes them for the public repository.
- Keep the prepared CodeQL workflow enabled for `pull_request`, `push`, and `workflow_dispatch` unless GitHub CodeQL default setup replaces it deliberately.
- Enable private vulnerability reporting if available.
- Enable fork PR workflow approval for outside collaborators.

## CI And Branch Protection

After the repository is public, `ci.yml`, `security.yml`, and `codeql.yml` should use:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:
```

Create a minimal PR after enabling PR-triggered CI. Use it to confirm check names and stability.

This release uses a small documentation-only PR as the public CI smoke test before enabling `protect-main`.

Required checks to consider after the first green PR run:

- `ci / local release readiness gate`.
- `ci / Windows PowerShell module smoke`.
- `security / security baseline`, only if stable.

Do not make Unity editor-heavy local matrix lanes required until they are stable on GitHub-hosted runners.

Create `protect-main` after required checks are visible:

- Target branch: `main`.
- Bypass list: empty.
- Require pull request before merging.
- Required approvals: `1`.
- Require Code Owner review.
- Dismiss stale pull request approvals when new commits are pushed.
- Require approval of the most recent reviewable push.
- Require conversation resolution before merging.
- Require status checks to pass before merging.
- Require linear history.
- Block force pushes.
- Block deletions.
- Do not enable signed commits for the first release.

## npm Publish

Publish only after local gates, public repository switch, and green CI checks:

```bash
pnpm ts:pack:dry-run
pnpm js:standalone:pack:dry-run
pnpm -C packages/ts publish --access public
pnpm -C packages/javascript-standalone publish --access public
```

Verify after publication:

```bash
npm view @romanilyin/canonicalpath version
npm view @romanilyin/canonicalpath-standalone version
```

## Unity Package

For the first release, publish Unity as a Git UPM package by repository tag and path.

Unity npmjs scoped-registry publication is prepared separately as `com.romanilyin.canonicalpath@2026.5.24-1`; see `docs/release-unity-2026.5.24-1.md`. Do not publish `com.romanilyin.canonicalpath@2026.5.18-2` to npmjs for Unity registry dependencies.

Before registry publication or copying `packages/unity` outside the repository, include `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` in the package tarball or use another reviewed notice strategy. The Unity registry package uses npm prepack notice sync for this.

## GitHub Release

Create the GitHub Release from tag `2026.5.18-2` after the public switch and package checks. Mark it as a pre-release if any shipped surface is still considered experimental.

Use `docs/release-notes-2026.5.18-2.md` as the release notes draft.

Release notes should summarize:

- Full initial MVP and experimental target release.
- Security boundary: `CanonicalPath` is lexical-only, Go `CanonicalFS` is the root-bound filesystem boundary.
- npm packages and Unity Git UPM coordinates.
- Go module tag `packages/go/v0.2026.5-18.2` and the calendar versioning policy.
