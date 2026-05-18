# Language Roadmap for CanonicalPath / CanonicalFS

Документ отражает последовательность внедрения целей.

## Фазы

| Фаза | Язык / платформа | CanonicalPath | CanonicalFS / FS-security layer | HTTP transport |
| --- | --- | --- | --- | --- |
| Phase 1 — done | Go | Реализован | Реализован (authoritative) | Да |
| Phase 1 — done | TypeScript / Node.js | Реализован | Реализован частично (best-effort, helper), без security-гарантий | Да |
| Phase 1 — supported experimental | JavaScript standalone / browser | Browser-safe lexical package по shared vectors | Нет | Нет |
| Phase 1 — done | shared testdata / spec | Общие test vectors и ожидаемое поведение | Общие fixture-сценарии | Не применяется |
| Phase 2 — early scaffold | Unity Bridge adapter/facade | Минимальный `ICanonicalPathService` внутри bridge | `PathGuard` для payload validation, не FS-security boundary | Нет |
| Phase 2 — done | PowerShell 5.1 + PowerShell 7 | Не входит в текущий transport-only support | Нет | Да |
| Phase 2 — supported experimental | PowerShell module 5.1 + 7 | Минимальный lexical `CanonicalPath` module по shared vectors | Нет отдельного; security-sensitive I/O через Go daemon | Typed daemon HTTP client |
| Phase 2 — supported experimental | Dart / Flutter | Экспериментальная lexical реализация по shared vectors | Нет; security-sensitive I/O через Go daemon | Планируется |
| Phase 2 — supported experimental | Python | Экспериментальная lexical реализация по shared vectors | Нет; security-sensitive I/O через Go daemon | Планируется |
| Phase 2 — supported experimental | Bash wrapper | Не применяется | Нет; security-sensitive I/O через Go daemon | Тонкий CLI transport |
| Phase 2 — supported experimental | Windows CMD/BAT wrapper | Не применяется | Нет; security-sensitive I/O через Go daemon | Тонкий CMD/BAT CLI transport |
| Phase 3 — supported experimental | Rust | Экспериментальная lexical реализация по shared vectors | Нет отдельного; Go daemon или platform root-bound design после review | Планируется |
| Phase 3 — supported experimental | C | Экспериментальная lexical реализация по shared vectors | Нет отдельного; Go daemon/ABI или platform root-bound design после review | Планируется |
| Phase 3 — supported experimental | C++ | Экспериментальная lexical реализация по shared vectors | Нет отдельного; Go daemon или platform root-bound design после review | Планируется |
| Phase 3 — supported experimental | C# / .NET | Экспериментальная lexical реализация по shared vectors | Нет отдельного; Go daemon или platform root-bound design после review | Планируется |
| Phase 4 — planned | Unity UPM package | Планируется | Нет отдельного; managed client delegates to Go daemon | Планируется на managed lanes; нет для Burst |
| Phase 3 — supported experimental | Swift | Экспериментальная lexical реализация по shared vectors | Нет отдельного; Go daemon или platform root-bound design после review | Планируется |
| Phase 4 — supported experimental | Kotlin | Экспериментальная lexical реализация по shared vectors | Нет отдельного; Go daemon или platform root-bound design после review | Планируется |
| Phase 5 — supported experimental | GDScript / Godot | Экспериментальная lexical реализация по shared vectors | Нет; security-sensitive I/O через Go daemon или reviewed engine-native abstraction | Планируется |
| Phase 5 — supported experimental | Haxe | Экспериментальная lexical реализация по shared vectors | Нет; security-sensitive I/O через Go daemon | Планируется |

## Pre-1.0 hardening roadmap

Следующие пункты добавлены по результатам internal review от 2026-05-10 и 2026-05-11. Их нужно закрывать до расширения write-интеграций и до продвижения skeleton packages как поддерживаемых клиентов.

### P0 — daemon и verification gate

- [x] Добавить daemon capability/auth модель: обязательный bearer token или capability secret для всех read/write/mutating endpoints кроме `/healthz`.
- [x] Ограничить регистрацию roots: daemon должен принимать roots из allowlist/project registry или от доверенного bootstrap-клиента, а не доверять произвольному `project_id` + `host_root` от любого локального процесса.
- [x] Ввести server-side лимиты чтения: безопасный default `max_bytes`, hard cap и запрет unbounded read через RPC.
- [x] Добавить HTTP server timeouts: `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` и документированный лимит входящего JSON/ответа.
- [x] Создать или обновить ручной GitHub workflow, чтобы он был эквивалентом локального gate без auto-trigger: `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm go:race`.
- [x] Не запускать Actions и не включать `push`, `pull_request` или `schedule` triggers, пока лимит GitHub Actions minutes не восстановлен 1 июня или пользователь явно не попросит.

