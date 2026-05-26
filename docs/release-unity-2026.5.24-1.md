# Unity Registry Release Plan 2026.5.24-1

This is the working plan for publishing the Unity package to npmjs as a Unity Package Manager scoped-registry package. The current default publish path is an unsigned npm tarball; Unity 6.3+ will show `Signature: Missing` for that artifact. Optional Unity-signed UPM CLI tooling is kept for a later signed package version. Do not publish or tag until the package checks and final review pass.

## Scope

- Package: `com.romanilyin.canonicalpath`.
- Version: `2026.5.24-1`.
- Registry: `https://registry.npmjs.org/`.
- Unity manifest scope: `com.romanilyin`.
- Source directory: `packages/unity`.
- This release does not republish `@romanilyin/canonicalpath`, `@romanilyin/canonicalpath-standalone`, or the Go module.

## Unity Manifest

Consumers should resolve the package through npmjs with a Unity scoped registry:

```json
{
  "scopedRegistries": [
    {
      "name": "npmjs",
      "url": "https://registry.npmjs.org",
      "scopes": ["com.romanilyin"]
    }
  ],
  "dependencies": {
    "com.romanilyin.canonicalpath": "2026.5.24-1"
  }
}
```

## Prepared State

- `packages/unity/package.json` uses version `2026.5.24-1`.
- `packages/unity/package.json` includes npmjs `publishConfig`, repository metadata, keywords, packed-file allowlist, and `pack:dry-run`.
- `packages/unity/CHANGELOG.md` documents the Unity registry release.
- `packages/unity/README.md` documents npmjs scoped-registry installation.
- npm prepack sync includes root `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` in the default unsigned npm tarball.
- Optional signed tooling remains available: `scripts/pack-unity-signed.mjs` mirrors the same notice files before running `upm pack`, then removes unchanged synced copies after packing.
- Optional `pnpm unity:pack:signed` creates `tmp/unity-signed/com.romanilyin.canonicalpath-2026.5.24-1.tgz` and verifies that it contains `.attestation.p7m`.
- Root `.env` is ignored and reserved for local npm and Unity signing credentials.

## Pre-Publish Checks

Run before publishing:

```bash
pnpm unity:pack:dry-run
pnpm unity:canonicalpath:vectors
pnpm unity:bridge:vectors
pnpm unity:mcp:path-scopes:vectors
pnpm unity:canonicalfs:transport:smoke
pnpm unity:burst:surface
```

Run when local Unity Editors are available:

```bash
pnpm unity:editmode:matrix
```

Confirm npm token access without publishing:

```bash
pnpm unity:npm:ping
pnpm unity:npm:whoami
```

When UPM CLI and Unity service account credentials are available, create and verify the signed tarball without publishing:

```bash
pnpm unity:pack:signed
```

If `com.romanilyin.canonicalpath@2026.5.24-1` already exists in npmjs, choose a new package version before publishing a signed tarball. npmjs doesn't allow replacing the tarball for an existing version.

## Token Setup

Put the npm automation token in the ignored root `.env` file. The Unity signing credentials are only required for optional signed publication:

```text
NPM_TOKEN=npm_...
UPM_ORGANIZATION_ID=...
UPM_SERVICE_ACCOUNT_KEY_ID=...
UPM_SERVICE_ACCOUNT_KEY_SECRET=...
```

For signed publication, the Unity service account must belong to the signing organization and have the `Package Manager Package Signer` role. The helper `scripts/run-npm-with-env-token.mjs` creates a temporary npm userconfig for each command and removes it after the command exits. Do not commit `.env`, `.npmrc`, npm tokens, or Unity service account credentials.

## Publish

Publish only after checks pass and the release commit is reviewed:

```bash
pnpm unity:npm:publish
```

`pnpm unity:npm:publish` is currently the unsigned npm publish path and only needs `NPM_TOKEN`. It is equivalent to:

```bash
pnpm unity:npm:publish:unsigned
```

For a no-upload unsigned smoke, use:

```bash
pnpm unity:npm:publish:dry-run
```

For the optional signed path, use these commands after filling the Unity signing credentials:

```bash
pnpm unity:npm:publish:signed:dry-run
pnpm unity:npm:publish:signed
```

Verify after publication:

```bash
npm view com.romanilyin.canonicalpath@2026.5.24-1 version
npm view com.romanilyin.canonicalpath@2026.5.24-1 dist.tarball
```

## Tagging

Use a Unity-specific tag after the publish-ready commit is final:

```text
unity/com.romanilyin.canonicalpath/2026.5.24-1
```

Do not move existing source release tags such as `2026.5.18-2`.
