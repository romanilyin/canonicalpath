# 02 — Проблемы, разделение на два блока и threat model

## Назначение документа

Этот документ объясняет, какие проблемы решает репозиторий `canonicalpath` / `canonicalfs`, почему его нельзя проектировать как одну “магическую” функцию `Normalize()`, и какие атаки должны быть покрыты тестами.

Документ предназначен для AI-агентов, которые будут писать код, ревьюить PR и интегрировать библиотеку в `opencode`, `openchamber`, VS Code extension, Go daemon, Electron/Tauri/Web UI и Git/file tools.

## Краткое решение

```text
Проблема: разные процессы видят один и тот же проект разными строками пути.
Решение: CanonicalPath дает единый identity key.

Проблема: строковая нормализация не защищает от реальных атак на файловую систему.
Решение: CanonicalFS делает root-bound I/O через безопасные системные примитивы.
```

Финальная модель:

```text
raw client path
  -> CanonicalPath.normalize(...)       # identity / DB / RPC
  -> project lookup + alias selection   # bridge client env <-> daemon env
  -> relative path inside project root  # no arbitrary absolute paths
  -> CanonicalFS.Root.Open(rel)         # secure I/O
```

## Нормативные ссылки

- MITRE CWE-22 Path Traversal: https://cwe.mitre.org/data/definitions/22.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- Go traversal-resistant file APIs: https://go.dev/blog/osroot
- Go `os.OpenInRoot`: https://pkg.go.dev/os#OpenInRoot
- Linux `openat2(2)`: https://man7.org/linux/man-pages/man2/openat2.2.html
- `cyphar/filepath-securejoin`: https://github.com/cyphar/filepath-securejoin
- Snyk Zip Slip research: https://security.snyk.io/research/zip-slip-vulnerability
- Node.js `path` docs: https://nodejs.org/api/path.html
- Python `pathlib`: https://docs.python.org/3/library/pathlib.html
- Rust `std::fs::canonicalize`: https://doc.rust-lang.org/std/fs/fn.canonicalize.html
- Rust `std::path::absolute`: https://doc.rust-lang.org/std/path/fn.absolute.html
- Rust `dunce`: https://docs.rs/dunce
- Rust `soft-canonicalize`: https://docs.rs/soft-canonicalize

## Проблемы, которые решаем

### 1. Session / project desynchronization

Один проект может приходить в разные подсистемы как разные строки:

```text
C:\Users\Alice\Repo
c:\Users\Alice\Repo
c:/Users/Alice/Repo
file:///c%3A/Users/Alice/Repo
/mnt/c/Users/Alice/Repo
```

Если эти строки используются как ключи в SQLite, кэшах или session maps, система создает дубликаты проектов и сессий.

Последствия:

- разные chat timelines для одного проекта;
- потеря связности истории;
- неправильное восстановление контекста;
- лишние токены на повторное индексирование;
- ошибки undo/redo/branching;
- разный state у VS Code, daemon и web UI.

Решение:

```text
raw path -> CanonicalPath -> projects.canonical_project_path UNIQUE
```

Но `sessions` не должны быть уникальны только по canonical path. Один project может иметь много sessions. Правильная модель: `projects` отдельно, `sessions.project_id` отдельно.

### 2. Tool subsystem failures

AI-агент вызывает file tools:

```text
ls
view
write
edit
patch
glob
grep
```

Если UI передал Windows path, а daemon работает в WSL/Linux, daemon не сможет открыть `c:/repo/file.ts`. Если Git вернул `src/file.ts`, а агент сравнивает с `C:\repo\src\file.ts`, результат будет ложным.

Последствия:

- file not found;
- patch applies to wrong path;
- grep/glob работают в неправильном root;
- agent retries and hallucinates;
- появляются ошибки вида “tool failed”, хотя файл существует.

Решение:

- CanonicalPath хранит identity.
- PathAliases знают, как этот root выглядит для конкретного клиента/host.
- File tools принимают relative paths inside project root.
- CanonicalFS открывает файлы через root-bound handle.

### 3. Windows / WSL bridge failure

Один и тот же NTFS каталог выглядит так:

