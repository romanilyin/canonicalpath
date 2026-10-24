# Path identity contract

CanonicalPath represents lexical identity with an explicit input grammar and a deterministic canonical string. It does not inspect a filesystem, resolve symlinks, choose a working directory, or authorize I/O. CanonicalFS and the strict raw path validators retain those separate responsibilities.

The normative rules and cross-language vectors live in [the shared spec](../spec/README.md) and [its schema](../spec/canonical-path.schema.json). This guide explains the public contract. For existing stored identities, use [the migration guide](path-identity-migration.md) before changing keys.

## Choose the input grammar

The historical option name is `sourceHost`, but `canonical` describes an input format rather than a physical host.

| Input | `sourceHost` | Interpretation |
| --- | --- | --- |
| Native POSIX path | `posix` | Only `/` is a separator. Backslash, colon, question mark, hash, percent text, and URI-like component text remain data. |
| Saved canonical string | `canonical` | Parse canonical roots and components. Clean dot segments and canonical separators, and fold a Windows drive letter. Do not decode a URI, rewrite backslashes, apply WSL mapping, or unwrap an extended prefix. |
| Raw Windows or existing cross-host input | Omitted or the existing raw modes | Use the legacy Windows/POSIX/URI grammar and explicitly enabled mapping. URI parsing requires its allowance flag. |

`win32`, `wsl`, `vscode-file-uri`, `dev-container`, and `ssh-remote` remain raw cross-host modes. A container or remote-host label does not select native POSIX grammar. Choose `posix` when that grammar is required.

All modes reject NUL and empty input. Only an explicitly enabled `trimOuterWhitespace` option trims outer whitespace. Components retain their spelling, case, and Unicode representation; NFC and NFD remain distinct. Only an actual Windows drive letter is lowercased.

Keep trimming disabled when storing or reading canonical identities. The legacy trimming option is preprocessing for external input and can make repeated normalization change a value: `a/../ b` becomes ` b`, then `b` on a second call with trimming enabled. Idempotence guarantees use the default of no outer trimming. A saved string does not record that preprocessing has already happened.

```ts
import {
  isEqual, join, normalize, relative, toPOSIX,
} from "@romanilyin/canonicalpath";

const root = normalize("/repo", { sourceHost: "posix" });
const path = normalize(String.raw`/repo/a\b`, { sourceHost: "posix" });
// path contains one component named a\b below /repo.

const restored = normalize(path, { sourceHost: "canonical" });
const child = relative(root, restored); // String.raw`a\b`
join(root, child) === restored;         // true
toPOSIX(restored) === path;            // true
isEqual(path, "/repo/a/b", { sourceHost: "canonical" }); // false
```

A raw-input normalizer is not an automatic reader for every saved identity. Feeding the POSIX value above back through legacy auto mode would interpret its backslash under a different grammar. Persist canonical strings and read them through canonical mode or canonical operations.

### Native POSIX roots

`/C:/repo` is POSIX absolute, with a literal `C:` component. It remains `/C:/repo`; its letter is not folded and its leading slash is not removed.

Exactly two leading slashes are rejected with `ERR_INVALID_PATH` in native POSIX mode. POSIX permits an implementation-defined interpretation for that form, which this contract does not represent. Three or more leading slashes collapse to one POSIX root. Repeated separators inside the path are cleaned. See [POSIX pathname resolution](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html).

This distinction is intentional:

```text
normalize("//server/share", sourceHost=posix)     -> ERR_INVALID_PATH
normalize("//server/share", sourceHost=canonical) -> //server/share (UNC)
normalize("///repo", sourceHost=posix)            -> /repo
```

## Canonical roots and relative markers

| Root kind | Canonical example | Atomic root |
| --- | --- | --- |
| POSIX | `/repo/file` | `/` |
| Windows drive | `c:/repo/file` | `c:/` |
| UNC | `//server/share/file` | `//server/share` |
| Preserved extended drive | `//?/c:/repo/file` | `//?/c:/` |
| Preserved extended UNC | `//?/UNC/server/share/file` | `//?/UNC/server/share` |
| Relative | `src/file`, `.` | No absolute root |

