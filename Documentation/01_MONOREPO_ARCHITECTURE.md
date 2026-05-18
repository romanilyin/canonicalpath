# 01 — CanonicalPath / CanonicalFS: архитектура монорепозитория, CI/CD и тесты

## Назначение документа

Этот документ описывает, как AI-агенту создать новый репозиторий для кросс-платформенной работы с путями.

Цель репозитория — дать экосистеме `opencode` / `openchamber` и другим агентным инструментам единый, тестируемый и безопасный контракт для путей:

1. **`CanonicalPath`** — быстрая, детерминированная, лексическая нормализация для identity layer: БД, кэши, RPC, LSP, UI, логирование, дедупликация проектов.
2. **`CanonicalFS`** — безопасные операции с реальной файловой системой внутри project root: `read`, `write`, `stat`, `mkdir`, `remove`, `rename`, `glob`, `grep`, `patch`.

Главный принцип: **не смешивать строковую идентичность и безопасный доступ к ФС**.

```text
CanonicalPath answers: “Как одинаково назвать этот путь во всех процессах?”
CanonicalFS answers:   “Как безопасно открыть/создать/изменить этот файл внутри root?”
```

## Нормативные ссылки

- Go traversal-resistant file APIs: https://go.dev/blog/osroot
- Go `os.OpenInRoot`: https://pkg.go.dev/os#OpenInRoot
- Linux `openat2(2)` and `RESOLVE_IN_ROOT`: https://man7.org/linux/man-pages/man2/openat2.2.html
- `cyphar/filepath-securejoin`: https://github.com/cyphar/filepath-securejoin
- Node.js `path` docs: https://nodejs.org/api/path.html
- Python `pathlib`: https://docs.python.org/3/library/pathlib.html
- Rust `std::fs::canonicalize`: https://doc.rust-lang.org/std/fs/fn.canonicalize.html
- Rust `std::path::absolute`: https://doc.rust-lang.org/std/path/fn.absolute.html
- Rust `dunce`: https://docs.rs/dunce
- Rust `soft-canonicalize`: https://docs.rs/soft-canonicalize
- GitHub Actions workflow syntax: https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub Actions matrix: https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow
- pnpm workspaces: https://pnpm.io/workspaces
- Go workspaces: https://go.dev/doc/tutorial/workspaces
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html

## Архитектурные принципы

### 1. Два слоя, два набора гарантий

| Слой | Пакет | Идет в FS? | Работает с несуществующими путями? | Может считаться security boundary? | Основное применение |
|---|---|---:|---:|---:|---|
| Identity | `canonicalpath` | Нет | Да | Нет | DB keys, cache keys, session/project identity, RPC, UI |
| Access | `canonicalfs` | Да | Частично | Да, если использует root-bound primitives | File tools, patch/write/edit, archive extraction, agent sandbox |

### 2. CanonicalPath должен быть deterministic и идемпотентным

```text
normalize(normalize(raw)) == normalize(raw)
```

Одинаковые логические roots должны получать один canonical key:

```text
C:\Users\Alice\Repo       -> c:/Users/Alice/Repo
c:/Users/Alice/Repo        -> c:/Users/Alice/Repo
file:///c%3A/Users/Alice/Repo -> c:/Users/Alice/Repo
/mnt/c/Users/Alice/Repo    -> c:/Users/Alice/Repo   # если включен WSL profile
```

Важно: lower-case применяется к **drive letter**, а не ко всему пути.

Нельзя превращать:

```text
c:/Users/Alice/Repo -> c:/users/alice/repo
```

Это сломает Linux case-sensitive и macOS case-sensitive volumes.

### 3. CanonicalFS должен работать с относительными путями внутри root

Внешний API file tools должен принимать путь относительно project root. Если пользователь или клиент передал absolute path, он должен быть сначала смэплен на project root, а затем превращен в relative path.

```text
client absolute path -> canonical identity -> project root lookup -> safe relative path -> CanonicalFS.Open(root, rel)
```

Нельзя открывать arbitrary absolute path напрямую через `os.Open`, `fs.readFile`, `filepath.Join(root, userPath)`.

### 4. Любая поддержка Windows/WSL должна быть явной