```text
Windows host: C:\Users\Alice\Repo
VS Code URI:  file:///c%3A/Users/Alice/Repo
WSL daemon:   /mnt/c/Users/Alice/Repo
Canonical:    c:/Users/Alice/Repo
```

Canonical identity должен быть стабильным, но I/O путь должен быть host-specific.

Неверно:

```text
Use c:/Users/Alice/Repo for I/O inside WSL.
```

Верно:

```text
Store c:/Users/Alice/Repo in DB.
Use /mnt/c/Users/Alice/Repo when daemon runs in WSL.
```

### 4. Git worktree and branch-name collisions

Git branch names may contain `/`:

```text
feature/auth
bugfix/windows-paths
```

Если использовать branch name как директорию напрямую:

```text
.opencode/worktrees/feature/auth
```

то branch name превращается в nested path. Это ломает ожидания и может конфликтовать с другими branch names.

Нельзя просто заменять `/` на `__`, потому что это создает коллизии:

```text
feature/auth  -> feature__auth
feature__auth -> feature__auth
```

Решение:

```text
safeBranchDir = sanitizeComponent(branchName) + "--" + shortHash(branchName)
```

или percent-encoding with hash fallback.

### 5. Unsafe sandbox checks

Опасный паттерн:

```go
canonRoot := canonicalpath.Normalize(projectRoot)
canonTarget := canonicalpath.Normalize(targetPath)
if !strings.HasPrefix(canonTarget, canonRoot + "/") {
    return ErrSandboxViolation
}
return os.Open(targetPath)
```

Почему это плохо:

- prefix check ломается на `/app` vs `/app-evil`;
- lexical normalize не видит symlink;
- `EvalSymlinks` + `Open` имеет TOCTOU window;
- Windows drive-relative paths и UNC могут обойти ожидания;
- absolute path injection может заменить root.

Решение:

- Проверки identity делать через component-aware `relative(root, target)`.
- Реальный I/O делать через `os.Root` / `OpenInRoot` / `openat2(RESOLVE_IN_ROOT)`.
- Не использовать `strings.HasPrefix` как security boundary.

## Почему нужны два блока: `canonicalpath` и `canonicalfs`

### Лексический слой: сильные стороны

Лексический слой:

- быстрый;
- детерминированный;
- не требует существования файла;
- одинаково работает в CI и offline;
- хорош для DB keys, cache keys, RPC payloads, UI display;
- позволяет сравнивать разные представления одного project root.

Примеры правильного использования:

```text
Create project identity key.
Normalize VS Code file URI before RPC.
Deduplicate sessions by project root.
Map Git relative path to canonical absolute identity.
Store aliases for Windows/WSL/UI.
```

### Лексический слой: ограничения

Лексический слой не знает:

- существует ли файл;
- является ли компонент symlink;
- указывает ли symlink наружу;
- поменялся ли каталог между check и use;
- case sensitivity текущего volume;
- mount namespaces / bind mounts;
- Windows device semantics;
- filesystem-specific Unicode normalization.

Поэтому `canonicalpath` **не является security boundary**.

### FS слой: сильные стороны

FS слой работает с реальной файловой системой и должен использовать root-bound primitives.

Правильные свойства:

- `../` не выходит за root;
- symlink to outside не выходит за root;
- absolute symlink интерпретируется внутри root или блокируется;
- check and use не разделены небезопасным окном;
- file tools получают дескриптор/handle, а не просто строку;
- archive extraction пишет только внутри root.

### FS слой: ограничения

Даже `canonicalfs` не решает все:

- если root выбран слишком широко, intra-root traversal все еще возможен;
- если root берется из недоверенного ввода, безопасность теряется;
- hardlink внутри root на чувствительный файл может иметь платформенные нюансы;
- сетевые ФС и FUSE могут иметь странную семантику;
- Windows symlink/reparse points требуют отдельных тестов;
- Node-only implementation не должна обещать TOCTOU-proof behavior.

## Threat model

### Assets

Что защищаем:

- исходный код пользователя;
- файлы вне project root;
- SSH keys, tokens, `.env`, browser/session files;
- SQLite state агента;
- Git worktrees;
- историю сессий;
- системные каталоги;
- файлы других проектов.

