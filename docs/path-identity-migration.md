# Migrating stored path identities

The [path identity contract](path-identity-contract.md) distinguishes native POSIX input, legacy raw cross-host input, and already canonical strings. It also defines relative markers, complete extended roots, and one WSL mount-root normalization across ports.

Changing normalization can change a persisted key. Reconstruct a proposed new identity from the original raw input and its verified source context. **Do not apply the new raw normalizer to every existing canonical key or perform a global text replacement.** A previously lost distinction cannot be recovered from the merged string alone.

This guide concerns lexical identities and package API compatibility. It does not move files, determine that two paths refer to the same file, or grant access through CanonicalFS.

## Determine which values are affected

Inventory the places where path strings participate in identity: primary or unique keys, caches, deduplication, serialized references, root/alias records, and relative paths. Keep raw input, canonical strings, host paths, and URI text distinguishable in that inventory.

The following examples show why a string-only rewrite is insufficient:

| Original input/context | Earlier behavior | Current behavior |
| --- | --- | --- |
| Native POSIX `/repo/a\b` | Could merge with `/repo/a/b` | Retains one component `a\b` |
| Native POSIX `/C:/repo`, portable/default profile | Could become Windows `c:/repo` | Remains POSIX `/C:/repo` |
| Native POSIX relative `C:/repo` | Could become Windows `c:/repo` | Becomes relative `./C:/repo` |
| Native POSIX relative `C:foo` | Rejected as drive-relative | Becomes `./C:foo` when explicit policies allow it |
| Native POSIX URI-like text | Could be decoded or rejected as a scheme | Slash-delimited component data |
| Preserved `//?/UNC/server/share/a/../..` | Could remove `share` | Clamps at `//?/UNC/server/share` |
| Preserved drive with `win32-drive` profile | Could be rejected by a prefix test | Accepted as an extended drive root |
| Empty mount root | Port-dependent result | `/mnt` on every port |
| Mount root containing dots/repeated slash | Different behavior between mapping directions | One normalized POSIX mount root |
| UNC passed to `toPOSIX` or `toWSL` | Could be returned as a slash string | Explicit `ERR_INVALID_PATH` |

Some affected inputs were previously errors and therefore may have no old key. Others may already have collided. For example, the saved key `/repo/a/b` cannot reveal whether the original native name was `a/b` or `a\b`.

## Preserve evidence before recomputing keys

Retain the existing identity and references while preparing a comparison. For each candidate, record:

- A stable record identifier and its old canonical string.
- The original raw path or raw bytes, if available.
- The originating host/input format and the normalization options used at that time.
- The intended root kind, whether the path was absolute or relative, and any explicit WSL mount configuration or host alias.
- A proposed new string or exact error code, together with the evidence used to choose the input grammar.

The current machine's OS is not evidence of the input's original grammar. A drive-like prefix, literal backslash, URI-like text, or old canonical key alone must not be used to guess the source.

If original input or authoritative context is missing, retain the record for manual resolution. Do not manufacture a missing slash, backslash, drive, share, or relative marker from an ambiguous old value.

### Recompute from the original input

Use the original raw input with the correct explicit grammar:

```ts
const proposed = normalize(originalRawPath, {
  sourceHost: "posix",
  targetProfile: "posix",
});
```

Use canonical mode when reading a value that is already a valid canonical identity:

```ts
const saved = normalize(storedCanonicalPath, { sourceHost: "canonical" });
```

The second call validates/cleans canonical grammar. It does not recover information lost by an older raw normalizer. The fact that a stored string is accepted in canonical mode is not proof that it represents the original input correctly.

Review old contradictory or overloaded options rather than copying them mechanically. In particular:

- `sourceHost: "posix"` with `wsl.enabled: true` now fails. Verify whether the intended identity was native POSIX or an explicitly mapped Windows drive before selecting the appropriate mode.
- URI allowance flags no longer cause native POSIX mode to decode URI-like text. If the original data was a URI, keep that transport fact explicit and decode exactly once through a URI-capable entry point. Select the decoded path's grammar separately where the API exposes that boundary.
- Explicit `rejectADS` and `rejectDeviceNames` policies remain restrictions in native POSIX mode. Do not disable them merely to obtain a proposed key.
- Old empty or noncanonical mount configuration must be interpreted with its verified original meaning; the new empty default is always `/mnt`.

