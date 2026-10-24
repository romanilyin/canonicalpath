# Shared Spec

`spec/testdata/*.json` is the source of truth for cross-language behavior. `spec/language-targets.json` is the source of truth for supported/planned language surfaces and allocation-check plans.

Rules:

- Go and TypeScript implementations must consume the same vectors; standalone C#/.NET, Swift, and the early Unity managed C# smoke gate also consume the canonicalpath vectors when their toolchains are available.
- `canonicalpath` vectors cover lexical identity only.
- `canonicalfs` fixtures must use real filesystem tests for traversal, symlink escape, archive traversal, and race attempts.
- `canonicalfs` reject fixtures use exact error codes by default; `errorMode: "reject-only"` means only rejection is portable across runtimes/platforms.
- `unity_bridge_vectors.json` covers early Unity bridge payload validation and generated filename behavior for `Assets/...` and `Packages/...`; TypeScript and the local C# smoke gate consume it, and it is not a filesystem security boundary.
- Every `canonicalpath` case declares an explicit `operation` such as `normalize`, `relative`, `join`, or `encode-git-ref`.
- Successful canonical path outputs use `/` as their separator, lowercase only the Windows drive letter, contain no NUL, and follow the canonical grammar below. A literal `\` in a POSIX or relative component is data, not a separator.
- URI decoding happens exactly once. Encoded `/` and `\` are rejected when `uri.rejectEncodedSlash` is enabled.
- WSL drive mapping is controlled by `options.wsl`; `/mnt/<drive>/...` is not treated as a universal truth unless that mapping is enabled.
- Git ref directory encoding v2 is `v2-<slug>--<sha256>`, using all 64 lowercase hex digits of SHA-256 over the exact raw UTF-8 input. The ASCII slug replaces runs outside `[A-Za-z0-9._-]` with `-`, trims boundary `.`, `_`, `-`, truncates to 80 ASCII characters, then trims again; an empty slug becomes `ref`. Output is at most 149 ASCII bytes. Only valid Unicode scalar input is accepted: invalid UTF-8 or unpaired UTF-16 surrogates produce `ERR_INVALID_COMPONENT`; no Unicode normalization, trimming, or case folding is applied before hashing. See [migration guidance](../Documentation/IDENTITY_V2_MIGRATION.md) before reusing persisted directories. `testdata/git-ref-utf16-vectors.json` represents exact code units so JSON decoders cannot silently replace malformed test inputs; affected runtime gates and the Unity EditMode matrix consume it.
- Every language target must declare at least one allocation-check plan before it can be tracked in the repo.

## Input grammars and canonical identity

The following contract is normative for lexical ports. `CanonicalPath` remains a string representation; it does not establish filesystem authority. Input grammar is explicit and independent of the host running the library.

| `sourceHost` | Input interpretation |
| --- | --- |
| `posix` | Native POSIX path. Only `/` separates components. `\`, `:`, `?`, `#`, and `%` are literal component data. URI-like text is a path, even when URI allowance flags are set. Windows root detection, drive-letter folding, extended-prefix unwrapping, and backslash rewriting do not apply. |
| `canonical` | Canonical grammar below. Normalize dot segments, duplicate separators, and a Windows drive letter, but do not decode URIs, rewrite `\`, map WSL mounts, or strip a preserved extended prefix. |
| omitted, `win32`, `wsl`, `vscode-file-uri`, `dev-container`, `ssh-remote` | Existing raw cross-host grammar, subject to the explicit WSL rules below. `dev-container` and `ssh-remote` do not imply native POSIX grammar. URI decoding still requires the corresponding allowance flag. |

All modes reject empty input with `ERR_EMPTY_PATH` and NUL with `ERR_NUL_BYTE`. Outer whitespace remains data unless `trimOuterWhitespace` is explicitly enabled. No mode performs Unicode normalization or case folding of components, UNC server names, or UNC share names.

`trimOuterWhitespace` is a legacy preprocessing option for external input. Reapplying it can remove component whitespace exposed by dot cleanup: with trimming enabled, `a/../ b` becomes ` b`, then a second normalization becomes `b`. The native/canonical idempotence guarantee below uses trimming disabled, which is the default. Read saved canonical strings without trimming; the string representation does not encode whether whitespace was already processed.

Explicit `windows.rejectADS` and `windows.rejectDeviceNames` policies also apply to native POSIX input before dot cleanup. They restrict the raw slash-delimited components without changing their identity. In native POSIX mode a drive-like `C:` is component data, so its colon is not exempt from an explicitly enabled ADS policy. Without these flags, native punctuation and device-like names remain literal data.

Native POSIX input beginning with exactly two `/` characters is unsupported and returns `ERR_INVALID_PATH`; it must not be interpreted as UNC or silently merged with a single POSIX root. Three or more leading `/` characters normalize to one POSIX root. Repeated non-leading separators and dot segments are cleaned normally. A native path `/C:/repo` stays `/C:/repo`, including the case of its literal `C:` component.

`sourceHost: "posix"` combined with `wsl.enabled: true` returns `ERR_INVALID_PATH`. Use the explicit WSL/raw mode to request drive mapping. This keeps native POSIX normalization idempotent with the same options. Canonical mode may receive WSL options for configuration validation, but never performs mapping.

Persisted canonical strings must be read with `sourceHost: "canonical"` or passed directly to canonical operations. Reprocessing them with the legacy raw grammar may reinterpret literal POSIX punctuation. `is-equal` normalizes both inputs under the same specified input grammar; use canonical mode when comparing persisted canonical strings.

### Canonical roots and components

The normalized root forms are:

| Kind | Canonical form | Root boundary |
| --- | --- | --- |
| POSIX | `/repo/file` | `/` |
| Windows drive | `c:/repo/file` | `c:/` |
| UNC | `//server/share/repo/file` | `//server/share` |
| Preserved extended drive | `//?/c:/repo/file` | `//?/c:/` |
| Preserved extended UNC | `//?/UNC/server/share/repo/file` | `//?/UNC/server/share` |
| Relative | `src/file`, `.` or a marked relative form below | No absolute root |

