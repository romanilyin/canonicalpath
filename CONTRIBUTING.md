# Contributing

Read `AGENTS.md` and `Documentation/README_FOR_AGENTS.md` before changing package behavior.

## Local Checks

```bash
pnpm spec:validate
pnpm -C packages/ts typecheck
pnpm -C packages/ts test
go test ./packages/go/...
```

Keep Go and TypeScript behavior aligned through `spec/testdata/*.json`.