Components contain neither slash nor NUL. A literal backslash is supported in POSIX and relative components. A Windows-rooted canonical string cannot contain a literal backslash component; normalize a raw Windows path before passing it to a canonical API.

UNC server and share are both required and cannot be `.` or `..`. A share named `?` is lexical data; server `?` is reserved by extended-prefix syntax. Extended Windows roots are parsed before ordinary UNC. Their `UNC` marker must be exactly uppercase: `//?/unc/...`, mixed-case spellings, and their raw backslash equivalents are rejected, including with prefix preservation enabled. Unknown or incomplete extended namespaces are also rejected.

### Why some relative paths start with `./`

A relative first component beginning with an ASCII letter and colon needs an explicit marker. Without it, the same string would denote a Windows drive or drive-relative path.

| Native POSIX input | Canonical result |
| --- | --- |
| `C:/repo` | `./C:/repo` |
| `C:foo` | `./C:foo` |
| `x/../C:foo` | `./C:foo` |
| `./C:/repo` | `./C:/repo` |
| `C:/../repo` | `repo` |

The marker is selected after component cleanup and is part of canonical serialization. A required marker survives native and canonical normalization. An unnecessary marker, such as `./safe`, is removed. The literal `C:` is not lowercased.

`./c:/repo` and `c:/repo` are distinct canonical identities: the first is relative and the second has a Windows drive root. Do not remove the marker when saving or comparing strings. No percent-encoding convention is introduced.

## Canonical operations

`relative`, `join`, and host serializers consume canonical grammar directly. They do not accept raw Windows separators as an alternative grammar and do not decode URI text. Normalize raw input first.

`relative(root, target)` requires cleaned canonical absolute paths. It compares complete roots and exact components. Prefix siblings and other roots produce `ERR_OUTSIDE_ROOT`; a matching string prefix is insufficient. A preserved extended root and an ordinary root are not implicitly aliases.

The returned relative path receives a marker if needed. `join` removes that marker when embedding its components below an absolute root, or emits it again if the resulting path is relative and needs one. The marker conveys relative syntax, not a POSIX-only host tag:

```text
relative(/repo, /repo/C:foo)              -> ./C:foo
join(/repo, ./C:foo)                     -> /repo/C:foo
relative(c:/repo, c:/repo/C:foo)          -> ./C:foo
join(c:/repo, ./C:foo)                   -> c:/repo/C:foo
join(., ./C:foo)                         -> ./C:foo
```

Windows component policy is separate from this lexical composition. For example, a caller may reject ADS with an explicit normalization policy before storing or using a Windows path.

For supported same-root operands:

```text
join(root, relative(root, target)) == target
```

`join` rejects rooted relative arguments, NUL, and traversal above the relative argument's component stack. A nonempty relative argument that cleans to no components, such as `a/..` or `./`, returns the root; an empty input remains `ERR_EMPTY_PATH`. A Windows-rooted join rejects literal-backslash data before cleanup, including `a\b/../file`, so a prohibited component cannot disappear first.

### Raw validation stays strict

`NormalizeRelative`/`normalizeRelative` remains a strict raw-input validator. It rejects backslashes, rooted forms, drive-relative input, NUL, and traversal. Canonical `join` uses a separate parser.

A canonical POSIX filename containing backslash does not make that raw input acceptable to CanonicalFS, scoped validators, Unity payload validation, or archive extraction. Those APIs keep their own constraints and root-bound authority. Lexical identity support does not expand filesystem permissions.

The Unity bridge preserves literal backslash in a canonical POSIX project root. Its `toUnityAssetPath` boundary rejects literal backslash in the extracted relative asset path before Unity path normalization; `/repo/Assets/a\b` cannot silently become the distinct asset `Assets/a/b`.

## Windows policies and target profiles