### Actors

Потенциальные источники вредного path input:

1. Пользовательская команда в чате.
2. LLM, которая сгенерировала path ошибочно или злонамеренно.
3. MCP/server tool response.
4. Git branch name, file name, archive entry.
5. VS Code / Electron / Web deep-link.
6. Remote workspace / Dev Container / SSH extension.
7. Malicious repository with symlinks or weird filenames.
8. Race-capable local process.

### Trust boundaries

| Boundary | Risk |
|---|---|
| UI -> daemon RPC | path representation drift, encoded traversal |
| VS Code URI -> TS/Go | percent encoding, Windows drive URI ambiguity |
| Windows -> WSL | wrong host path for I/O |
| Git output -> agent tools | relative path comparison bugs |
| Archive entry -> extraction | Zip Slip arbitrary write |
| LLM tool call -> FS | path traversal, unintended writes |
| Check -> open | TOCTOU |
| DB string key -> project identity | duplicate sessions/projects |

## Attack catalog

### A1. Dot-dot path traversal

Payloads:

```text
../../../../etc/passwd
..\..\..\Windows\System32\drivers\etc\hosts
safe/../../outside.txt
```

Risk:

- read outside project;
- write outside project;
- overwrite config or source files.

Required defense:

- file tools operate on relative path inside root;
- CanonicalFS root-bound open;
- tests for `..` at every segment position.

### A2. Absolute path injection

Payloads:

```text
/etc/passwd
C:\Windows\System32\drivers\etc\hosts
\\server\share\secret.txt
file:///etc/passwd
```

Risk:

A join operation may ignore root if target is absolute or may convert absolute URI into host path unexpectedly.

Required defense:

- reject absolute paths in file tool relative inputs;
- absolute client paths must first be mapped to known project roots;
- no arbitrary absolute I/O.

### A3. Prefix bypass

Naive check:

```go
strings.HasPrefix("/tmp/project-evil/a", "/tmp/project") == true
```

Payloads:

```text
/tmp/project-evil/secret.txt
c:/repo-evil/file.txt
```

Required defense:

- component-aware relative calculation;
- root must end at component boundary;
- `relative(root, target)` must fail if target is outside root.

### A4. Symlink escape

Fixture:

```text
project/
  safe.txt
  link_out -> /etc
```

Payload:

```text
link_out/passwd
```

Lexical view:

```text
/project/link_out/passwd
```

Real FS view:

```text
/etc/passwd
```

Required defense:

- root-bound open using `os.Root` / `openat2(RESOLVE_IN_ROOT)`;
- do not trust lexical prefix.

### A5. TOCTOU symlink swap

Bad flow:

```go
resolved := filepath.EvalSymlinks(path)
if insideRoot(resolved) {
    return os.Open(path)
}
```

Attack:

1. Program checks `project/safe/file`.
2. Attacker renames `safe` and replaces it with symlink to `/etc`.
3. Program opens `project/safe/passwd`.

Required defense:

- open through root-bound descriptor;
- keep check and use inside one kernel-mediated operation where possible;
- stress tests with repeated rename/symlink swaps on supported platforms.

### A6. Zip Slip / archive traversal

Malicious archive entry:

```text
../../../../.ssh/authorized_keys
```

Risk:

Archive extraction writes arbitrary files outside project.

Required defense:

- never extract by `filepath.Join(dest, entry.Name)` alone;
- each entry path must be relative and opened/created through CanonicalFS root;
- reject symlink entries or handle them with explicit policy;
- validate after decompression target creation.

### A7. Encoded traversal / double decoding

Payloads:

```text
..%2f..%2fetc%2fpasswd
..%252f..%252fetc%252fpasswd
file:///c%3A/Users/Alice/Repo
file:///C:/Users/Alice/Repo
```

Risk:

One layer decodes, another layer decodes again, creating traversal after validation.

Required defense:

- one decode stage in CanonicalPath;
- reject encoded slash/backslash for file URI inputs unless explicitly allowed;
- preserve “already decoded” state in RPC schema;
- never validate before final decoding.