WSL mapping нельзя зашивать как единственную истину. В MVP можно поддержать `/mnt/<drive>/`, но API должен иметь опцию:

```ts
interface WslOptions {
  enabled: boolean;
  mountRoot?: string; // default: "/mnt"
}
```

### 5. Не обещать безопасность там, где ее нет

TypeScript/Node реализация `canonicalfs` может предоставить удобный API, но если она не может использовать эквивалент `openat2` или root-bound handle на платформе, документация и типы должны явно говорить:

```text
This API is best-effort traversal-resistant, not TOCTOU-proof.
For security-sensitive agent write operations prefer the Go daemon CanonicalFS.
```

## Рекомендуемая структура репозитория

```text
canonicalpath/
  README.md
  AGENTS.md
  LICENSE
  SECURITY.md
  CONTRIBUTING.md
  CHANGELOG.md
  CODEOWNERS
  .editorconfig
  .gitignore
  .github/
    workflows/
      ci.yml
      security.yml
      release.yml
    dependabot.yml
    pull_request_template.md
  docs/
    architecture.md
    threat-model.md
    opencode-openchamber-adoption.md
    api-compatibility.md
    release-process.md
  spec/
    README.md
    canonical-path.schema.json
    canonical-fs.schema.json
    testdata/
      lexical_cases.json
      uri_cases.json
      windows_cases.json
      wsl_cases.json
      unicode_cases.json
      git_cases.json
      security_cases.json
      fs_fixtures_manifest.json
  packages/
    go/
      go.mod
      go.sum
      canonicalpath/
        normalize.go
        uri.go
        windows.go
        wsl.go
        relative.go
        sanitize.go
        errors.go
        normalize_test.go
        fixtures_test.go
        fuzz_test.go
      canonicalfs/
        root.go
        read.go
        write.go
        mkdir.go
        remove.go
        rename.go
        walk.go
        errors.go
        root_go124.go
        root_legacy.go
        root_unix.go
        root_windows.go
        security_test.go
        race_test.go
    ts/
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        canonicalpath/
          index.ts
          normalize.ts
          uri.ts
          windows.ts
          wsl.ts
          relative.ts
          sanitize.ts
          types.ts
        canonicalfs/
          index.ts
          root.ts
          limitations.ts
          types.ts
      test/
        lexical.test.ts
        fixtures.test.ts
        security.test.ts
    rust/
      Cargo.toml
      canonicalpath/
      canonicalfs/
    python/
      pyproject.toml
      canonicalpath/
      canonicalfs/
    cpp/
    csharp/
    unity/
    powershell/
  examples/
    go-opencode-session-key/
    go-safe-file-tool/
    ts-vscode-uri-normalize/
    sqlite-project-aliases/
    daemon-client-transport/
    powershell-canonicalfs-client/
    wsl-daemon-host-path/
    git-status-path-mapping/
    safe-worktree-branch-folder/
  scripts/
    validate-spec.mjs
    generate-fixtures.mjs
    compare-results.mjs
    make-symlink-fixtures.sh
    make-windows-fixtures.ps1
  spec/
    language-targets.json
```

## Почему MVP должен быть Go + TypeScript

`opencode` / `crush`-подобный daemon и file tools обычно живут в Go. `openchamber`, VS Code extension, Electron/Tauri/Web UI и SDK-интеграции чаще живут в TypeScript. Поэтому первые две реализации закрывают основную продуктовую поверхность:

- Go: authoritative `canonicalfs`, SQLite/session integration, file tools, git integration.
- TypeScript: URI parsing, VS Code path bridging, client aliases, UI display, IPC payloads.

Dart/Flutter, C#/.NET, полный Unity UPM target, Swift и Kotlin целесообразно добавлять после стабилизации Go/TypeScript MVP и только через shared vectors. Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe и GDScript/Godot уже начаты как experimental lexical targets и должны оставаться без filesystem security claims до отдельного root-bound design.

Исключение для Unity: минимальный bridge adapter/facade нужен раньше полного library target, потому что Unity write-команды должны получить `PathGuard` до первого MVP с реальным проектом. Этот ранний слой не является полноценным Unity package target и не претендует на security boundary для произвольного filesystem I/O.