`windows.rejectADS` and `windows.rejectDeviceNames` remain explicit restrictions, including in native POSIX mode. They run before dot cleanup removes components. With `rejectADS: true`, native `/C:/repo` and native `C:/repo` are rejected because the colon is component data; it is not a Windows drive-colon exemption. A configured device-name check also rejects `/repo/CON/../safe` before cleanup. Without those policies, native punctuation and device-like names remain literal data.

Raw/canonical drive-relative input such as `C:foo` remains `ERR_DRIVE_RELATIVE_PATH`, including when ADS rejection is also enabled. Native POSIX input may instead represent it as `./C:foo` when explicit policies allow it.

`targetProfile` validates the parsed root kind; it does not convert roots or enable mapping:

| Profile | Accepted root kinds |
| --- | --- |
| `portable` | All supported roots and relative paths |
| `posix` | POSIX and relative |
| `win32-drive` | Ordinary drive, preserved extended drive, and relative |

UNC is rejected by `win32-drive`, including preserved extended UNC. These profiles are not a complete filename-validity test for every filesystem.

## Extended prefixes have lexical semantics

Raw Windows/cross-host normalization recognizes native `\\?\...` and slash-form `//?/...` prefixes. `windows.preserveExtendedLength` selects whether the supported drive/UNC wrapper is retained. Canonical input always retains an existing extended wrapper, regardless of that raw-input option.

The entire root is protected from dot cleanup:

```text
//?/UNC/server/share/a/../.. -> //?/UNC/server/share
//?/C:/a/../..              -> //?/c:/
```

`toWin32` restores native Windows separators and retains a preserved wrapper. An extended drive satisfies `targetProfile: "win32-drive"`; its drive colon is not an ADS.

The preserved prefix does not turn CanonicalPath into a Windows verbatim-path parser. CanonicalPath still performs the lexical cleanup above. Windows itself treats the `\\?\` namespace differently from its ordinary path parser; see [Microsoft's extended-length path documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation).

## WSL mount roots

WSL mapping is explicit. The same mount-root normalizer is used in both directions and on every port.

| `mountRoot` | Normalized value or error |
| --- | --- |
| Missing or empty | `/mnt` |
| `/` | `/` |
| `/mount///x///` | `/mount/x` |
| `/foo/../mnt/./` | `/mnt` |
| `/../../mnt` | `/mnt` |
| `///mnt` | `/mnt` |
| `//mnt`, UNC, Windows drive, or relative input | `ERR_INVALID_PATH` |
| NUL anywhere | `ERR_NUL_BYTE` |
| `/C:/drives` | `/C:/drives` |
| `/mnt\vol` | `/mnt\vol`, with literal backslash |

Mount roots use native POSIX grammar. They do not trim whitespace, decode URIs or percent sequences, rewrite backslashes, or fold Unicode/case. Exactly two leading slashes are rejected. Absolute dot segments clamp at `/`.

`normalize` validates an explicitly configured mount root even when mapping is disabled, the input is canonical, or `targetProfile` is `posix`. `toWSL` validates mount options even for a non-drive input. The empty Go option value has the same `/mnt` default as an omitted option elsewhere.

Native POSIX mode with `wsl.enabled: true` is an invalid configuration. Use `sourceHost: "wsl"` or the existing raw mode for mapping. Canonical mode can validate the configuration but never maps a saved string.

In an enabled WSL raw mode, slash-rooted candidates are cleaned as POSIX paths before drive selection and before backslash rewriting. One or three-or-more leading slashes select this POSIX candidate grammar; exactly two retain the raw UNC/extended interpretation. Native Windows roots, UNC, and URI-derived Windows drive roots keep their own grammar. `targetProfile: "posix"` disables drive mapping while preserving this POSIX grammar, including literal backslash. An unmapped POSIX candidate also retains literal backslash. A mapped tail with literal backslash is rejected because it cannot become a Windows component without changing meaning.

