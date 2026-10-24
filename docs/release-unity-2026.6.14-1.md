# Unity Registry Release Plan 2026.6.14-1

Historical package plan. Its local token and signed publication procedures have been retired. Use the current [immutable GitHub OIDC release process](release-process.md) for future releases; the old local npm aliases now refuse without reading credentials or invoking npm.

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
- The former optional local signed tooling is now disabled.
- Root `.env` remains ignored; current tooling does not use it for publication.

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

## Publication procedure superseded

The former token setup and local publication commands in this plan no longer apply. All local token-based `unity:npm:*` aliases, including ping, whoami and dry-runs, refuse before credential access or publisher execution. Local signing helpers also remain disabled.

Use the current [release process](release-process.md), including its original-artifact verification and OIDC authorization. Credential-free `pnpm unity:pack:dry-run` remains available for local tarball inspection. Do not reuse historical release versions or move their tags.

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