### P1 — contract parity и security vectors

- [x] Добавить shared vectors/tests для Windows drive-relative relative paths вида `C:foo` в Go `canonicalfs.cleanRelative` и TS `validateRelativePath`.
- [x] Зафиксировать error code для `C:foo` в `canonicalfs`: предпочтительно отдельный код, либо явно документированный `ERR_ABSOLUTE_PATH`/`ERR_OUTSIDE_ROOT`.
- [x] Если для `canonicalfs` выбирается отдельный `ERR_DRIVE_RELATIVE_PATH`, обновить validator/schema, Go/TS error constants, fixtures и tests вместе с vectors.
- [x] Починить Windows reserved names в `sanitizeComponent`/`encodeComponent`: `CON.txt`, `NUL.txt`, `COM1.log`, `LPT9.tmp`, trailing dot/space.
- [x] Решить contract для объявленных options: реализовать или удалить/переименовать `allowFileUri`, `allowVSCodeFileUri`, `decodePercentEncoding`, `targetProfile`, `deUNC`.
- [x] Уточнить round-trip `relative(root, root)` и `join(root, ".")`: `join(root, ".") == root`.
- [x] Стабилизировать error-code story для symlink/race fixtures: tests должны проверять обещанные codes, либо docs/manifest должны обещать только обязательный fail без точного runtime code.

### P2 — client/package maturity

- [x] Переименовать или сильнее ограничить TS local `CanonicalFSRoot`, чтобы API не выглядел как secure FS boundary; рекомендуемое направление — `BestEffortCanonicalFSRoot` или отдельный non-default export.
- [x] Сделать `security.yml` настоящим manual baseline: `govulncheck` для Go module, `pnpm audit --audit-level moderate`, frozen lockfile, без auto-trigger до восстановления minutes.
- [x] Явно маркировать planned language skeletons как skeleton/not implemented в package README и public docs.
- [x] Добавить typed PowerShell daemon HTTP client и локальные smoke tests, запускающие Go daemon с временным allowlisted root.
- [x] Добавить Windows manual workflow job для PowerShell 5.1 и 7 после восстановления/разрешения workflow итерации.
- [x] PowerShell module не должен становиться самостоятельным filesystem security boundary; security-sensitive I/O остается в Go daemon.

## Приоритет Unity-first MVP

1. [x] Gateway skeleton + public docs.
2. [x] MCP tools + fake bridge.
3. [x] TypeScript `CanonicalPathService` / `CanonicalPathBroker`.
4. [x] Minimal Unity `ICanonicalPathService` + `PathGuard`.
5. [x] Unity Bridge built-in read/status/log commands.
6. [x] Unity Bridge write commands: `assets.refresh`, `scene.save`, `asset.import`, prefab/module commands.
7. [x] Shared Unity bridge vectors for payload path and generated filename behavior, consumed by TypeScript and local C# smoke gates.
8. [x] Standalone C#/.NET lexical target is active; full Unity package hardening remains pending while managed shared-vector/allocation smoke, the Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` EditMode matrix, Burst-compatible unsafe buffer surface smoke, optional Burst compiler/allocation probes, and the same versioned Burst zero-GC allocation matrix are active locally.
9. [x] Optional CanonicalFS/daemon managed transport smoke for real filesystem I/O; Go daemon remains the security boundary.

Ранний Unity bridge adapter/facade не заменяет полный Unity package target. Его задача — дать write-командам bridge обязательный `PathGuard` до первого MVP с реальным Unity проектом.

## Unity MCP path/security roadmap

Последовательный backlog по результатам review Unity MCP path/security contract. Existing gates остаются `pnpm verify` и `pnpm go:race`; новые targeted checks явно помечены как planned до их добавления в `package.json`.