```text
/mnt/c/../d/repo, mount=/mnt       -> d:/repo
/mnt/c/../../repo, mount=/mnt      -> /repo
/mnt\vol/c/repo, mount=/mnt\vol   -> c:/repo
/mnt/c/a\b, mount=/mnt            -> ERR_INVALID_PATH
///mnt/c/repo, mount=/mnt         -> c:/repo
///mnt/c/a\b, profile=posix       -> /mnt/c/a\b
```

Configured Windows policy checks still run before prohibited components can be removed. Matching uses complete mount and drive components: `/mnt-evil` does not match `/mnt`, and `cd` is not drive `c`. A mount of `/` produces `/c/repo`, not `//c/repo`.

## Host serialization is explicit

| Operation | Supported behavior | Rejected conversion |
| --- | --- | --- |
| `toPOSIX` | Preserve POSIX/relative values, including literal backslash and required marker | Every Windows root, including UNC and preserved roots |
| `toWin32` | Serialize ordinary/preserved Windows drive and UNC, plus representable ordinary relative paths | POSIX absolute; standalone marked drive-like relative; literal-backslash relative data |
| `toWSL` | Map an ordinary drive; leave POSIX/relative values unchanged | Ordinary UNC and both preserved extended roots |

These rejections use `ERR_INVALID_PATH`. A serializer does not invent a host alias or silently discard a preserved prefix. To remove an extended wrapper, make that raw normalization decision explicitly, then serialize the resulting supported root.

Host serializers retain compatibility with uppercase drive letters in otherwise valid input: `C:/repo` serializes to `C:\repo` or `/mnt/c/repo`, and `//?/C:/repo` serializes to `\\?\C:\repo`. Canonical normalization still stores a lowercase drive. This exception does not enable raw separator rewriting or change the exact-uppercase `UNC` namespace rule.

## URI and byte boundaries

URI decoding remains exactly once. Encoded slash and backslash are rejected by default; malformed encoding and NUL are rejected. Native POSIX and canonical modes do not parse URI-like text even if an allowance flag is present. An explicit `ParseFileURI`/`parseFileUri`, where exposed, can decode a URI before the caller selects the grammar of its decoded path. Only actual URI syntax creates a URI-derived Windows drive exempt from WSL mount matching; `sourceHost: "vscode-file-uri"` alone does not turn a non-URI path into one. The package adds no URI serializer.

C and Godot have additional transport requirements:

- C's `canonicalpath_wsl_options.mount_root_len` supplies the complete byte length, excluding a terminating NUL. A zero value retains the legacy NUL-terminated convention. Use the length-aware form for length-delimited input so embedded NUL can be detected. The field changes structure layout; see the [C migration requirements](path-identity-migration.md#c-options-and-abi-layout).
- Godot provides `from_utf8(PackedByteArray) -> Dictionary`. Success is `{"ok": true, "value": String}`; failure is `{"ok": false, "error": code, "message": text}`. It rejects NUL with `ERR_NUL_BYTE` and malformed UTF-8 with `ERR_INVALID_PERCENT_ENCODING`, using the existing decoder taxonomy. A genuine U+FFFD character is preserved. `mountRoot` also accepts `PackedByteArray` directly and validates it before String conversion.

Godot byte-oriented callers must use this boundary before converting external bytes to String. String conversion can lose the original NUL or malformed input, making later reconstruction impossible. The package's decoder checks the original bytes; it does not infer an error from a replacement character. See the [Godot String implementation](https://github.com/godotengine/godot/blob/master/core/string/ustring.cpp) and the [migration example](path-identity-migration.md#godot-input-before-string-conversion).

## Verification

Shared vectors cover each operation; chain tests verify native/canonical idempotence with outer trimming disabled, `relative`/`join` reconstruction, both WSL directions, and retention of strict raw-input rejection.

Run `pnpm verify` and `pnpm go:race`. Rust is a required gate: `pnpm rust:verify` runs the Rust runner checks, unit/documentation tests, and shared vectors. Missing or broken Cargo, failed compilation, a terminated subprocess, or a failed test must fail verification instead of producing a successful skip. See [the Rust gate scripts](../scripts/run-rust-tests.mjs) and [verification commands](verification.md).