PowerShell 5.1 и PowerShell 7 входят в MVP как supported client languages для JSON HTTP transport к Go daemon. Это не отдельная root-bound filesystem implementation: security-sensitive I/O остается в Go `canonicalfs`. Полноценный PowerShell module для 5.1 и 7 запланирован отдельно: `CanonicalPath` lexical parity по shared vectors плюс typed daemon HTTP client.

Полный Unity support должен явно покрывать `2022.3`, `6000.1`, `6000.2`, `6000.3`, `6000.4` в managed и Burst-compatible lanes. Для всех языков и lanes нужен allocation-check plan в `spec/language-targets.json`; реальные gates можно включать в local verification только после появления toolchain и реализации.

## Unity bridge early scope

До Unity write-команд нужен небольшой adapter/facade внутри bridge, а не отдельный большой library project:

```csharp
public interface ICanonicalPathService
{
    CanonicalPathValue Normalize(string input);
    CanonicalPathValue NormalizeProjectRoot(string input);
    CanonicalPathValue FromUnityAssetPath(CanonicalPathValue projectRoot, string unityPath);
    string ToUnityAssetPath(CanonicalPathValue projectRoot, CanonicalPathValue fullPath);
    void AssertInsideProject(CanonicalPathValue projectRoot, CanonicalPathValue candidate);
    string MakeSafeFileName(string input, int maxLength);
}
```

`PathGuard` рядом с bridge должен валидировать payload от агента до любых write-команд:

- reject null / empty where invalid;
- reject NUL;
- normalize separators;
- reject absolute paths from agent payloads;
- allow only `Assets/...` and `Packages/...` Unity paths;
- reject `../` traversal;
- assert candidate path is inside the Unity project root;
- sanitize generated filenames.

Порядок интеграции для Unity-first MVP:

1. [x] Gateway skeleton + public docs.
2. [x] MCP tools + fake bridge.
3. [x] TypeScript `CanonicalPathService` / `CanonicalPathBroker`.
4. [x] Minimal Unity `ICanonicalPathService` + `PathGuard`.
5. [x] Unity Bridge built-in read/status/log commands.
6. [x] Unity Bridge write commands: `assets.refresh`, `scene.save`, `asset.import`, prefab/module commands.
7. [x] Standalone C#/.NET lexical target is active; full Unity package hardening remains pending while managed shared-vector/allocation smoke, the Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` EditMode matrix, Burst-compatible unsafe buffer surface smoke, optional Burst compiler/allocation probes, and the same versioned Burst zero-GC allocation matrix are active locally.
8. [x] Optional CanonicalFS/daemon integration for real filesystem I/O; Go daemon remains the security boundary.

## CanonicalPath API contract

### Типы

```ts
export type CanonicalPath = string & { readonly __canonicalPath: unique symbol };
export type CanonicalRelativePath = string & { readonly __canonicalRelativePath: unique symbol };

export type HostKind =
  | "posix"
  | "win32"
  | "wsl"
  | "vscode-file-uri"
  | "dev-container"
  | "ssh-remote";

export interface NormalizeOptions {
  sourceHost?: HostKind;
  targetProfile?: "portable" | "win32-drive" | "posix";
  wsl?: {
    enabled?: boolean;
    mountRoot?: string;
  };
  uri?: {
    allowFileUri?: boolean;
    allowVSCodeFileUri?: boolean;
    rejectEncodedSlash?: boolean;
  };
  windows?: {
    preserveExtendedLength?: boolean;
    rejectDeviceNames?: boolean;
    rejectADS?: boolean;
  };
}
```

### Функции

```ts
normalize(raw: string, options?: NormalizeOptions): CanonicalPath
isEqual(a: string, b: string, options?: NormalizeOptions): boolean
parseFileUri(uri: string, options?: NormalizeOptions): string
toWin32(canonical: CanonicalPath): string
toWSL(canonical: CanonicalPath, options?: { mountRoot?: string }): string
toPOSIX(canonical: CanonicalPath): string
relative(root: CanonicalPath, target: CanonicalPath): CanonicalRelativePath
join(root: CanonicalPath, relative: CanonicalRelativePath): CanonicalPath
sanitizeComponent(name: string, profile: "portable" | "win32" | "posix"): string
encodeComponent(name: string, profile: "portable" | "win32" | "posix"): string
```