Parse recognized extended roots before ordinary UNC. UNC server and share are both required, nonempty components and cannot be `.` or `..`. A share named `?` is valid lexical data; a server named `?` occupies the reserved extended-prefix syntax. Extended roots support only an absolute drive or exact-uppercase `UNC/server/share`; lowercase/mixed-case `unc` markers, malformed roots, and other extended namespace forms return `ERR_INVALID_PATH` in raw and canonical modes, including when prefix preservation is enabled.

A component cannot contain `/` or NUL. Backslash is literal data in POSIX and relative components. A Windows-rooted canonical string containing a literal backslash in a component is invalid: a raw Windows path must first be normalized under a Windows/raw input grammar. Windows drive letters are ASCII letters and normalize to lowercase. The `UNC` marker of an extended UNC root is uppercase; preserve server/share spelling and case.

Dot cleanup operates on components after the entire root has been identified. Absolute `..` is clamped at that complete root. It must never remove a drive, server, or share. Relative input escaping above its own component stack is rejected. The existing normalization error for such relative input is `ERR_INVALID_PATH`; canonical `join` reports `ERR_OUTSIDE_ROOT` for an escaping relative argument.

`targetProfile` validates the parsed root kind, not a string-prefix shortcut. `portable` accepts supported roots and relative paths. `posix` accepts POSIX and relative paths and rejects every Windows root. `win32-drive` accepts ordinary and preserved extended drive roots and relative paths, and rejects POSIX and both UNC forms. It does not invent a host mapping.

### Relative drive marker

A relative path whose first component begins with an ASCII letter followed by `:` is serialized with one leading `./` marker. The marker records that the component is literal relative data; it is not an absolute drive or a drive-relative instruction.

| Native POSIX input | Canonical output |
| --- | --- |
| `C:/repo` | `./C:/repo` |
| `C:foo` | `./C:foo` |
| `./C:/repo` | `./C:/repo` |
| `x/../C:foo` | `./C:foo` |
| `C:/../repo` | `repo` |
| `/C:/repo` | `/C:/repo` |

The marker is selected after component cleanup. Remove redundant leading dot components, then emit exactly one marker when the resulting relative first component needs it. Do not lowercase that literal component. A normal relative first component needs no marker. Thus `./safe` normalizes to `safe`, while `./C:foo` remains marked in both native POSIX and canonical mode.

Unmarked `c:/repo` in canonical grammar is a drive path, and unmarked `C:foo` remains a rejected drive-relative path. The marked and unmarked forms therefore cannot collide as serialized identities. Do not percent-encode components to implement this distinction.

### Canonical operations and raw validation

`relative`, `join`, and host serializers parse canonical grammar directly; they do not call the raw auto normalizer. Their signatures do not need a new input-grammar option.