### A8. Windows drive-relative paths

Payloads:

```text
C:foo
C:..\secret
\Windows\System32
```

Windows semantics differ from simple absolute/relative assumptions. `C:foo` is drive-relative, not the same as `C:\foo`.

Required defense:

- classify path kind explicitly;
- reject drive-relative paths for security-sensitive operations;
- require canonical absolute root or canonical relative path.

### A9. UNC and extended-length paths

Payloads:

```text
\\server\share\file
\\?\C:\Users\Alice\Repo
\\?\UNC\server\share\file
```

Risks:

- network share access;
- bypass of string assumptions;
- tools not supporting `\\?\`;
- inconsistent Rust/Windows outputs.

Required defense:

- CanonicalPath must parse and classify UNC separately;
- preserve UNC roots unless a future reviewed policy explicitly maps them;
- do not silently treat network UNC as local project root unless explicitly allowed.

### A10. Windows reserved device names

Names:

```text
CON
PRN
AUX
NUL
COM1
LPT1
CON.txt
```

Risks:

- unexpected device access;
- failures when creating files;
- inconsistent cross-platform behavior.

Required defense:

- `sanitizeComponent(name, "win32")` handles reserved names;
- `canonicalfs` rejects or escapes according to policy;
- tests include reserved names and extensions.

### A11. NTFS Alternate Data Streams

Payload:

```text
file.txt:Zone.Identifier
safe.txt:evil.exe
```

Risk:

Colon inside a component has special meaning on NTFS.

Required defense:

- reject ADS syntax by default in win32 profile;
- allow only with explicit option if a caller knows what it is doing.

### A12. Trailing dots/spaces on Windows

Payloads:

```text
secret.
secret 
folder.\file
```

Risk:

Win32 may normalize these names in ways that differ from string identity.

Required defense:

- reject or escape trailing dots/spaces in `sanitizeComponent("win32")`;
- tests verify no silent collision.

### A13. Case collision

Examples:

```text
README.md
readme.md
```

Risk:

On case-insensitive FS, two logical paths collide; on case-sensitive FS, they do not.

Required defense:

- do not lowercase entire path globally;
- expose `casePolicy` in comparison;
- project identity should use host profile and possibly volume info if available;
- document non-goal: perfect cross-volume case identity without FS metadata.

### A14. Unicode normalization and spoofing

Examples:

```text
é as NFC
é as e + combining accent NFD
Greek omicron vs Latin o
```

Risk:

Different filesystems normalize differently; visual spoofing can trick users.

Required defense:

- MVP: preserve Unicode bytes/codepoints except NUL and separators;
- optional `unicodeNormalization` policy later;
- do not pretend to solve homoglyph security in MVP;
- UI may display warnings for suspicious names later.

### A15. Separator confusion

Payloads:

```text
foo\bar
foo/bar
foo//bar
foo\\bar
```

Risk:

Windows and POSIX disagree on separator semantics. Backslash is a normal character on POSIX but a separator on Windows.

Required defense:

- parse according to `sourceHost`;
- in portable canonical profile, use `/`;
- do not treat backslash as separator in POSIX profile unless explicitly configured for client compatibility.

### A16. Git path and branch injection

Examples:

```text
branch: feature/auth
branch: feature__auth
file: src/../secret
file: --help
file: newline\nname
```

Risk:

- branch directory collisions;
- command argument injection if paths are passed to shell;
- wrong worktree location.

Required defense:

- never build shell strings; use argv arrays;
- encode branch names with hash suffix;
- parse `git status -z` to handle newlines;
- map Git paths relative to canonical repo root.

### A17. Cross-drive bypass

Examples:

```text
root: c:/repo
target: d:/repo/file
```

Risk:

String cleanup might remove `..` but fail to enforce same drive/root.

Required defense:

- `relative(root, target)` must reject different roots/drives;
- CanonicalFS root is a host path, not a cross-drive abstraction.

### A18. Broad-root intra-root traversal

Example:

```text
root = /home/alice
target = projects/private/.env
```

Even if `os.Root` prevents escape from `/home/alice`, it does not prevent access to sensitive sibling directories inside `/home/alice`.

Required defense:

- root must be the project root, not home directory;
- do not initialize root from untrusted input;
- use per-project roots.

## Required security invariants

### CanonicalPath invariants

1. `normalize` is idempotent.
2. Canonical output has one separator style.
3. Drive letter is lowercase in win32-drive profile.
4. `relative(root, target)` is component-aware and rejects prefix siblings.
5. NUL is always rejected.
6. URI decoding is controlled and not repeated silently.
7. No function in `canonicalpath` claims that a path is safe for file access.

### CanonicalFS invariants

1. All inputs to root methods are relative.
2. `..` cannot escape root.
3. Symlinks cannot escape root.
4. Absolute path input is rejected.
5. Prefix sibling cannot be opened.
6. Archive extraction cannot write outside root.
7. Race tests do not escape root on platforms with kernel support.
8. Errors preserve enough context for logs but do not leak sensitive file contents.

## Recommended error taxonomy

```text
ERR_EMPTY_PATH
ERR_NUL_BYTE
ERR_INVALID_URI
ERR_ENCODED_SEPARATOR
ERR_UNSUPPORTED_HOST_KIND
ERR_DRIVE_RELATIVE_PATH
ERR_UNC_NOT_ALLOWED
ERR_WINDOWS_DEVICE_NAME
ERR_WINDOWS_ADS_NOT_ALLOWED
ERR_OUTSIDE_ROOT
ERR_ABSOLUTE_PATH_NOT_ALLOWED
ERR_SYMLINK_ESCAPE
ERR_NOT_SUPPORTED_ON_PLATFORM
ERR_RACE_PROTECTION_UNAVAILABLE
```

## Logging rules

Do log:

```text
error code
client type
host kind
canonical project id/path hash
relative path if not sensitive
```

Avoid logging:

```text
full home directory paths
.env file contents
absolute system paths from failed attacks
raw tokens in paths
```

Prefer redacted logs:

```text
ERR_OUTSIDE_ROOT project=sha256:abcd rel="../../<redacted>"
```

## Acceptance tests for threat model

An implementation is not acceptable until it passes these tests:

```text
[canonicalpath]
- Windows drive paths normalize to stable canonical keys.
- WSL /mnt/c maps to c:/ only when WSL mapping is enabled.
- URI file:///c%3A/... decodes exactly once.
- Extended Windows prefix \\?\C:\... is handled.
- Prefix sibling relative check fails.
- normalize is idempotent under fuzzing.