### Нормализационный pipeline

Option contract:

- `file://` and `vscode-file://` are unwrapped only when `allowFileUri` or `allowVSCodeFileUri` is explicitly true.
- Accepted URI inputs are percent-decoded exactly once; encoded `/` and `\` are rejected unless `rejectEncodedSlash: false` is explicitly set.
- `targetProfile` validates absolute root families: `portable` accepts POSIX, drive, UNC, and relative paths; `posix` rejects drive/UNC roots; `win32-drive` rejects POSIX/UNC roots while relative paths stay portable.
- WSL drive mapping runs only when `wsl.enabled` is true and `targetProfile` is not `posix`.
- UNC roots are preserved as `//server/share/...`; the MVP has no `deUNC` option.

Pipeline:

1. Trim only outer whitespace if explicitly requested. По умолчанию не трогать whitespace.
2. Reject NUL byte.
3. URI unwrap: allowed `file://` / `vscode-file://`, with mandatory one-pass percent decoding.
4. Windows extended prefix handling: `\\?\C:\x` -> `c:/x`, `\\?\UNC\server\share` -> `//server/share` or structured UNC.
5. Separator normalization: `\` -> `/`.
6. WSL mount mapping: `/mnt/c/x` -> `c:/x`, если enabled и `targetProfile` не `posix`.
7. Drive letter normalization: `C:/x` -> `c:/x`.
8. Lexical clean: `.` and `..`, duplicate `/`, trailing slash policy.
9. Validate canonical grammar and `targetProfile`.

### Правила canonical grammar

MVP grammar:

```text
win32-drive-root = [a-z] ":/" segments?
posix-root       = "/" segments?
unc-root         = "//" server "/" share segments?
relative         = segments
segment          = non-empty string without "/" and NUL
```

Внутреннее хранение project roots для Windows/WSL рекомендуется делать в `win32-drive-root`:

```text
c:/Users/Alice/Repo
```

Для native POSIX projects:

```text
/home/alice/repo
```

Не надо искусственно переводить `/home/alice/repo` в Windows-style.

## CanonicalFS API contract

### Go authoritative API

```go
package canonicalfs

type Root struct {
    // implementation-specific root handle
}

type OpenOptions struct {
    Create bool
    Truncate bool
    Append bool
    Exclusive bool
    Mode uint32
}

