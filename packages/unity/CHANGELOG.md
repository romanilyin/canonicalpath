# Changelog

## 2026.6.14-1

- Added Unity `.meta` packaging for synced `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` files so npmjs scoped-registry installs do not ignore legal assets from immutable package folders.
- Reused the same legal-file sync path for npm and optional signed Unity package flows.

## 2026.5.24-1

- Prepared the Unity package for npmjs scoped-registry installation as `com.romanilyin.canonicalpath@2026.5.24-1`.
- Added npm package metadata, explicit packed-file allowlist, and package-local changelog coordinates for Unity Package Manager consumers.
- Added npm prepack notice sync so `LICENSE.md`, `LICENSE.ru.md`, `NOTICE.md`, and their Unity `.meta` files are included in the published tarball without duplicating root legal files in source.
- Documented npm token based publication through a local ignored `.env` file.

Security note: Unity code is a lexical/client integration surface. Security-sensitive filesystem I/O should delegate to the Go CanonicalFS daemon unless a native root-bound implementation is separately reviewed and documented.
