# Release Process

The repository has CI, security baseline, CodeQL, and manual release-readiness workflows. New immutable, non-prerelease GitHub Releases prepared by `.github/workflows/prepare-npm-release.yml` can publish the npm packages through `.github/workflows/publish-npm.yml` using npm Trusted Publishing with GitHub Actions OIDC. Unity npmjs publication also retains local unsigned helpers. Optional local signed helpers fail closed until authentic signature verification exists.

Current full release plan: `docs/release-2026.10.10-4.md`. Current Unity registry release plan: `docs/release-unity-2026.6.14-1.md`.

## Public Coordinates

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- Main npm package: `@romanilyin/canonicalpath`.
- Standalone browser-safe npm package: `@romanilyin/canonicalpath-standalone`.
- Go module path: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package: `com.romanilyin.canonicalpath`.
- Unity npmjs scoped-registry package: `com.romanilyin.canonicalpath` under npmjs with Unity manifest scope `com.romanilyin`.
- License model: repository default and non-Unity packages are `MIT`; Unity package `com.romanilyin.canonicalpath` remains `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.

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

The `2026.6.14-1` Unity registry release is scoped to `packages/unity` and publishes npmjs scoped-registry packaging with Unity `.meta` files for committed package-local legal assets. It does not republish the TypeScript, JavaScript standalone, or Go packages.

## Gates

- CI, security baseline, and CodeQL workflows run on `pull_request`, `push` to `main`, and `workflow_dispatch` after the repository is public.
- Run `pnpm verify`, `pnpm go:race`, `pnpm check:licenses`, `pnpm check:changelog`, and `git diff --check` before release commits.
- Run `pnpm ts:pack:dry-run`, `pnpm js:standalone:pack:dry-run`, and `pnpm unity:pack:dry-run` before npm publication.
- Optional local `unity:pack:signed` and `unity:npm:publish:signed` commands are disabled; a `.attestation.p7m` filename cannot authenticate a package.
- `pnpm verify` includes `packages/ts/test/package-smoke.mjs`, npm pack dry-runs, and `scripts/run-scoped-daemon-smoke.mjs`.
- Each package dry-run ultimately uses `npm pack --dry-run` to inspect the publish tarball without uploading it.
- Run `pnpm audit --audit-level moderate` and `govulncheck ./...` from `packages/go` before opening the repository.
- The manual `release` workflow runs `pnpm check:changelog`, `pnpm verify`, `pnpm go:race`, and npm pack dry-runs for the TypeScript and JavaScript standalone packages.
- The `Prepare immutable npm release` workflow builds and tests the exact dispatch commit from `main` without OIDC authority. A separate fresh job creates a draft, binds its original source and package digests in an Actions-attested manifest, and attaches the original artifacts before the release is published.
- The `Publish npm packages` workflow validates the immutable published release, GitHub release/asset attestations, expected producer workflow, original commit, run attempt and stored package bytes. It transfers only verified data to a fresh npm runner with no repository checkout, rebuild, dependency installation or package lifecycle scripts.
- A normal `YYYY.M.D-N` release publishes all three npm packages. A `unity/com.romanilyin.canonicalpath/YYYY.M.D-N` release publishes only the Unity package.
- A manual retry must run from `main` and name an existing immutable published non-prerelease release created by the new preparation pipeline. It always downloads the original release assets. Matching packages already present on npm are skipped only when registry integrity matches the original tarball and `latest` still points to that version. Mutable historical releases, missing provenance, changed digests and rollbacks are rejected.
- The `codeql` workflow is enabled for `pull_request`, `push` to `main`, and `workflow_dispatch`.
- The TypeScript package must build `dist` declarations and runnable ESM exports for `.`, `./canonicalpath`, `./canonicalfs`, and `./unity-gateway`.
- The Unity package tarball must include `Runtime`, `Tests`, `README.md`, `CHANGELOG.md`, committed package-local `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` files with their Unity `.meta` files.
- The Go `canonicalfs` daemon remains the filesystem security boundary. `CanonicalPath` is lexical-only, and TypeScript/Unity helpers must not claim TOCTOU-proof filesystem security.

## npm Trusted Publishing

Configure a separate npm trusted publisher for each package because npm permits only one trusted publisher per package:

- `@romanilyin/canonicalpath`
- `@romanilyin/canonicalpath-standalone`
- `com.romanilyin.canonicalpath`

Use the same settings for all three npm package entries:

```text
Provider: GitHub Actions
Organization or user: romanilyin
Repository: canonicalpath
Workflow filename: publish-npm.yml
Environment name: npm-immutable
Allowed actions: npm publish
```

The workflow uses GitHub-hosted runners, pinned Node `24.18.0` and npm `11.16.0`, `id-token: write`, and the GitHub `npm-immutable` environment. Pinning the toolchain stabilizes preparation; retries reuse the stored original tarballs and never rely on a rebuild being reproducible. No `NPM_TOKEN` secret is required. Before the first automated publication, configure required reviewers on the `npm-immutable` environment and GitHub tag rules that prevent updates or deletion of normal release tags and `unity/com.romanilyin.canonicalpath/*` tags. After a successful trusted publication, npm recommends setting each package's publishing access to require 2FA and disallow token-based publishing.

## Immutable release preparation and recovery

### Establish the trust policy before the first new release

Enable [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) in the repository before publishing any new draft. Keep `main` and both full and Unity release-tag patterns protected against unreviewed changes, force-pushes and deletion. Require reviewers for the `release` environment used by draft preparation and the `npm-immutable` environment used by publication. Restrict the `release` environment to `main`; allow only the intended `main`/release refs for `npm-immutable`. Replace each package's existing trusted-publisher binding with exactly this repository, `publish-npm.yml`, and the new `npm-immutable` environment. Remove the previous `npm` environment binding by replacing that configuration; do not retain a second legacy publication path. The preparation workflow must not be added as an npm trusted publisher.

These settings are prerequisites managed outside the repository. The code does not enable them or assume they are enabled. Publication fails if the release API does not report `immutable: true`, release/asset attestation verification fails, Actions provenance is absent, the original successful producer attempt cannot be retrieved, or any identity/digest is different.

Perform the authorization cutover in this order, without publishing a package during the change:

1. Stop approving the legacy `npm` environment and leave old runs/drafts unapproved.
2. Create/protect `npm-immutable` with required reviewers, prevention of self-review where available, and the intended branch/tag deployment restrictions. Protect the `release` environment for preparation from `main` as well.
3. Edit the **existing** GitHub Actions trusted publisher for each of `@romanilyin/canonicalpath`, `@romanilyin/canonicalpath-standalone`, and `com.romanilyin.canonicalpath`. Set owner `romanilyin`, repository `canonicalpath`, workflow filename `publish-npm.yml`, environment `npm-immutable`, and permission to publish. Confirm all three saved entries use the new environment and none still authorizes the old `npm` identity. A GitHub environment rename alone does not change npm's binding.
4. Enable repository release immutability and verify the main/tag protection rules. Resume only the new preparation/publication path. Keep legacy runs and any release using pre-fix workflow code blocked; do not use a PAT or token fallback to bypass a failed provenance/OIDC check.

Review the new workflow and helpers on protected `main` before establishing the first baseline. A manually supplied digest, a freshly rebuilt archive, an asset named “attestation”, or a manifest with unverified workflow fields is not a trusted historical baseline. The signed manifest is accepted only when GitHub CLI verifies its repository, exact `prepare-npm-release.yml` signer path, workflow/source SHA, `refs/heads/main`, and GitHub-hosted runner identity. Its producer run must be the matching successful `workflow_dispatch` attempt in the same repository ID. The separate GitHub release attestation proves that the release tag and uploaded assets were locked together; it is not a substitute for Actions producer provenance.

A `release.published` event loads the workflow version at the release source commit. For that reason, preparation requires the supplied `source_commit` to equal the immutable `github.workflow_sha` of the dispatch on `main`. Preparing an older source commit under a newer preparation workflow is refused. Existing saved Actions runs and new releases pointing to pre-fix commits also retain the old workflow code. The new publisher therefore uses a distinct `npm-immutable` environment. Updating all three npm trusted-publisher entries from the old `npm` binding to `npm-immutable` is a mandatory administrative cutover: after that change, old workflow code cannot obtain publication authority through the previous environment identity. Until the old binding is replaced, the old authorization still exists outside this repository. Do not approve or rerun pre-fix publication runs, and configure required reviewers and permitted refs on the new environment before the first publication. Reviewers must check the workflow SHA, not only the filename; changing repository files alone cannot revoke a historical workflow's authorization.

### Prepare and publish a new version

1. Choose a new calendar version, update the relevant package versions and release notes, merge to protected `main`, and run the release gates above. A full release requires the same version in all three npm packages; a Unity-only release checks the Unity package version.
2. Dispatch `prepare-npm-release.yml` from `main` with `release_tag` and the full 40-character `source_commit` for that same main workflow commit. Valid tags are `YYYY.M.D-N` and `unity/com.romanilyin.canonicalpath/YYYY.M.D-N`. A race with a newer main commit causes a safe failure; inspect the new commit and dispatch again with its exact SHA.
3. The read-only build job checks the exact checkout, main ancestry, versions, licenses and relevant JavaScript build/tests, then packs once. It has no OIDC or npm publishing permission. A fresh `release` job checks the transferred bytes, refuses an existing release/tag, creates a new unpublished draft, creates `release-manifest.json`, signs the manifest with Actions artifact attestation and uploads the manifest and tarballs without replacement. Its OIDC identity is for the preparation workflow, which npm must not trust.
4. Wait for the entire preparation run to succeed. Review the draft's source SHA, release ID, manifest, expected package set and assets. The manifest fixes repository name/ID, release ID/tag, source commit, producer workflow SHA/run/attempt, and every package's name/version/filename/size/SHA-256/SHA-512 integrity. The draft must contain only that manifest and one or three package archives; additional release assets require a reviewed schema/policy change.
5. Publish the completed draft using an authorized human GitHub session after confirming immutability is enabled. The workflow leaves the draft unpublished intentionally: [events created by `GITHUB_TOKEN`](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow) generally do not start other workflows. No PAT is introduced. Publishing from a human session triggers `publish-npm.yml`; if necessary, manually dispatch that publisher from `main` for the same immutable release.
6. Approve the `npm-immutable` environment only for the reviewed new workflow SHA. The publisher checks every original asset and both provenance layers, then passes a same-run immutable artifact ID and digest outputs to a fresh runner. The npm runner rechecks manifest/tarball digests and package metadata, uses private empty npm configuration, checks all target versions before publishing any, verifies Trusted Publishing access, and publishes original tarballs with lifecycle scripts disabled.

GitHub CLI must support [`gh release verify`](https://cli.github.com/manual/gh_release_verify), [`gh release verify-asset`](https://cli.github.com/manual/gh_release_verify-asset), and [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify) with signer/source policy flags. An unavailable command or verification service is a blocking error, never a reason to bypass provenance. Attestations use pinned `actions/attest`; see [GitHub artifact attestation documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

### Retry and partial publication

Dispatch only `publish-npm.yml` from `main`, supplying the original `release_tag`. There is no build or pack step in this workflow. The retry reads the already locked release assets; temporary Actions build-artifact retention does not change those original bytes. Preserve the release assets, Actions attestations and original producer-run identity for as long as retry support is required.

All packages are preflighted before publication begins. An existing version with the original integrity and matching `latest` is skipped. A missing version still requires an independent lookup of the package's current `latest`: it remains pending only when npm reports the package absent, or `latest` is a strictly older supported calendar version. Comparison is numeric across year, month, day and release sequence. Equal/newer `latest`, unsupported versions, a conflicting existing version, malformed registry response, non-404 failure or unavailable registry aborts the attempt before any package is published. A failed old release therefore cannot overwrite the `latest` tag of a newer release merely because its original version was never published. Publication of several npm packages is not atomic: if npm accepts one package and a later request fails, the next attempt performs the same complete checks and publishes only the still-missing original packages. The workflow concurrency group serializes these attempts; administrators must also prevent concurrent publishers outside this workflow from racing the registry preflight.

Do not repack, recalculate an accepted historical baseline, overwrite assets, move tags or republish a conflicting npm version to recover. Missing original assets/provenance, a deleted producer run, a mutable historical release or an incomplete failed draft require investigation and a new version from the repaired main branch. An abandoned draft is not automatically deleted or reused. Existing npm versions and their consumers remain intact; the new fail-closed retry policy does not authenticate older releases retroactively.

Local regression coverage includes full and Unity-only originals, lightweight/annotated tag resolution, tag movement, mutable/missing/changed assets, source/repository/release/producer mismatches, signature-command failure, failed or forked producer attempts, partial publication, registry conflicts and rollback prevention. These fixtures do not claim to test the external repository settings, GitHub signature infrastructure or live npm publication; those remain an authorized release-integration gate.

## Local Publishing Secrets

Local fallback npm commands use a root `.env` file that is ignored by git. Disabled signed helpers never read this file. These credentials are not used by the GitHub Actions trusted-publishing workflow:

```text
NPM_TOKEN=npm_...
UPM_CLI_PATH=/absolute/path/to/verified/upm
UPM_ORGANIZATION_ID=...
UPM_SERVICE_ACCOUNT_KEY_ID=...
UPM_SERVICE_ACCOUNT_KEY_SECRET=...
```

Build and pack unsigned artifacts before invoking the local token wrapper: it disables all npm lifecycle scripts, removes publication/signing secrets from the npm child environment, and cleans its temporary userconfig on normal success and failure. Use `pnpm ts:build`, `pnpm js:standalone:build`, and `npm pack` in the selected package before publishing its tarball.

Use the unsigned local helper only with prebuilt artifacts, or use the normal isolated GitHub release workflow. The signed commands below are retained as fail-closed compatibility entrypoints; they reject before credentials, UPM, archives or npm are accessed.

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

Provision a private per-launch token and TLS certificate bundle with `canonicalfs-bootstrap`, then start the daemon with `-token-file`, `-tls-cert`, `-tls-key` and an explicit `-allow-root`. See [authenticated bootstrap and client settings](daemon-tls-bootstrap.md) for Unix/PowerShell examples and trust distribution.

Clients should call `/v1/projects/open` with a known `project_id` and then use project-relative `/v1/fs/*` or scope-relative `/v1/scoped/*` requests. Do not send arbitrary absolute paths as file-operation payloads.

Go packages require Go 1.25+ as of `2026.10.10-3` for the patched Windows ACL dependency. The daemon accepts `-token-file` or `CANONICALFS_DAEMON_TOKEN`, and requires at least 32 token characters. The embedded RPC constructor enforces the same minimum and header safety policy. On Unix, token files must be owner-only and owned by the daemon's effective UID; unknown ownership is rejected. A root daemon does not trust a different UID merely because its file is mode 0600. Provision the token as the service account, and keep the configured path and parent directories under trusted administrator/service control. Ownership and mode are read from the same opened descriptor used for token bytes; parent-directory and symlink-origin checks are not performed. Other non-Windows platforms without supported ownership metadata reject token files; the environment-token option remains available. On Windows, the opened file must have a private DACL granting access only to the daemon account, SYSTEM or Administrators; other applicable grants and NULL DACLs are rejected. Provision a private empty file before writing a token. The `-token` flag has been removed so the capability cannot appear in process arguments. Loopback is reachable by other local processes and still requires an unpredictable bearer token.

Every listener, including loopback, requires both `-tls-cert` and `-tls-key` and TLS 1.2 or later. Clients verify chain, hostname and an out-of-band pin before sending bearer credentials. Allowed roots are opened once during trusted daemon bootstrap; requested descendants are opened relative to those handles. A moved allowed directory remains bound to its original handle. Registrations default to 128 retained roots, IDs are capped at 128 bytes, and idle leases expire after 30 minutes on the next request. Configure `-max-projects` and `-project-idle-timeout` if needed.

ZIP extraction uses a separate destination root, rejects symlink destination components and archive links/special files, and defaults to 64 MiB compressed input, 1000 entries, 16 MiB per entry, 64 MiB total expanded output, a 1000:1 compression ratio, and 30 seconds. Path limits additionally default to 4096 bytes per raw entry/destination name, 64 components per output path (including the destination), 16384 cumulative path components, 4096 directories and 8192 total filesystem objects. Cumulative budgets count the destination once plus every member's normalized components; shared and already-existing prefixes count again. They conservatively bound work and possible output, rather than reporting unique new inodes. All path budgets are checked before any output directory is created, and directory walks check cancellation between filesystem operations. `ExtractZipWithLimits` accepts a context and explicit limits; zero limits select bounded defaults and negative limits are rejected. ZIP64 is refused before metadata allocation. Extraction is not transactional: a later I/O failure or cancellation can leave bounded directories and earlier completed entries; incomplete files are removed. Existing trees are not recursively rolled back.
