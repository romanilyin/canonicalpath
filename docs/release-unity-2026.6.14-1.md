# Unity Registry Release Plan 2026.6.14-1

This is the working plan for publishing the Unity package to npmjs as a Unity Package Manager scoped-registry package. This release uses the unsigned npm tarball path only; `upm` signing is intentionally not part of this release.

## Scope

- Package: `com.romanilyin.canonicalpath`.
- Version: `2026.6.14-1`.
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
    "com.romanilyin.canonicalpath": "2026.6.14-1"
  }
}
```

## Prepared State

- `packages/unity/package.json` uses version `2026.6.14-1`.
- `packages/unity/package.json` includes npmjs `publishConfig`, repository metadata, keywords, packed-file allowlist, and `pack:dry-run`.
- `packages/unity/CHANGELOG.md` documents the Unity registry release.
- `packages/unity/README.md` documents npmjs scoped-registry installation.
- npm prepack verifies committed package-local `LICENSE.md`, `LICENSE.ru.md`, `NOTICE.md`, and their Unity `.meta` files in the default unsigned npm tarball.
- Optional signed tooling remains available but is not used for this release.
- Root `.env` is ignored and reserved for local npm credentials.

## Pre-Publish Checks

Run before publishing:

```bash
pnpm unity:pack:dry-run
pnpm check:licenses
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

If `com.romanilyin.canonicalpath@2026.6.14-1` already exists in npmjs, choose a new package version before publishing. npmjs does not allow replacing the tarball for an existing version.

## Token Setup

Put the npm automation token in the ignored root `.env` file:

```text
NPM_TOKEN=npm_...
```

The helper `scripts/run-npm-with-env-token.mjs` creates a temporary npm userconfig for each command and removes it after the command exits. Do not commit `.env`, `.npmrc`, npm tokens, or command output that contains tokens.

## Publish

Publish only after checks pass and the release commit is reviewed:

```bash
pnpm unity:npm:publish
```

For a no-upload unsigned smoke, use:

```bash
pnpm unity:npm:publish:dry-run
```

Verify after publication:

```bash
npm view com.romanilyin.canonicalpath@2026.6.14-1 version
npm view com.romanilyin.canonicalpath@2026.6.14-1 dist.tarball
```

## Tagging

Use a Unity-specific tag after the publish-ready commit is final:

```text
unity/com.romanilyin.canonicalpath/2026.6.14-1
```

Do not move existing source release tags such as `2026.5.18-2`.