func OpenRoot(hostRoot string) (*Root, error)
func (r *Root) Close() error
func (r *Root) Open(rel string) (*os.File, error)
func (r *Root) OpenFile(rel string, opts OpenOptions) (*os.File, error)
func (r *Root) ReadFile(rel string, maxBytes int64) ([]byte, error)
func (r *Root) WriteFile(rel string, data []byte, opts OpenOptions) error
func (r *Root) MkdirAll(rel string, mode os.FileMode) error
func (r *Root) Remove(rel string) error
func (r *Root) Rename(oldRel, newRel string) error
func (r *Root) Stat(rel string) (fs.FileInfo, error)
func (r *Root) Walk(rel string, fn WalkFunc) error
```

### Go 1.24+ implementation

Use `os.OpenRoot` and `os.OpenInRoot` / `Root` methods.

```go
func SafeRead(rootDir string, rel string) ([]byte, error) {
    root, err := os.OpenRoot(rootDir)
    if err != nil {
        return nil, err
    }
    defer root.Close()

    f, err := root.Open(rel)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    return io.ReadAll(f)
}
```

Rules:

- `rel` must be relative.
- Reject absolute paths before calling `Root.Open`.
- Reject NUL.
- Do not convert to absolute and then call `os.Open`.
- Do not use `strings.HasPrefix` as security boundary.

### Legacy / Linux fallback

If Go 1.24 is not available or if the target environment requires container-grade Linux handling, use `github.com/cyphar/filepath-securejoin` modern API where appropriate. Avoid legacy `SecureJoin` for security-sensitive write/read because userspace symlink resolution can be TOCTOU-prone.

### TypeScript API limitations

Node's `path.normalize()` and `path.resolve()` are lexical/string utilities. They are useful for client-side mapping and tests, but they do not provide root-bound kernel guarantees.

The TypeScript `canonicalfs` package should be limited to:

- validation and conversion of relative paths;
- `BestEffortCanonicalFSRoot` operations for non-adversarial environments;
- RPC client wrapper that delegates real file access to the Go daemon.

Recommended TS API shape:

```ts
export interface CanonicalFSClient {
  readFile(projectId: string, rel: CanonicalRelativePath): Promise<Uint8Array>;
  writeFile(projectId: string, rel: CanonicalRelativePath, data: Uint8Array): Promise<void>;
  stat(projectId: string, rel: CanonicalRelativePath): Promise<FileStat>;
}
```

## Test strategy

### Test categories

| Category | File | Purpose |
|---|---|---|
| Lexical equivalence | `spec/testdata/lexical_cases.json` | One raw path -> canonical output |
| URI handling | `uri_cases.json` | `file://`, `vscode-file://`, percent encoding |
| Windows | `windows_cases.json` | Drive letters, UNC, `\\?\`, device names |
| WSL | `wsl_cases.json` | `/mnt/c`, custom mount root, round-trip `ToWSL` |
| Unicode | `unicode_cases.json` | NFC/NFD policy, homoglyph non-goals |
| Git | `git_cases.json` | Git relative paths, branch component encoding |
| Security | `security_cases.json` | path traversal, prefix bypass, encoded slash, NUL |
| FS fixtures | `fs_fixtures_manifest.json` | Real symlink/race/archive fixtures |

### JSON test vector schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["version", "cases"],
  "properties": {
    "version": { "type": "integer" },
    "cases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "raw", "expected"],
        "properties": {
          "id": { "type": "string" },
          "raw": { "type": "string" },
          "options": { "type": "object" },
          "expected": { "type": "string" },
          "error": { "type": "string" },
          "notes": { "type": "string" },
          "platforms": {
            "type": "array",
            "items": { "enum": ["linux", "macos", "windows", "wsl"] }
          }
        }
      }
    }
  }
}
```

### Starter lexical test cases

```json
{
  "version": 1,
  "cases": [
    {
      "id": "win-drive-basic",
      "raw": "C:\\Users\\Alice\\Repo",
      "options": { "sourceHost": "win32", "targetProfile": "win32-drive" },
      "expected": "c:/Users/Alice/Repo"
    },
    {
      "id": "file-uri-win-drive",
      "raw": "file:///c%3A/Users/Alice/Repo",
      "options": { "sourceHost": "vscode-file-uri", "targetProfile": "win32-drive", "uri": { "allowFileUri": true } },
      "expected": "c:/Users/Alice/Repo"
    },
    {
      "id": "wsl-mnt-c",
      "raw": "/mnt/c/Users/Alice/Repo",
      "options": { "sourceHost": "wsl", "targetProfile": "win32-drive", "wsl": { "enabled": true, "mountRoot": "/mnt" } },
      "expected": "c:/Users/Alice/Repo"
    },
    {
      "id": "lexical-dotdot",
      "raw": "c:/Users/Alice/Repo/src/../README.md",
      "options": { "sourceHost": "win32", "targetProfile": "win32-drive" },
      "expected": "c:/Users/Alice/Repo/README.md"
    },
    {
      "id": "prefix-bypass-fixture",
      "raw": "c:/project-evil/file.txt",
      "options": { "sourceHost": "win32", "targetProfile": "win32-drive" },
      "expected": "c:/project-evil/file.txt",
      "notes": "Used by relative(root,target) tests to ensure c:/project is not a prefix match for c:/project-evil."
    }
  ]
}
```

### Security fixtures

Create real filesystem fixtures in CI, not only JSON strings.

Linux/macOS fixture:

```bash
mkdir -p /tmp/cp-fixture/project/safe
mkdir -p /tmp/cp-fixture/outside
printf 'secret' > /tmp/cp-fixture/outside/secret.txt
ln -s /tmp/cp-fixture/outside /tmp/cp-fixture/project/link_out
```

Tests:

- `canonicalpath.normalize("/tmp/cp-fixture/project/link_out/secret.txt")` may return a lexical path under project.
- `canonicalfs.Root(project).Open("link_out/secret.txt")` must fail if symlink escapes root.
- `canonicalfs.Root(project).Open("../outside/secret.txt")` must fail.