## Audit collisions and references

Produce a comparison without overwriting the old keys. Group candidates by both old and proposed identities so the review can detect:

1. Multiple original inputs that previously shared one old key but now need different identities.
2. Multiple records that propose the same new key.
3. References whose proposed target no longer matches their root, relative path, or alias context.
4. Inputs that now produce a deliberate error, including unsupported POSIX double-root forms and lossy host conversions.
5. Records whose source input cannot be established.

A shared proposed string does not by itself authorize merging records, files, projects, or caches. Resolve each conflict using authoritative ownership and source information. An old merged record may need to be split or reconstructed; a database rewrite alone cannot recreate content or references that were already overwritten.

Keep a reviewable mapping from stable record identifiers and old keys to the accepted new identities. Apply accepted changes together with their dependent references under the storage system's consistency controls. Preserve the evidence and conflict decisions needed to explain each changed identity.

## Preserve canonical syntax in storage

The relative marker is meaningful:

```text
./c:/repo -> relative component c:, then repo
c:/repo   -> Windows drive c, then repo
```

Do not strip `./` from a saved canonical relative path. `join` removes the marker when embedding those components below a known root, including a Windows root; it does not reinterpret the child as a new drive.

Do not replace every backslash with slash in a persisted canonical value. POSIX `/repo/a\b` and `/repo/a/b` are different component sequences. JSON and programming-language string escaping may display `\` as `\\`; that transport escaping is not a CanonicalPath component-encoding scheme.

Store and compare the exact string, including Unicode form. Do not lowercase full paths, normalize NFC/NFD, percent-decode saved strings, or discard preserved extended prefixes as part of this migration.

Leave `trimOuterWhitespace` disabled when reading saved identities. This legacy option preprocesses external input; repeating it after dot cleanup can remove whitespace that has become the start of the string. For example, native `a/../ b` with trimming enabled becomes ` b`, then becomes `b` on the next call. If an older pipeline trimmed input, retain that fact with its raw-input evidence rather than applying trimming again to the saved key.

## Review host serializers and mount configuration

`toPOSIX` rejects every Windows root. `toWin32` rejects POSIX absolute paths and relative data that cannot be represented without changing its interpretation. `toWSL` maps only an ordinary Windows drive and rejects UNC/preserved extended roots.

Handle these errors with an explicit, verified mapping decision. Replacing a failing serializer with slash substitution, adding a drive heuristically, or treating an UNC string as a POSIX directory would recreate an identity ambiguity.

A preserved extended prefix follows CanonicalPath's lexical rules; it is not a promise of Windows verbatim parsing. If the desired canonical identity should be unwrapped, perform that normalization decision explicitly from the known Windows input and review the resulting key change.

The extended UNC namespace marker must be exactly `UNC`. Lowercase or mixed-case variants are errors, even if older raw handling happened to produce a string from them. Do not repair an ambiguous stored namespace by blindly changing its case. Verify the original Windows input and intended root first. Uppercase drive letters remain accepted by host serializers; canonical normalization still stores the drive in lowercase.

Normalize and validate the same `mountRoot` in both directions:

- Missing/empty means `/mnt`; `/` remains `/`.
- Dot segments and repeated slash are cleaned at the POSIX root floor.
- Exactly two leading slashes, relative paths, Windows paths, and NUL are rejected.
- Backslash remains literal POSIX data.
- A mapped tail containing literal backslash is rejected instead of becoming a different Windows path.

In enabled raw WSL mode, a single leading slash or three-or-more leading slashes selects POSIX candidate grammar. Exactly two retain raw UNC/extended interpretation. A `posix` target profile disables mapping only; it must not trigger Windows separator rewriting. For example, `///mnt/c/a\b` stays `/mnt/c/a\b` with that profile.

Check that URI provenance comes from the input's actual syntax. A `vscode-file-uri` source label alone does not exempt a non-URI `/C:/drives/c/repo` from a configured `/C:/drives` mount. An actual decoded `file:///C:/...` drive retains the separate URI-derived rule.

Recheck round trips using the actual configured mount. For example, ordinary drive `c:/repo` with mount `/` must serialize to `/c/repo` and map back to `c:/repo`.

