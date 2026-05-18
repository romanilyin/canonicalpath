# Contributing

Read `AGENTS.md` and `Documentation/README_FOR_AGENTS.md` before changing package behavior.

## Pull Requests

All changes to `main` should go through a pull request, even for repository owners. Keep PRs focused on one behavior or repository-maintenance change.

Use the PR template checklist and include the local verification command you ran. If a change affects path behavior, update shared vectors or filesystem fixtures in the same PR.

## Branch Naming

Use lowercase ASCII branch names in this form:

```text
<type>/<short-kebab-topic>
```

Allowed types:

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

Examples:

```text
feature/scoped-daemon-client
fix/windows-drive-relative-reject
docs/security-disclosure
l10n/russian-docs
chore/release-readiness-workflow
```

Rules:

- Use lowercase letters, digits, and hyphens in the topic.
- Keep exactly one slash between the type and topic.
- Use `l10n` for documentation translation or localization-only changes.
- Do not put secrets, hostnames, private directory names, customer names, or tokens in branch names.
- Do not use `main`, `master`, `release`, or tag-like names such as `v1.2.3` for PR branches.
- If a branch name is converted into a worktree directory or cache key, use `encodeGitRef` instead of simple slash replacement.

## Local Checks

```bash
pnpm spec:validate
pnpm -C packages/ts typecheck
pnpm -C packages/ts test
go test ./packages/go/...
```

Keep Go and TypeScript behavior aligned through `spec/testdata/*.json`.