Windows fixture:

```powershell
New-Item -ItemType Directory -Force $env:TEMP\cp-fixture\project\safe
New-Item -ItemType Directory -Force $env:TEMP\cp-fixture\outside
Set-Content $env:TEMP\cp-fixture\outside\secret.txt "secret"
# Symlink creation may require Developer Mode or admin rights.
New-Item -ItemType SymbolicLink -Path $env:TEMP\cp-fixture\project\link_out -Target $env:TEMP\cp-fixture\outside
```

If symlink creation is unavailable on Windows CI, mark symlink tests as conditional but keep traversal and device-name tests mandatory.

### Property-based tests

For `canonicalpath`:

- idempotence: `normalize(normalize(x)) == normalize(x)`;
- separator invariant: canonical output uses `/`, never `\` except explicitly preserved UNC tests;
- no empty components except root;
- drive letter lowercase;
- no trailing slash except root;
- `relative(root, join(root, rel)) == rel` for valid relative inputs.

For `canonicalfs`:

- no `..` can escape root;
- symlink to outside root cannot be opened;
- prefix sibling cannot be opened: root `/tmp/app`, target `/tmp/app-evil`;
- archive extraction cannot write outside root;
- repeated rename/symlink swap attempts during read/write do not escape root on supported platforms.

### Fuzzing

Go:

```go
func FuzzNormalizeIdempotent(f *testing.F) {
    seeds := []string{"C:\\A\\B", "/mnt/c/A/B", "file:///c%3A/A/B", "../x", "\\\\?\\C:\\A"}
    for _, s := range seeds { f.Add(s) }
    f.Fuzz(func(t *testing.T, raw string) {
        a, err := canonicalpath.Normalize(raw, canonicalpath.DefaultOptions())
        if err != nil { return }
        b, err := canonicalpath.Normalize(string(a), canonicalpath.DefaultOptions())
        if err != nil { t.Fatal(err) }
        if a != b { t.Fatalf("not idempotent: %q -> %q -> %q", raw, a, b) }
    })
}
```

TypeScript with fast-check:

```ts
import fc from "fast-check";

