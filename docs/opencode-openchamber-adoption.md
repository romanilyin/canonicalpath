# OpenCode / OpenChamber Adoption

The full adoption plan is defined in `../Documentation/03_OPENCODE_OPENCHAMBER_ADOPTION_PLAN.md`. This document is the current MVP checklist for applying the implemented packages.

## Project Open Flow

1. Client sends `rawPath`, optional `canonicalPath`, and path context: `clientId`, `clientType`, `hostKind`, and WSL mount settings.
2. Client may precompute `canonicalPath` with TypeScript `canonicalpath.normalize` for identity and UX only.
3. Go daemon recomputes identity with Go `canonicalpath.Normalize` and rejects mismatches.
4. Daemon upserts `projects.canonical_project_path` and registers `project_path_aliases.client_raw_path`.
5. Sessions store `project_id`, not canonical path as a unique session key.

## File Tool Payloads

Use this shape at tool boundaries:

```json
{
  "project_id": "project_123",
  "path": "src/main.go"
}
```

Rules:

- `path` is relative to the exact project root.
- Arbitrary absolute paths must first map to a known project root and then become relative.
- Go file tools open files through `canonicalfs.OpenRoot(...).ReadFile(...)`, `WriteFile(...)`, or `OpenFile(...)`.
- Do not use `filepath.Join(root, userPath)` plus `os.Open` as a sandbox boundary.

## WSL Mapping

Example identity and alias rows for one project:

| Field | Value |
|---|---|
| `projects.canonical_project_path` | `c:/Users/Alice/Repo` |
| WSL `client_raw_path` | `/mnt/c/Users/Alice/Repo` |
| Windows `client_raw_path` | `C:\Users\Alice\Repo` |
| `host_kind` | `wsl` or `win32` |

WSL mount roots are explicit options. Do not hard-code `/mnt` as the only possible mapping.

## Git Worktrees

Use collision-resistant branch directory encoding:

```text
feature/auth -> v2-feature-auth--fc659bd735856486b656ea75488903eac295b13e5d7cce7f55339ed029ceabc6
feature-auth -> v2-feature-auth--473f3d0e807867c2452edc63a8c20f348ddb1bf5fdac7a2647d79e120e2c5256
```

The v2 suffix is the full SHA-256 of the exact UTF-8 ref; the ASCII slug is bounded to 80 characters. Do not use simple slash replacement for branch names. Existing directories require the [ownership-checked migration](../Documentation/IDENTITY_V2_MIGRATION.md); there is no silent legacy fallback.

## Current Package Caveats

- Go `canonicalfs.Rename` is root-bound only on Go `1.26+`; Go `1.24` returns `ErrUnsupportedOperation`.
- TypeScript `canonicalfs` is best-effort/RPC-helper code and must not be used for adversarial local filesystem writes.
- PowerShell 5.1 and PowerShell 7 are supported as lexical/client-only integrations to the Go daemon, not as independent secure filesystem implementations.
- ZIP extraction support currently targets Go `canonicalfs`.
