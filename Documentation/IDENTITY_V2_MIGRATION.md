# Identity v2 migration

This is an intentional change to lexical identity. Update cooperating ports together and inventory persisted identities before reuse. The libraries and the inventory tool do not rename user directories or existing worktrees.

## Git ref directories

`encodeGitRef` and its language equivalents now return `v2-<slug>--<sha256>`:

- Input is a nonempty sequence of valid Unicode scalar values, without NUL. Invalid UTF-8 in byte-string APIs and unpaired surrogates in UTF-16 APIs produce `ERR_INVALID_COMPONENT`. NUL remains `ERR_NUL_BYTE`.
- The hash is all 64 lowercase hexadecimal digits of SHA-256 over the complete, original UTF-8 encoding. Do not trim input, fold case, normalize Unicode, or hash the shortened slug. NFC and NFD refs remain distinct. This component encoder does not validate Git ref syntax.
- Replace runs outside ASCII `[A-Za-z0-9._-]` with `-`; trim boundary `.`, `_`, `-`; retain the first 80 ASCII characters; trim those boundary characters again; use `ref` for an empty slug.
- The output is at most 149 ASCII bytes. The `v2-` prefix is part of the directory identity. SHA-256 provides a 256-bit digest; the generic birthday collision work factor is approximately 2^128, not 2^256. The previous 48-bit suffix had roughly 2^24 birthday collision work versus 2^48 for a specified target; these are different attacks.

Do not silently fall back to an existing legacy directory. A legacy directory name does not prove which exact ref owns its contents.

1. Pause writers that create or reuse ref-derived directories. Export the exact raw refs from authoritative Git/worktree/cache metadata as a JSON array of strings. Preserve case and Unicode bytes; do not reconstruct refs from slugs.
2. Run `node scripts/gitref-migration-inventory.mjs exact-refs.json > migration-review.json`. This read-only tool computes both legacy and v2 names, detects ambiguous names in the supplied inventory, and marks ownership as unverified. It does not inspect actual directories or provide proof that an incomplete inventory has no collisions.
3. Verify each existing directory against authoritative repository identity, exact ref, and recorded commit/object metadata. Check both source and destination; stop on conflicting ownership or missing metadata. Review platform path-length limits including the parent directory, not just the 149-byte component limit.
4. Migrate through the consuming application's supported worktree/cache operation with backup and an explicit rollback map. Update persisted keys and manifests together. Keep any old-name lookup as a separate, explicitly read-only migration path that verifies ownership before use.
5. Re-enable writers with v2 as the only creation format. Remove the temporary legacy reader after inventories and downstream consumers have migrated. Rollback must restore matching metadata and code together; it must not attach an existing directory merely because its slug matches.

## WSL project identities and host aliases

Only absolute POSIX candidates are eligible for WSL mapping; relative inputs and native Windows/UNC roots cannot be reinterpreted as a mounted drive. WSL mapping now resolves POSIX `.` and `..` before selecting a drive. `/mnt/c/../d/repo` becomes `d:/repo`; `/mnt/c/d/repo` remains `c:/d/repo`. `/mnt/c/../../repo` remains `/repo` in the portable profile and is rejected by the `win32-drive` profile. Disabled WSL mapping and the `posix` target retain POSIX semantics. File URI drive roots, Windows roots, and UNC roots retain their own root semantics. Configure a canonical absolute POSIX mount root; repeated separators in the configured root remain supported during matching.

Inventory persisted project identities, cache keys, and alias registries using the old and new normalizers. Revalidate changed rows against the actual project and environment. Do not merge two records or rebind a host root just because they previously shared one canonical key. Keep the original raw path as diagnostic data where needed, not as an unchecked I/O alias.

The TypeScript broker now accepts only absolute native `hostRoot` paths without `.` or `..` components, through default `hostRoot`, `aliases`, and `registerPathAlias`. URI roots are not native I/O roots. Validated Windows/WSL native strings are preserved for host use. `projectRoot` must also normalize to an absolute path. Re-register dot-containing aliases only after resolving and verifying the intended native directory in that environment. No automatic alias rewriting is performed.

## Swift Unicode identity

Swift equality, root/component containment, and WSL mount-prefix matching now compare exact UTF-8. Canonically equivalent strings such as `café` and `cafe` followed by U+0301 are different lexical paths. Rebuild any persisted Swift indexes that used string equality to merge those names; preserve the original byte identities and review conflicts. The shared vector runner also compares UTF-8 bytes, so it cannot hide an accidental normalization in a result.

These fixes do not resolve symlinks or authorize filesystem operations. Continue passing `project_id` and validated relative paths to CanonicalFS; physical containment and host filesystem behavior remain its responsibility.

## Verification

Run the shared lexical vectors in every supported runtime and the existing type/build gates. New cases cover WSL crossings, custom mounts, byte-distinct Unicode equality and containment, full-input GitRef hashing, bounded slugs, malformed encodings, and all broker alias-registration paths. Run `node --test scripts/gitref-migration-inventory.test.mjs` for the inventory utility. A missing toolchain or skipped platform is not a successful test; the release report must list it explicitly.