## C options and ABI layout

`canonicalpath_wsl_options` now contains:

```c
typedef struct canonicalpath_wsl_options {
    int enabled;
    const char *mount_root;
    size_t mount_root_len;
} canonicalpath_wsl_options;
```

**This changes the binary layout** of that structure and of structures embedding it, including `canonicalpath_normalize_options`. Rebuild the library, callers, and FFI bindings together against the updated header. Mixing an old compiled options layout with the new library is unsupported. Update foreign structure sizes, alignment, and field offsets; use the target platform's `size_t` representation.

Initialize the complete normalization options through `canonicalpath_normalize_options_init`. It initializes the new length field and preserves defaults such as encoded-separator rejection. Zero-initialize a standalone WSL options structure before assigning fields. Assigning only the formerly existing fields to an otherwise uninitialized structure leaves an invalid length value.

```c
canonicalpath_normalize_options options;
canonicalpath_normalize_options_init(&options);

static const char mount[] = "/mnt\\vol";
options.source_host = "wsl";
options.wsl.enabled = 1;
options.wsl.mount_root = mount;
options.wsl.mount_root_len = sizeof(mount) - 1; /* Exclude the terminator. */

canonicalpath_wsl_options standalone_wsl = {0};
standalone_wsl.mount_root = mount;
standalone_wsl.mount_root_len = sizeof(mount) - 1;
```

A nonzero `mount_root_len` is the complete number of input bytes, excluding a terminating NUL. The library rejects embedded NUL within those bytes. Use the original length from a length-delimited source; calculating `strlen` first would hide bytes after an embedded NUL.

A zero length retains legacy NUL-terminated-string handling. Null/empty mount input with zero length uses `/mnt`; a null pointer with a nonzero length is invalid. This compatibility convention does not make a zero-length declaration capable of detecting hidden trailing bytes. The `_n` entry point's main path length and `mount_root_len` describe different inputs and both need the correct length.

## Godot input before String conversion

Godot's String conversion can replace or otherwise lose input that cannot be represented faithfully, including embedded NUL. Validating the converted String cannot recover the original bytes. Validate byte-oriented input with the public API before conversion:

```gdscript
var decoded := CanonicalPath.from_utf8(payload_bytes)
if not decoded.ok:
    return decoded
return CanonicalPath.normalize(decoded.value, {"sourceHost": "posix"})
```

`from_utf8(PackedByteArray)` returns the standard tagged result. It rejects NUL with `ERR_NUL_BYTE` and malformed UTF-8 with `ERR_INVALID_PERCENT_ENCODING`. That latter name is the existing decoder error taxonomy, also used by URI decoding. Genuine UTF-8 for U+FFFD remains valid and is preserved; a replacement character is not proof of invalid original bytes.

Pass a byte-oriented mount directly rather than converting it first:

```gdscript
var result := CanonicalPath.to_wsl_result(
    "c:/repo",
    {"mountRoot": PackedByteArray([0x2f, 0x6d, 0x6e, 0x74])}
)
```

`mountRoot` accepts either a valid String or a `PackedByteArray`. Byte input goes through the same production decoder before POSIX mount validation. String-only callers retain the String API, but cannot claim to detect bytes already lost during earlier conversion. Preserve the original payload when investigating a historical replacement-character collision.

## Verify the proposed identities

For each accepted proposed identity, check canonical-mode idempotence and exact string equality with outer trimming disabled. For an absolute path and a supported same-root target, check that `join(root, relative(root, target))` reproduces the target. Check native same-options idempotence with trimming disabled where native mode is used, both directions of each configured WSL mapping, and explicit failure of lossy host conversions. Treat any configured raw-input trimming as a separate preprocessing decision.

Retain tests that show strict raw filesystem validators still reject their prohibited inputs. A passing canonical lexical example does not authorize passing the same raw string to a filesystem operation.

Repository verification commands are:

```bash
pnpm verify
pnpm go:race
pnpm rust:verify
```

`pnpm verify` already includes the required Rust gate; the last command is useful when checking that part independently. It runs runner checks, Rust unit/documentation tests, and shared vectors. Missing or broken Cargo and any failed Rust subprocess are verification failures, not optional skips. Keep the toolchain available for local and automated verification.
