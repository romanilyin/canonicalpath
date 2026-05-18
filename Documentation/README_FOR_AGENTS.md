# CanonicalPath / CanonicalFS — пакет стартовой документации для AI-агентов

Эти документы предназначены для запуска нового репозитория `canonicalpath` / `canonicalfs` и последующего применения его в `opencode`, `openchamber` и совместимых агентах.

## Рекомендуемый порядок чтения

1. [`01_MONOREPO_ARCHITECTURE.md`](./01_MONOREPO_ARCHITECTURE.md) — как создать монорепозиторий, какие пакеты сделать, какие API реализовать, как настроить CI/CD и тесты.
2. [`02_PROBLEM_MODEL_AND_THREAT_MODEL.md`](./02_PROBLEM_MODEL_AND_THREAT_MODEL.md) — какие проблемы решаем, почему нужны два слоя, какие атаки и edge cases покрываем.
3. [`03_OPENCODE_OPENCHAMBER_ADOPTION_PLAN.md`](./03_OPENCODE_OPENCHAMBER_ADOPTION_PLAN.md) — как применить репозиторий для фиксов `opencode` / `openchamber`: БД, RPC, VS Code, WSL, Git, file tools, worktrees.
4. [`04_LANGUAGE_ROADMAP.md`](./04_LANGUAGE_ROADMAP.md) — целевые языки/платформы, статус готовности и очередность реализации.

## Главная архитектурная позиция

Не делать одну функцию `Normalize()` “для всего”. Это опасная абстракция.

```text
CanonicalPath = deterministic identity / serialization layer
CanonicalFS   = root-bound filesystem access / security layer
PathAliases   = bridge between canonical identity and client-specific host paths
```

- `CanonicalPath` не ходит в файловую систему и не делает security guarantees.
- `CanonicalFS` работает с реальной файловой системой и должен использовать root-bound операции: Go `os.Root` / `OpenInRoot`, Linux `openat2(RESOLVE_IN_ROOT)` или безопасные аналоги.
- `PathAliases` связывает один canonical project root с несколькими клиентскими представлениями: Windows, WSL, Dev Container, SSH remote, VS Code URI.

## Минимальный MVP

Реализовать не 10 языков сразу, а:

1. `spec/` с JSON test vectors и JSON Schema.
2. `packages/go/canonicalpath`.
3. `packages/go/canonicalfs`.
4. `packages/ts/canonicalpath`.
5. `packages/ts/canonicalfs` с более ограниченным API и явной маркировкой security limitations.
6. Go daemon transport для root-bound `canonicalfs` операций.
7. JavaScript standalone/browser lexical `canonicalpath` package по shared vectors, без filesystem операций.
8. TypeScript, PowerShell 5.1 и PowerShell 7 clients, которые ходят в Go daemon, а не реализуют собственный secure FS layer.
9. Experimental PowerShell module для 5.1 и 7: `CanonicalPath` lexical parity по shared vectors плюс typed daemon HTTP client, без самостоятельного FS-security boundary.
10. Для Unity-first bridge: минимальный `ICanonicalPathService` + `PathGuard` до любых Unity write-команд.
11. CI matrix на Linux/macOS/Windows.
12. Пример интеграции с SQLite aliases и opencode/openchamber RPC.

Standalone C#/.NET и Swift lexical `CanonicalPath` targets уже добавлены по shared vectors. Полный Unity target и C#/.NET/Swift daemon transports остаются поздними целями. Ранний Unity bridge facade нужен только как adapter вокруг CanonicalPath semantics и payload validation для `Assets/...` / `Packages/...` путей.

## Ссылки на базовые источники

- Go traversal-resistant file APIs: https://go.dev/blog/osroot
- Go `os.OpenInRoot` docs: https://pkg.go.dev/os#OpenInRoot
- Linux `openat2(2)` / `RESOLVE_IN_ROOT`: https://man7.org/linux/man-pages/man2/openat2.2.html
- `cyphar/filepath-securejoin`: https://github.com/cyphar/filepath-securejoin
- MITRE CWE-22 Path Traversal: https://cwe.mitre.org/data/definitions/22.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- Snyk Zip Slip research: https://security.snyk.io/research/zip-slip-vulnerability
- Node.js `path` docs: https://nodejs.org/api/path.html
- Python `pathlib` docs: https://docs.python.org/3/library/pathlib.html
- Rust `std::fs::canonicalize`: https://doc.rust-lang.org/std/fs/fn.canonicalize.html
- Rust `std::path::absolute`: https://doc.rust-lang.org/std/path/fn.absolute.html
- Rust `dunce`: https://docs.rs/dunce
- Rust `soft-canonicalize`: https://docs.rs/soft-canonicalize
- GitHub Actions workflow syntax: https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub Actions matrix strategy: https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow
- pnpm workspaces: https://pnpm.io/workspaces
- Go workspaces: https://go.dev/doc/tutorial/workspaces
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Archived `opencode-ai/opencode`: https://github.com/opencode-ai/opencode
- Active `OpenChamber`: https://github.com/openchamber/openchamber
- OpenChamber AGENTS.md: https://github.com/openchamber/openchamber/blob/main/AGENTS.md
- Charm Crush continuation reference: https://github.com/charmbracelet/crush