it("normalize is idempotent", () => {
  fc.assert(fc.property(fc.string(), raw => {
    try {
      const a = normalize(raw);
      const b = normalize(a);
      expect(b).toBe(a);
    } catch {
      // Invalid input may throw. That is allowed.
    }
  }));
});
```

## CI/CD design

### Required jobs

1. `spec-validate`: validate JSON schemas and all testdata.
2. `go-test`: Go tests on Ubuntu, macOS, Windows.
3. `go-fuzz-smoke`: short fuzz run on PR.
4. `ts-test`: TypeScript tests on Ubuntu, macOS, Windows.
5. `cross-language-equivalence`: run Go and TS implementations over the same `spec/testdata/*.json` and compare outputs.
6. `security-fixtures`: run real FS fixture tests on Linux/macOS/Windows.
7. `lint`: formatting and static analysis.
8. `release`: version, changelog, npm publish, Go tag.

### Example `.github/workflows/ci.yml`

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  spec:
    name: spec validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm spec:validate

  go:
    name: go test (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        go: ["1.24.x", "1.25.x"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ matrix.go }}
      - run: go work sync
      - run: go test ./packages/go/... -race

  go-fuzz-smoke:
    name: go fuzz smoke
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25.x"
      - run: go test ./packages/go/canonicalpath -run=^$ -fuzz=FuzzNormalizeIdempotent -fuzztime=30s

  ts:
    name: ts test (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm -C packages/ts test
      - run: pnpm -C packages/ts typecheck

  cross-language-equivalence:
    name: cross-language equivalence
    runs-on: ubuntu-latest
    needs: [spec, go, ts]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25.x"
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: go run ./packages/go/cmd/cp-test-runner ./spec/testdata > /tmp/go-results.json
      - run: pnpm cp-test-runner ./spec/testdata > /tmp/ts-results.json
      - run: node scripts/compare-results.mjs /tmp/go-results.json /tmp/ts-results.json

  security-fixtures:
    name: security fixtures (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25.x"
      - run: bash scripts/make-symlink-fixtures.sh
        if: runner.os != 'Windows'
      - run: pwsh scripts/make-windows-fixtures.ps1
        if: runner.os == 'Windows'
      - run: go test ./packages/go/canonicalfs -run 'TestSecurity|TestRoot|TestTraversal'
```

### Example `.github/workflows/security.yml`

```yaml
name: security

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  baseline:
    name: security baseline
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - uses: actions/setup-go@v6
        with:
          go-version: "1.26.x"
          check-latest: true
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm spec:validate
      - run: pnpm audit --audit-level moderate
      - run: go install golang.org/x/vuln/cmd/govulncheck@latest
      - run: |
          "$(go env GOPATH)/bin/govulncheck" ./...
        working-directory: packages/go
```

## Package manager setup

### Root `package.json`

```json
{
  "name": "canonicalpath-monorepo",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "spec:validate": "node scripts/validate-spec.mjs",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "format": "pnpm -r format"
  },
  "devDependencies": {
    "ajv": "^8.17.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "fast-check": "^3.23.0"
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/ts"
  - "examples/*"
```

### Go workspace

```bash
go work init ./packages/go
```

Root `go.work`:

```go
go 1.24

use (
    ./packages/go
)
```

## Release strategy

### Versioning

Use SemVer with shared spec version:

```text
spec v1.0.0
canonicalpath-go v1.0.0
canonicalpath-ts v1.0.0
canonicalfs-go v1.0.0
canonicalfs-ts v0.x until limitations are resolved
```

Rules:

- Changing canonical output for an existing case is a breaking change unless the case was explicitly marked invalid.
- Adding new accepted input that normalizes to an existing output is minor.
- Adding new reject cases can be breaking if callers may currently rely on them.
- Security fixes may be released as patch even if they reject previously accepted malicious inputs; document this in release notes.

### Go module tags

If using one Go module under `packages/go`, tag:

```text
packages/go/v1.0.0
```

If split modules:

```text
packages/go/canonicalpath/v1.0.0
packages/go/canonicalfs/v1.0.0
```

MVP recommendation: one Go module, two packages.

### npm package names

Suggested names:

```text
@romanilyin/canonicalpath
@romanilyin/canonicalpath-standalone
```

## Agent implementation checklist

Статус ниже отражает текущее состояние MVP. После публичного релиза GitHub workflows для CI, security baseline и CodeQL включены на `pull_request`, `push` в `main` и `workflow_dispatch`; `schedule` triggers не включены. Локальный gate остается `pnpm verify`, `pnpm alloc`, `pnpm go:race`.

### Phase 0 — Repository skeleton

- [x] Create files listed in structure above.
- [x] Add `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `AGENTS.md`.
- [x] Add root `package.json`, `pnpm-workspace.yaml`, `go.work`.
- [x] Add GitHub Actions workflows for CI/security/CodeQL with `pull_request`, `push` to `main`, and `workflow_dispatch` triggers after public release.
- [x] Add `spec/testdata/*.json` and schema.

### Phase 1 — CanonicalPath MVP

- [x] Implement Go `canonicalpath.Normalize`.
- [x] Implement TS `normalize`.
- [x] Implement URI unwrap.
- [x] Implement Windows drive normalization.
- [x] Implement WSL mapping.
- [x] Implement UNC / extended path handling.
- [x] Implement lexical clean.
- [x] Implement `relative` with component-aware prefix checks.
- [x] Implement `sanitizeComponent`, `encodeComponent`, and Git ref encoding.
- [x] Implement Go `IsEqual` and TS `isEqual`.
- [x] Pass shared test vectors locally and compare Go/TS vector results.
- [x] Run the public CI matrix on Linux/Windows through GitHub Actions after public release; keep local Unity/editor-heavy matrix documented separately.

### Phase 2 — CanonicalFS MVP

- [x] Implement Go `canonicalfs.Root` on Go 1.24+.
- [x] Reject absolute paths in `Root` methods.
- [x] Add tests for `..`, symlink escape, prefix bypass, NUL, archive traversal, and race attempts.
- [x] Add `ReadFile`, `WriteFile`, `MkdirAll`, `Remove`, `Rename`, `Stat`, and `Walk`.
- [x] Keep `Rename` root-bound: supported through `os.Root.Rename` on Go 1.26+, unsupported on older Go versions.
- [x] Add safe archive extraction helper.
- [x] Add TS RPC wrapper that validates relative paths before delegation.
- [x] Add TS local best-effort helper with explicit TOCTOU limitations.
- [x] Add Go HTTP daemon/server transport for root-bound project file access.
- [x] Add TypeScript HTTP client for the Go daemon transport.
- [x] Document PowerShell 5.1 and PowerShell 7 as daemon transport clients.
- [ ] Expand security fixture coverage further as new attack cases are identified.

### Phase 2.5 — Pre-1.0 hardening

- [x] Add daemon capability/auth for every read/write/mutating endpoint except `/healthz`.
- [x] Restrict project root registration through allowlist/project registry or trusted bootstrap flow.
- [x] Add daemon server-side read caps, response caps, and HTTP timeouts.
- [x] Create or update the manual CI workflow so it runs the same gate as local release readiness: `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm go:race`.
- [x] Keep GitHub workflows manual-only until Actions minutes are available again or the user explicitly asks for automatic triggers; public release request enabled `pull_request`/`push` triggers.
- [x] Add and fix vectors/tests for `canonicalfs` drive-relative paths like `C:foo`.
- [x] If `canonicalfs` gets a separate `ERR_DRIVE_RELATIVE_PATH`, update validator/schema, Go/TS error constants, fixtures, and tests in the same change.
- [x] Add and fix vectors/tests for Windows reserved component names with extensions: `CON.txt`, `NUL.txt`, `COM1.log`, `LPT9.tmp`.
- [ ] Resolve declared-but-inactive normalizer options before treating them as stable API.
- [x] Clarify `relative(root, root)` and `join(root, ".")` round-trip behavior.
- [x] Stabilize symlink/race fixture error-code expectations or relax docs to promise only rejection.

### Phase 3 — opencode/openchamber examples

- [x] Add SQLite `projects` and `project_path_aliases` example.
- [x] Add VS Code URI normalization example.
- [x] Add Go safe file tool example.
- [x] Add Go opencode session-key example.
- [x] Add daemon/client transport example.
- [x] Add WSL daemon host-path conversion example.
- [x] Add Git status path mapping example.
- [x] Add safe worktree branch folder encoding example.
- [x] Add PowerShell 5.1 / PowerShell 7 daemon client example.

### Phase 4 — additional language targets

- [x] Add source-of-truth language target matrix for planned runtime targets.
- [x] Add allocation-check plan requirement for every target.
- [x] Keep target order documented in `Documentation/04_LANGUAGE_ROADMAP.md` and linked from agent docs.
- [x] Track full PowerShell module as a planned target separate from current transport-only support.
- [ ] Add roadmap-aligned language scaffolding and examples as implementations land.
- [ ] Continue implementing `canonicalpath` for planned languages from shared vectors according to `spec/language-targets.json`.
- [ ] Implement full PowerShell module for 5.1 and 7: `CanonicalPath` vector parity, typed daemon HTTP client, smoke tests, and allocation/memory plan.

## Non-goals for MVP

- Full Unicode spoofing detection.
- Network share authorization.
- Cross-machine path identity.
- Perfect case-insensitive equality across every filesystem.
- Node-side TOCTOU-proof file access.
- Full virtual filesystem abstraction for SFTP/SSH.

## Acceptance criteria

A PR can be considered successful when:

1. The same test vectors produce the same canonical outputs in Go and TypeScript. Current local command: `pnpm vectors`.
2. `normalize` is idempotent.
3. `relative(root, target)` does not use naive string prefix matching.
4. Go `canonicalfs` blocks traversal, symlink escape, archive traversal, and race attempts in real fixtures.
5. Local gate passes: `pnpm verify` and `pnpm go:race`.
6. Public CI/security/CodeQL workflows run on GitHub-hosted runners after public release; local Unity/editor-heavy matrix remains a separate local gate unless stabilized for GitHub runners.
7. Docs clearly say that `canonicalpath` is not a security boundary.
8. opencode/openchamber examples show DB aliases, safe file tool usage, WSL/Git path mapping, and daemon transport clients.