- `relative` takes lexically cleaned canonical absolute operands, compares complete roots and exact components, and rejects outside-root/prefix-sibling cases. Preserve literal backslash. Emit the relative drive marker when the first returned component needs it.
- `join` validates a canonical root and cleans its relative argument with slash-only canonical-relative rules. Reject NUL, rooted input, and traversal above the relative root. A nonempty argument that cleans to no components (`a/..` or `./`) returns the root; an empty raw argument still returns `ERR_EMPTY_PATH`. Remove the relative marker when embedding its components into an absolute path; re-emit it if the joined result is relative and its first component needs the marker. A Windows-rooted join also embeds a marked relative component without reinterpreting it as a drive root; the marker is syntax disambiguation, not a POSIX host tag. It rejects literal-backslash components with `ERR_INVALID_PATH` before cleanup, including `a\b/../file`. Existing opt-in Windows component policies remain separate from this lexical operation.
- `join(root, relative(root, target))` must reproduce the exact canonical target for supported same-root operands, including POSIX literal backslashes and marked relative results. Distinct preserved/unpreserved root forms are not implicitly aliased by `relative`.
- Host serializers consume canonical paths. They validate the root/representation without performing URI decoding, raw separator conversion, WSL identity detection, or silent extended-prefix removal.
- The existing raw `NormalizeRelative`/`normalizeRelative` validator remains strict: it rejects backslashes, absolute forms, drive-relative forms, NUL, and traversal. Canonical `join` uses a separate grammar parser. Native lexical support must not relax CanonicalFS, scoped-path, Unity payload, archive, or other filesystem-facing raw-input validation.

| Serializer | Supported behavior |
| --- | --- |
| `toPOSIX` | Preserve POSIX and relative strings, including literal backslash and a required `./` marker. Reject all Windows roots, including ordinary UNC and preserved roots, with `ERR_INVALID_PATH`. |
| `toWin32` | Serialize ordinary/preserved drive and UNC roots using Windows separators. Preserve an extended prefix and uppercase the drive in host output. Ordinary representable relative paths may be serialized. Reject a POSIX absolute root, literal-backslash relative data, or a marked drive-like relative form with `ERR_INVALID_PATH`; these cannot be converted by separator substitution without changing interpretation. |
| `toWSL` | Validate mount options first, then map an ordinary drive to the configured mount. Return POSIX and relative canonical paths unchanged. Reject ordinary UNC and both preserved extended roots with `ERR_INVALID_PATH`; obtaining a supported drive first requires an explicit normalization/mapping decision. |

For compatibility, host serializers accept an uppercase drive letter in otherwise valid drive grammar. `toWin32("C:/repo")` returns `C:\repo`, `toWSL("C:/repo")` returns `/mnt/c/repo` with the default mount, and `toWin32("//?/C:/repo")` retains the extended wrapper. Normalized canonical storage still uses a lowercase drive; this compatibility rule does not enable raw separator rewriting or accept a differently cased `UNC` marker.

### URI boundary

URI allowance flags authorize URI handling only in an input mode that parses URIs. Native POSIX and canonical modes never decode URI-like component text or percent sequences. Existing explicit `ParseFileURI`/`parseFileUri` entry points, where exposed, remain available for one decoding step before applying an explicitly selected path grammar. For example, a decoded `/C:/repo` can then be normalized as native POSIX without Windows drive inference.

Default rejection of encoded `/` and `\`, NUL rejection, UTF-8 validation, and exactly-once decoding remain unchanged. The contract adds no URI serializer and no implicit encoding of native component data.

## Preserved extended roots

In raw Windows/cross-host modes, recognize both native `\\?\...` and canonical `//?/...` prefix spellings. With `windows.preserveExtendedLength: false`, unwrap a recognized drive/UNC prefix. With `true`, serialize the explicit extended root. Canonical input mode always retains an existing extended root, even if the Windows preservation option is omitted or false.

The complete root is atomic during cleanup:

```text
//?/UNC/server/share/a/../.. -> //?/UNC/server/share
//?/C:/a/../..              -> //?/c:/
```

Preservation retains the prefix in CanonicalPath's lexical representation; it does not promise Windows verbatim-path parsing semantics. This package still performs its specified lexical dot cleanup. To produce a native Windows path, use `toWin32` after normalization. Windows validation must identify a preserved drive as a drive, so its drive colon is not misclassified as ADS; optional ADS/device checks still reject prohibited components before cleanup can discard them.

## WSL mount-root contract

Every lexical port must use the same mount-root normalization for mapping in both directions. The option is an absolute native POSIX path, independent of the path input's grammar and of the operating system running the library.

| `mountRoot` input | Result |
| --- | --- |
| Missing or empty | `/mnt` |
| `/` | `/` |
| `/mount///x///` | `/mount/x` |
| `/foo/../mnt/./` | `/mnt` |
| `/../../mnt` | `/mnt` |
| Three or more leading `/` | Collapse to one POSIX root |
| Exactly two leading `/` | `ERR_INVALID_PATH` |
| Relative path, Windows drive path, or backslash UNC path | `ERR_INVALID_PATH` |
| Any embedded NUL | `ERR_NUL_BYTE` |
| `/C:/drives` | Preserve the literal POSIX `C:` component |
| `/mnt\vol` | Preserve the literal backslash in the component |

