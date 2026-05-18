# Участие В Разработке

Английская версия: `CONTRIBUTING.md`.

Перед изменением поведения пакетов прочитайте `AGENTS.md` и `Documentation/README_FOR_AGENTS.md`.

## Pull Requests

Все изменения в `main` должны проходить через pull request, даже для владельцев репозитория. Держите PR сфокусированным на одном изменении поведения или одной задаче по обслуживанию репозитория.

Используйте checklist из PR template и указывайте локальную команду проверки, которую вы запускали. Если изменение влияет на поведение путей, обновляйте shared vectors или filesystem fixtures в том же PR.

## Именование Веток

Используйте lowercase ASCII branch names в таком формате:

```text
<type>/<short-kebab-topic>
```

Разрешенные типы:

```text
feature
fix
docs
l10n
test
refactor
chore
security
release
```

Примеры:

```text
feature/scoped-daemon-client
fix/windows-drive-relative-reject
docs/security-disclosure
l10n/russian-docs
chore/release-readiness-workflow
```

Правила:

- Используйте lowercase letters, digits и hyphens в topic.
- Держите ровно один slash между type и topic.
- Используйте `l10n` для translation или localization-only изменений документации.
- Не добавляйте secrets, hostnames, private directory names, customer names или tokens в branch names.
- Не используйте `main`, `master`, `release` или tag-like names вроде `v1.2.3` для PR branches.
- Если branch name превращается в worktree directory или cache key, используйте `encodeGitRef`, а не simple slash replacement.

## Локальные Проверки

```bash
pnpm spec:validate
pnpm -C packages/ts typecheck
pnpm -C packages/ts test
go test ./packages/go/...
```

Держите Go и TypeScript behavior согласованными через `spec/testdata/*.json`.
