# Threat model overview

This is the user-facing threat model summary. The detailed test vectors and implementation-specific rules live in the spec and package tests.

## Primary risks

CanonicalPath / CanonicalFS is designed around these classes of bugs.

### 1. Path traversal

Untrusted input uses parent-directory components, absolute paths, encoded separators, mixed separators, or platform-specific path forms to escape an intended root.

Examples:

- `../../secret.txt`
- `/etc/passwd`
- `C:\Windows\...`
- `C:relative-to-drive-current-directory`
- `..\..\secret.txt`
- encoded `..%2f` / `..%5c`

### 2. Symlink and reparse-point escape

A path appears to be inside a root lexically, but a symlink, junction, bind mount, reparse point, or other filesystem feature points outside the root.

Lexical CanonicalPath does not solve this. CanonicalFS must own the real filesystem operation.

### 3. Time-of-check/time-of-use race

A tool validates a path, then opens it later. Between check and use, an attacker or another process changes a directory component to a symlink or otherwise moves part of the tree.

Avoid designs where a “safe” string is returned and then opened by unrelated code.

### 4. Zip Slip and archive extraction

Archive entries are attacker-controlled filenames. If extraction code joins the destination directory with an entry name, entries like `../../evil` can overwrite files outside the destination.

Archive extraction should use root-bound writes and explicit entry policy.

### 5. Windows-specific special cases

Windows path behavior includes cases that are not obvious to POSIX-focused code:

- reserved device names: `CON`, `PRN`, `AUX`, `NUL`, `COM1`, `LPT1`, and variants;
- drive-relative paths: `C:foo` is not the same as `C:\foo`;
- UNC paths: `\\server\share\...`;
- alternate data streams: `file.txt:stream`;
- trailing periods/spaces;
- NUL and reserved characters;
- case-insensitive drive designators by default.

### 6. Cross-runtime semantic drift

A path validated by one runtime can be interpreted differently by another runtime. Examples:

- Node vs Go vs Python path separators;
- Windows vs POSIX behavior;
- WSL path aliases;
- Unity project-relative paths vs host absolute paths;
- browser/URL paths vs filesystem paths.

CanonicalPath exists primarily to prevent this drift.

### 7. Agent tool over-authority

AI agents should not be given arbitrary host-path write authority. Tool payloads should include explicit `project`, `scope`, and canonical/scoped path values.

The gateway should validate scope and delegate real I/O to CanonicalFS.

## Security boundary statement

CanonicalPath is lexical. It can reject malformed or policy-invalid path identities, but it does not make a filesystem operation safe.

CanonicalFS is the filesystem boundary. Today, the Go implementation and daemon are the authoritative boundary.

## What this project should reject by default

Policy depends on scope, but public examples should reject:

- absolute paths where a scoped relative path is expected;
- parent traversal outside scope;
- NUL bytes;
- Windows reserved device names;
- Windows drive-relative paths;
- UNC paths unless a scope explicitly allows them;
- alternate data streams unless explicitly allowed;
- ambiguous slash/escaping forms;
- paths that resolve outside the root during real I/O;
- untrusted archive entries that attempt to write outside extraction root.

## What this project should not claim

Do not claim that lexical normalization alone prevents symlink, reparse-point, bind-mount, or TOCTOU attacks.

Do not claim that every language implementation is a secure filesystem implementation.

Do not claim OS-wide sandboxing. CanonicalFS is a root-bound filesystem access layer, not a replacement for OS security policy.