Do not trim whitespace, rewrite backslashes, decode URI/percent text, lowercase components, or apply Unicode normalization to mount roots. Dot segments and repeated slash separators are normalized with the POSIX root floor; preserve `/` as a nonempty root. Relative values are invalid even if combining them with another path would produce an absolute output.

`normalize` validates `mountRoot` whenever it is explicitly configured or WSL mapping is enabled, including disabled mapping, canonical input mode, and `targetProfile: "posix"`. `toWSL` always validates it, including when the supplied path is not a drive. Missing and empty options have the same `/mnt` result, including the Go zero value. A port must not turn `/` into the default mount.

Match a whole mount-root boundary and then exactly one ASCII drive-letter component. The root `/` produces `/c/repo`, not `//c/repo`. `/mnt-evil` does not match `/mnt`, and `cd` is not a drive component. Use exact component comparison, including Unicode spelling.

### WSL input processing

Mapping applies only in the existing raw cross-host modes when `wsl.enabled` is true and the target profile permits mapping. Native POSIX mode rejects the configuration; canonical mode validates it without mapping. Native Windows roots, UNC roots, and URI-derived Windows drive roots keep their own grammar and are not POSIX mount candidates. The URI-derived exemption requires actual URI syntax in the input; a `sourceHost: "vscode-file-uri"` label alone does not make `/C:/drives/c/repo` a URI-derived drive or bypass a configured `/C:/drives` mount.

For slash-rooted non-Windows/UNC/URI-drive candidates in an enabled WSL raw mode, process POSIX separators and dot segments before any raw backslash-to-slash rewriting. One or three-or-more leading slashes select this candidate grammar; exactly two retain their raw UNC/extended-root interpretation. `targetProfile: "posix"` disables only drive mapping, so a candidate still keeps its native POSIX component data and collapses three-or-more leading slashes to one. This is a rule of that configured mode, not a heuristic based on finding a backslash. It permits a literal-backslash mount root to match without changing its name. An unmapped candidate remains a POSIX path, with its literal backslash preserved. A mapped tail containing a literal backslash cannot be represented as a Windows canonical path and returns `ERR_INVALID_PATH`.

Preserve the existing security ordering: prepare the POSIX leading separators without removing components, reject configured prohibited raw components, then clean POSIX dot segments before choosing the mounted drive. For example, `/mnt/c/../d/repo` maps to `d:/repo`, and `/mnt/c/../../repo` becomes `/repo`. With `rejectDeviceNames`, `///mnt/c/CON/../repo` is rejected before `CON` can disappear. Never choose drive `c` first and then clamp traversal at that drive root.

C APIs need a length-aware mount-root representation for callers transporting strings with explicit lengths. A NUL-terminated pointer alone cannot establish whether an embedded NUL was followed by additional bytes. Length-aware callers and vector runners must provide the complete mount-root length so that such input is rejected instead of truncated.

In C, `canonicalpath_wsl_options.mount_root_len` is the complete byte length excluding a terminating NUL. A zero length retains the legacy NUL-terminated convention. The added field changes structure layout; rebuild callers and FFI bindings against the new header, use `canonicalpath_normalize_options_init`, and zero-initialize standalone WSL options before assigning fields.

Godot byte-oriented callers must use `from_utf8(PackedByteArray)` before converting external data to String. It returns `{ok: true, value}` or `{ok: false, error, message}`, rejects NUL with `ERR_NUL_BYTE`, rejects malformed UTF-8 with the existing `ERR_INVALID_PERCENT_ENCODING` decoder code, and preserves a genuine U+FFFD. Godot String conversion can lose the original NUL, so later String-only checks cannot reconstruct it. `mountRoot` accepts String or PackedByteArray; byte input uses the same production decoder before POSIX mount validation. Vector runners must test this real byte boundary instead of substituting expected errors for values the String API cannot represent.

## Conformance checks

Cases prefixed `cp1-`, `cp2-`, and `cp3-` in the existing vector files cover this contract. All runners must consume these files; do not silently omit a new grammar or options from dispatch. Tests must also exercise operation chains, not only isolated normalization:

- Native POSIX normalization is idempotent with the same native options and outer trimming disabled.
- Canonical normalization with outer trimming disabled is idempotent and retains literal component data and extended roots.
- Literal backslash and slash paths, POSIX drive-like components and Windows drives, and distinct Unicode strings remain distinct under canonical equality.
- Same-root `relative`/`join` round trips retain exact canonical identity.
- Both WSL directions use the same normalized mount root, including `/`, empty/default, dots, Unicode, and literal backslash.
- Existing strict raw filesystem validators and previous WSL/URI security regressions remain covered.

Validation:

```bash
pnpm spec:validate
```

If `pnpm` is unavailable, use:

```bash
corepack pnpm spec:validate
```