1. [ ] Stage 0 — Dependabot PR order: merge `#7 fast-check`, затем `#8 @types/node`; `#9 vite` только после rebase/recreate и полного локального gate. Acceptance: `pnpm verify`, `pnpm go:race`.
2. [x] Stage 1 — Unity MCP path contract: добавить source of truth `docs/unity-mcp-path-contract.md`, `spec/unity-mcp-path-scopes.schema.json`, `spec/testdata/unity_mcp_path_scope_vectors.json`; зафиксировать scopes `unity_asset`, `knowledge`, `package_manifest`, `artifact`, `gateway_cache`, `temp_session`. Acceptance: `pnpm spec:validate`, `pnpm unity:mcp:path-scopes:vectors`.
3. [x] Stage 2 — `ScopedPathGuard`: поверх текущего Unity-only `PathGuard` добавить scope-aware lexical API в TypeScript, Unity C# и Go; старый `PathGuard.NormalizeUnityPath()` остается совместимым с legacy bridge vectors. Acceptance: `pnpm unity:bridge:vectors`, `pnpm unity:mcp:path-scopes:vectors`, `go test ./packages/go/...`.
4. [x] Stage 3 — shared MCP attack vectors: добавить vectors для knowledge/artifact traversal, prefix siblings, package manifest allow/reject, Windows extended paths, ADS, trailing dot/space, URI encoded separators и double-decode attempts. Acceptance: `pnpm unity:mcp:path-scopes:vectors`, `pnpm verify`.
5. [x] Stage 4 — error taxonomy: выровнять stable error codes между spec schemas, Go `canonicalfs`, TS `canonicalfs`, Unity C# exception/daemon mapping, PowerShell mapping и `docs/api-compatibility.md`. Acceptance: `pnpm check:error-taxonomy`.
6. [x] Stage 5 — JSON Schema fragments: добавить reusable schema fragments для command descriptors: scoped path, canonical relative path, artifact ref, package manifest path и knowledge path. Acceptance: `pnpm spec:validate` после включения fragments в validator.
7. [x] Stage 6 — `PathAliases`: реализовать identity/I/O split для Unity Editor, Gateway, WSL, Go daemon и other clients; aliases keyed by project plus client/environment, not only `client_type`. Acceptance: tests for Windows Unity Editor + WSL gateway, Windows + Windows, POSIX/macOS.
8. [x] Stage 7 — scoped CanonicalFS daemon API: добавить scoped root-bound operations на Go daemon, принимающие `project_id`, scope, relative path и operation policy; scope boundary должен быть уже project-root boundary. Acceptance: `pnpm go:race`; endpoint-specific integration check is planned.
9. [x] Stage 8 — Unity package hardening: добавить Runtime `ScopedPathGuard`, scoped daemon DTO/client helpers, EditMode scoped vectors и docs, что managed bridge не является самостоятельной FS-security boundary. Acceptance: `pnpm unity:bridge:vectors`, `pnpm unity:editmode:matrix` where local Unity versions are available.
10. [x] Stage 9 — artifact refs + bounded ops: добавить safe artifact reference model и bounded list/read/write/glob caps для knowledge/artifact workflows. Acceptance: `pnpm verify`; dedicated bounded-ops smoke is planned.
11. [x] Stage 10 — umbrella check: добавлен единый gate `pnpm check:unity-mcp-contract` для scope schema, vectors, TS/Unity C#/Go scoped guards, error taxonomy, JSON schema fragments, Unity package exports и docs boundary wording. Static contract assertions also run inside `pnpm verify`; the targeted gate runs spec validation, error taxonomy, Unity MCP scope vectors, and static source/docs/package assertions together.

## Public package identity

Публичный релиз пока не открыт, но downstream MCP work should target these final coordinates:

- Canonical repository: `https://github.com/romanilyin/canonicalpath`.
- npm package: `@romanilyin/canonicalpath`.
- Go module: `github.com/romanilyin/canonicalpath/packages/go`.
- Unity UPM package: `com.romanilyin.canonicalpath`.
- License: `LicenseRef-Stinger-Royalty-Free-EULA-1.0`.

`pnpm check:unity-mcp-contract` guards these identity decisions together with the Unity MCP path contract. The TypeScript package remains `private: true` until the repository is intentionally opened and publish-ready package output is added.

## Источник статуса

- `spec/language-targets.json`
- `docs/api-compatibility.md`
- `Documentation/README_FOR_AGENTS.md`
- `AGENTS.md`
- `packages/*` README для native/Unity/JS targets