[canonicalfs]
- ../ traversal fails.
- absolute path input fails.
- symlink to outside root fails.
- symlink swap race does not escape on supported platforms.
- archive entry ../../evil fails.
- root initialized to exact project root only.
```

## Design decisions for agents

When coding, follow these decisions unless a human explicitly changes them:

1. Use `projects` table for canonical project identity; do not make `sessions.canonical_project_path` unique.
2. Store aliases by project + client/environment, not only by `client_type`.
3. Make `canonicalfs` authoritative in Go.
4. Make TypeScript `canonicalfs` a client/RPC wrapper or best-effort helper with limitations.
5. Reject Windows drive-relative paths by default.
6. Reject encoded slash/backslash by default in URI inputs.
7. Reject NUL everywhere.
8. Do not lowercase full path.
9. Use branch slug + hash, not slash replacement alone.
10. Do not use string prefix checks for sandboxing.

## Non-goals

The project does not try to solve:

- global identity across machines;
- permissions and ACL authorization;
- virus/malware scanning;
- complete Unicode spoofing detection;
- every behavior of every network filesystem;
- safe Node-only kernel-grade I/O on all platforms;
- replacing OS-specific file APIs in all cases.

## Final summary

`CanonicalPath` is necessary because agent systems need stable, deterministic identity across Windows, WSL, POSIX, VS Code URI, Git output, SQLite and RPC.

`CanonicalFS` is necessary because string identity cannot protect files. Real security requires root-bound file access using OS/kernel primitives where available.

Treat the split as a hard architectural boundary. If a PR mixes these responsibilities, it should be rejected or refactored.
