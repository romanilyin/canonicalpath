# Changelog

## 2026.10.10-2

- Reject malformed UTF-16 Git refs with `ERR_INVALID_COMPONENT`, preserving valid supplementary characters and existing directory encodings.
- Verify the shared exact UTF-16 vectors in the installed Unity EditMode matrix.

## 2026.10.10-1

- All bridge editor write commands now support dry-run only; non-dry-run calls throw until a root-confined executor is provided.
- Scoped daemon operations use pinned scope roots and reject cross-scope links and anchor replacements.
- Reject malformed UTF-8 URI escapes while preserving valid Unicode and exactly-once decoding.
- Harden npm registry selection and validate package identity before trusted publication.

## 2026.10.9-1

- Text reads now require a registered scoped Go CanonicalFS daemon client, with a 4 MiB byte cap and 1,048,576 character cap.
- Reject alternate data streams in legacy Unity asset paths and bound HTTP response allocation.
- Harden local npm and UPM publication/signing credentials.
- Validate against installed Unity editors, including the 7000 alpha series.


## 2026.6.19-1

- License files are now committed inside the Unity package and include Unity `.meta` files; package licensing remains Stinger Royalty-Free EULA 1.0.

## 2026.6.14-1

- Added Unity `.meta` packaging for package-local `LICENSE.md`, `LICENSE.ru.md`, and `NOTICE.md` files so npmjs scoped-registry installs do not ignore legal assets from immutable package folders.
- Reused the same legal-file verification path for npm and optional signed Unity package flows.

## 2026.5.24-1

- Prepared the Unity package for npmjs scoped-registry installation as `com.romanilyin.canonicalpath@2026.5.24-1`.
- Added npm package metadata, explicit packed-file allowlist, and package-local changelog coordinates for Unity Package Manager consumers.
- Added npm prepack legal-file verification so `LICENSE.md`, `LICENSE.ru.md`, `NOTICE.md`, and their Unity `.meta` files are included in the published tarball.
- Documented npm token based publication through a local ignored `.env` file.

Security note: Unity code is a lexical/client integration surface. Security-sensitive filesystem I/O should delegate to the Go CanonicalFS daemon unless a native root-bound implementation is separately reviewed and documented.
