# AGENTS.md

## Current State

- Go and TypeScript MVP implementations exist for `canonicalpath` and `canonicalfs`; JavaScript standalone/browser, Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, and GDScript/Godot have lexical-only `canonicalpath` packages; Bash and Windows CMD/BAT have experimental transport wrappers for the Go daemon; PowerShell 5.1 and PowerShell 7 have an experimental lexical module plus typed daemon HTTP client helpers; Unity has early managed, bridge, daemon transport, EditMode, Burst surface, optional Burst compiler/allocation probes, and an active local Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` EditMode and Burst allocation matrix.
- Shared JSON vectors, fixture manifests, and `spec/language-targets.json` are the source of truth for cross-language behavior, target support, and allocation-check planning.
- Go `canonicalfs` is the authoritative root-bound implementation using Go `os.Root`; TypeScript `canonicalfs` remains best-effort/RPC-helper only; PowerShell module support is lexical/client-only and must delegate security-sensitive I/O to Go.
- GitHub workflows are configured as manual-only (`workflow_dispatch`) because free GitHub Actions minutes are exhausted; the limit is expected to refresh on June 1. Do not run Actions or re-enable automatic `push`, `pull_request`, or `schedule` triggers unless the user asks.
- Use the docs as the source of project intent: `Documentation/README_FOR_AGENTS.md`, then `Documentation/01_MONOREPO_ARCHITECTURE.md`, `Documentation/02_PROBLEM_MODEL_AND_THREAT_MODEL.md`, and `Documentation/03_OPENCODE_OPENCHAMBER_ADOPTION_PLAN.md`.
- Commands in `README.md`, `package.json`, `go.work`, and `.github/workflows/` are real checks; deeper commands shown only in `Documentation/` may still be design targets.

## Communication

- Chat with the user in Russian; technical terms may stay in English.
- Write commit messages in English in "what was done" form, for example `add specification scaffold`.

## Architecture

- Keep the split strict: `CanonicalPath` is deterministic lexical identity/serialization; `CanonicalFS` is root-bound real filesystem access; `PathAliases` map one canonical root to client-specific host paths.
- `CanonicalPath` must not touch the filesystem or be treated as a security boundary. Use it for DB keys, project/session identity, RPC payloads, UI labels, and dedupe.
- `CanonicalFS` must accept paths relative to the exact project root and use root-bound primitives such as Go `os.Root` / `OpenInRoot` or Linux `openat2(RESOLVE_IN_ROOT)`.
- Never implement secure file access as `filepath.Join(root, userPath)` followed by `os.Open`, or as Node `path.resolve` / `path.normalize` plus `fs` access.
- Go is the authoritative `canonicalfs` implementation. TypeScript `canonicalfs` must be an RPC/best-effort helper and must not claim TOCTOU-proof security.

## First Implementation

- Continue from shared `spec/` first: JSON Schema plus `spec/testdata/*.json`; Go, TypeScript, and JavaScript standalone implementations must consume the same vectors.
- MVP package targets are `packages/go/canonicalpath`, `packages/go/canonicalfs`, `packages/ts/canonicalpath`, `packages/ts/canonicalfs`, and `packages/javascript-standalone`.
- C#/.NET, Swift, Kotlin, Python, Dart/Flutter, C, Rust, C++, Haxe, and GDScript/Godot have started as experimental lexical targets from shared vectors; C#/.NET, Swift, Kotlin, Haxe, and GDScript/Godot daemon transports plus the full Unity package remain planned next-phase targets. Minimal Unity bridge `ICanonicalPathService` + `PathGuard` is earlier than Unity write commands and must stay a small adapter/facade, not a full library target. PowerShell 5.1 and PowerShell 7 are MVP-supported through the experimental lexical `CanonicalPath` module and typed JSON HTTP client to the Go daemon.
- Intended tooling, once files exist, is pnpm workspaces for TS/examples and a Go workspace/module under `packages/go`.

## Path Rules

- Lowercase only the Windows drive letter; never lowercase the full path.
- WSL `/mnt/<drive>/` mapping must be explicit and configurable, not hard-coded as the only truth.
- Reject NUL everywhere and reject Windows drive-relative paths like `C:foo` by default.
- URI decoding must happen exactly once; reject encoded `/` and `\` by default.
- `relative(root, target)` must be component-aware and reject prefix siblings such as `/app` vs `/app-evil` or `c:/repo` vs `c:/repo-evil`.
- Do not use string prefix checks as a sandbox boundary.
- Git worktree/branch directory names need collision-resistant encoding such as `slug--shortHash`, not simple slash replacement.
- Unity bridge payload paths must reject absolute paths, NUL, `../` traversal, and anything outside `Assets/...` or `Packages/...` before write commands run.

## Integration Rules

- File tool payloads should use `project_id` plus a path relative to project root; arbitrary absolute paths must first map to a known project root and then become relative.
- In WSL, canonical identity may be `c:/Users/Alice/Repo`, but daemon I/O must use a host path such as `/mnt/c/Users/Alice/Repo`.
- Store project identity in `projects.canonical_project_path` and link sessions with `sessions.project_id`; do not make sessions unique by canonical path.
- Store path aliases by project and client/environment, not only by `client_type`.

## Verification

- Default local verification gate: `pnpm verify` and `pnpm go:race`.
- `pnpm verify` runs spec validation, TS typecheck/tests, JavaScript standalone typecheck/build/package-export smoke/tests, Go tests, Go/TS/JS vector result comparison, Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, and GDScript/Godot vector smokes, Bash and Windows CMD/BAT wrapper transport smokes, Unity local smokes/probes and the `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` EditMode matrix, and PowerShell vector/daemon smoke tests when PowerShell is available.
- `pnpm alloc` runs active allocation/memory smoke gates for Go, TypeScript, JavaScript standalone, Python, Dart/Flutter, C#/.NET, Swift, Kotlin, C, Rust, C++, Haxe, GDScript/Godot, the Bash and Windows CMD/BAT wrappers, the PowerShell module, PowerShell live daemon transport when PowerShell is available, Unity managed CanonicalPath, the default-skipped optional Unity Burst allocation probe, and the active local Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` Burst allocation matrix.
- If the `pnpm` shim is unavailable but `corepack` exists, use `corepack pnpm ...` for the same commands.
- Require cross-language vector equivalence, `normalize` idempotence/fuzz tests, and real filesystem fixtures for `..`, absolute paths, symlink escape, prefix bypass, archive traversal, and race attempts.
- Require every language target to have an allocation-check plan in `spec/language-targets.json`; do not add new target rows without a planned or active allocation gate.
- For `canonicalfs`, real security fixture tests matter more than lexical-only tests.
