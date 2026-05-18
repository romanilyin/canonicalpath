# 03 — Применение CanonicalPath / CanonicalFS для фиксов opencode и openchamber

## Назначение документа

Этот документ описывает, как использовать новый репозиторий `canonicalpath` / `canonicalfs` для исправления path-related проблем в `opencode`, `openchamber`, VS Code extension, desktop/web UI, Go daemon и Git/file tools.

Документ написан как инструкция для AI-агентов, которые будут открывать PR в существующих репозиториях.

## Репозитории и полезные ссылки

- Archived `opencode-ai/opencode`: https://github.com/opencode-ai/opencode
- Active `OpenChamber`: https://github.com/openchamber/openchamber
- OpenChamber AGENTS.md: https://github.com/openchamber/openchamber/blob/main/AGENTS.md
- OpenChamber releases: https://github.com/openchamber/openchamber/releases
- OpenCode website/docs: https://opencode.ai/
- OpenCode GitHub integration docs: https://opencode.ai/docs/github/
- Charm Crush continuation reference: https://github.com/charmbracelet/crush
- Go traversal-resistant file APIs: https://go.dev/blog/osroot
- Go `os.OpenInRoot`: https://pkg.go.dev/os#OpenInRoot
- Linux `openat2(2)`: https://man7.org/linux/man-pages/man2/openat2.2.html
- `cyphar/filepath-securejoin`: https://github.com/cyphar/filepath-securejoin
- MITRE CWE-22: https://cwe.mitre.org/data/definitions/22.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- Snyk Zip Slip: https://security.snyk.io/research/zip-slip-vulnerability

## Core migration principle

Do not try to “normalize paths everywhere” as a mechanical replacement. That usually spreads bugs.

Instead, introduce three explicit concepts:

```text
ProjectIdentity:
  canonical_project_path
  stable project_id

PathAlias:
  client-specific raw root path
  host kind
  client id / environment fingerprint

SafeProjectFS:
  root-bound file operations
  only relative paths inside project root
```

## Target architecture

```text
[VS Code / Web / Desktop]
  raw path or file URI
  client_env metadata
       |
       v
[Client canonicalpath TS]
  normalize for identity
  send RPC payload with raw + canonical + env
       |
       v
[Go daemon]
  canonicalpath Go validates same identity
  projects table lookup
  path alias registration
  project root host path selection
       |
       v
[canonicalfs Go]
  open root handle
  file tools operate on relative paths
  safe read/write/edit/patch/glob/grep
```

## Phase 0 — Audit current path surfaces

Before changing code, find all path ingress points.

Search patterns:

```bash
rg "path\.resolve|path\.normalize|fileURLToPath|Uri\.file|vscode\.Uri|fs\.readFile|fs\.writeFile" .
rg "filepath\.|path\.Clean|os\.Open|os\.ReadFile|os\.WriteFile|EvalSymlinks|HasPrefix" .
rg "worktree|git status|git diff|git ls-files|branch" .
rg "session|project.*path|cwd|root|workspace" .
```

Classify every occurrence:

| Category | Examples | Action |
|---|---|---|
| Identity | session key, project key, DB lookup | Use `canonicalpath.Normalize` |
| Display | UI path label, recent projects | Use alias/raw path for that client |
| RPC | project open payload, file tool payload | Send canonical + raw + env |
| I/O | read/write/edit/patch/stat | Use `canonicalfs.Root` |
| Git | status/diff/worktree | Use repo root + relative paths; encode branch dirs |
| Config | `.opencode.json`, workspace config | Normalize keys, preserve user-facing raw values |

## Phase 1 — Introduce canonical project identity

### Data model

Avoid this model:

```sql
ALTER TABLE sessions ADD COLUMN canonical_project_path TEXT;
CREATE UNIQUE INDEX idx_sessions_canonical_path ON sessions(canonical_project_path);
```

Reason: one project can have multiple sessions.

Use this model:

```sql
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    canonical_project_path TEXT NOT NULL UNIQUE,
    display_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_path_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_type TEXT NOT NULL,
    host_kind TEXT NOT NULL,
    client_raw_path TEXT NOT NULL,
    canonical_project_path TEXT NOT NULL,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, client_id, client_raw_path)
);

ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
```

### Project open flow

Pseudo-code:

```go
type OpenProjectRequest struct {
    RawPath string `json:"raw_path"`
    CanonicalPath string `json:"canonical_path,omitempty"`
    ClientID string `json:"client_id"`
    ClientType string `json:"client_type"`
    HostKind string `json:"host_kind"`
    WSLMountRoot string `json:"wsl_mount_root,omitempty"`
}

func OpenProject(ctx context.Context, req OpenProjectRequest) (*Project, error) {
    opts := canonicalpath.OptionsFromClient(req.HostKind, req.WSLMountRoot)
    canon, err := canonicalpath.Normalize(req.RawPath, opts)
    if err != nil {
        return nil, err
    }

    if req.CanonicalPath != "" && req.CanonicalPath != canon {
        return nil, ErrCanonicalMismatch
    }

    project, err := db.UpsertProjectByCanonicalPath(ctx, canon)
    if err != nil {
        return nil, err
    }

    err = db.RegisterProjectPathAlias(ctx, ProjectPathAlias{
        ProjectID: project.ID,
        ClientID: req.ClientID,
        ClientType: req.ClientType,
        HostKind: req.HostKind,
        ClientRawPath: req.RawPath,
        CanonicalProjectPath: canon,
    })
    if err != nil {
        return nil, err
    }

    return project, nil
}
```

### Migration strategy

1. Add new tables and nullable `sessions.project_id`.
2. On daemon start, scan existing sessions with path fields.
3. Normalize old path to canonical.
4. Create/update `projects` rows.
5. Backfill `sessions.project_id`.
6. Keep old columns for one release.
7. Add logs for ambiguous paths.
8. In later release, remove old path-as-identity logic.

Pseudo-code:

```go
func MigrateSessionProjectIDs(ctx context.Context) error {
    sessions := db.ListSessionsWithoutProject(ctx)
    for _, s := range sessions {
        if s.ProjectPath == "" { continue }
        canon, err := canonicalpath.Normalize(s.ProjectPath, canonicalpath.DefaultOptions())
        if err != nil {
            log.Warn("cannot normalize legacy session path", "session", s.ID, "err", err)
            continue
        }
        p, err := db.UpsertProjectByCanonicalPath(ctx, canon)
        if err != nil { return err }
        if err := db.SetSessionProject(ctx, s.ID, p.ID); err != nil { return err }
    }
    return nil
}
```

## Phase 2 — Introduce client environment and aliases

### Client environment payload

Every client that opens a project should identify its path context.

```ts
export interface ClientPathContext {
  clientId: string;
  clientType: "vscode" | "web" | "desktop" | "cli" | "server";
  hostKind: "win32" | "posix" | "wsl" | "dev-container" | "ssh-remote";
  platform: NodeJS.Platform;
  wsl?: {
    enabled: boolean;
    mountRoot: string;
    distro?: string;
  };
}

export interface OpenProjectPayload {
  rawPath: string;
  canonicalPath: string;
  context: ClientPathContext;
}
```

### VS Code extension

When receiving a `vscode.Uri`, do not treat `.path` as final host path. Use URI-aware conversion.

Dangerous:

```ts
const root = uri.path;
```

Better:

```ts
import { normalize } from "@openchamber/canonicalpath";

const rawPath = uri.toString(); // preserve file URI semantics
const canonicalPath = normalize(rawPath, {
  sourceHost: "vscode-file-uri",
  targetProfile: "win32-drive",
  uri: {
    allowFileUri: true,
    allowVSCodeFileUri: true,
    rejectEncodedSlash: true,
  },
  wsl: detectWSLContext(),
});

await api.openProject({
  rawPath,
  canonicalPath,
  context: getClientPathContext(),
});
```

### WSL daemon

If daemon runs inside WSL, it cannot use `c:/repo` for I/O. It should use alias selection or `ToWSL`.

```go
func HostPathForDaemon(canon canonicalpath.Path, env DaemonEnv) (string, error) {
    if env.HostKind == "wsl" && canon.IsWindowsDrive() {
        return canonicalpath.ToWSL(canon, canonicalpath.WSLOptions{MountRoot: env.WSLMountRoot})
    }
    return canonicalpath.ToHost(canon, env.HostKind)
}
```

Important: `canonical_project_path` remains `c:/Users/Alice/Repo`, but the actual root opened by `canonicalfs` in WSL is `/mnt/c/Users/Alice/Repo`.

## Phase 3 — Replace unsafe file tools with SafeProjectFS

### New internal abstraction

Create an internal package in daemon:

```text
internal/projectfs/
  projectfs.go
  tools.go
  git.go
  errors.go
  tests/
```

Pseudo-code:

```go
type ProjectFS struct {
    ProjectID string
    CanonicalRoot canonicalpath.Path
    HostRoot string
    Root *canonicalfs.Root
}

func OpenProjectFS(ctx context.Context, projectID string, daemonEnv DaemonEnv) (*ProjectFS, error) {
    p := db.GetProject(ctx, projectID)
    hostRoot, err := HostPathForDaemon(p.CanonicalProjectPath, daemonEnv)
    if err != nil { return nil, err }
    root, err := canonicalfs.OpenRoot(hostRoot)
    if err != nil { return nil, err }
    return &ProjectFS{ProjectID: projectID, CanonicalRoot: p.CanonicalProjectPath, HostRoot: hostRoot, Root: root}, nil
}
```

### File tool contract

All tool requests should use `project_id` and `path` relative to project root:

```json
{
  "tool": "view",
  "project_id": "proj_123",
  "path": "src/main.ts"
}
```

Do not accept arbitrary absolute path in tool calls. If backward compatibility requires absolute path, convert once:

```go
func NormalizeToolPath(project Project, raw string) (canonicalpath.RelativePath, error) {
    canon, err := canonicalpath.Normalize(raw, options)
    if err != nil { return "", err }
    return canonicalpath.Relative(project.CanonicalRoot, canon)
}
```

`Relative` must be component-aware and reject sibling prefixes.

### Safe read example

```go
func (pfs *ProjectFS) View(rel string) ([]byte, error) {
    safeRel, err := canonicalpath.NormalizeRelative(rel)
    if err != nil { return nil, err }
    return pfs.Root.ReadFile(string(safeRel), MaxViewBytes)
}
```

### Safe write example

```go
func (pfs *ProjectFS) Write(rel string, data []byte) error {
    safeRel, err := canonicalpath.NormalizeRelative(rel)
    if err != nil { return err }
    return pfs.Root.WriteFile(string(safeRel), data, canonicalfs.OpenOptions{
        Create: true,
        Truncate: true,
        Mode: 0644,
    })
}
```

### Safe patch/edit

Patch/edit should:

1. Open target through `ProjectFS`.
2. Read content through root-bound file.
3. Apply patch in memory.
4. Write temp file inside same root and directory.
5. Rename through root-bound API.
6. Never write temp outside project.

Pseudo-code:

```go
func (pfs *ProjectFS) AtomicEdit(rel string, transform func([]byte) ([]byte, error)) error {
    old, err := pfs.Root.ReadFile(rel, MaxEditBytes)
    if err != nil { return err }

    next, err := transform(old)
    if err != nil { return err }

    tmp := rel + ".tmp-" + randomSuffix()
    if err := pfs.Root.WriteFile(tmp, next, canonicalfs.OpenOptions{Create: true, Exclusive: true, Mode: 0644}); err != nil {
        return err
    }
    return pfs.Root.Rename(tmp, rel)
}
```

## Phase 4 — Fix Git integration

### Git root

Git should run from the host root selected for the daemon:

```go
cmd := exec.CommandContext(ctx, "git", "-C", pfs.HostRoot, "status", "--porcelain=v1", "-z")
```

Do not shell-concatenate command strings.

### Parse NUL-delimited output

Use `-z` for machine parsing so filenames with spaces/newlines are safe.

Map each Git relative path:

```go
rel := parseGitPath(entry)
canonAbs := canonicalpath.Join(pfs.CanonicalRoot, rel)
```

### Worktree directory names

Bad:

```go
safeBranchName := strings.ReplaceAll(branchName, "/", "__")
```

Better:

```go
func WorktreeDirName(branch string) string {
    slug := canonicalpath.SanitizeComponent(branch, canonicalpath.PortableComponent)
    hash := shortSHA256(branch, 10)
    if len(slug) > 48 {
        slug = slug[:48]
    }
    return slug + "--" + hash
}
```

Examples:

```text
feature/auth     -> feature-auth--0b3c91d9aa
feature__auth    -> feature__auth--6a1bd2e917
bugfix/wsl-paths -> bugfix-wsl-paths--9f8d2c4410
```

This prevents collisions and keeps folder names readable.

### Worktree path

```go
func GenerateWorktreePath(pfs *ProjectFS, branch string) (string, error) {
    dir := WorktreeDirName(branch)
    rel := canonicalpath.JoinRelative(".opencode/worktrees", dir)
    return pfs.Root.MkdirAll(rel, 0755)
}
```

Use host path only at the final Git command boundary if Git requires a path argument.

## Phase 5 — Fix UI and recent projects

### Recent projects should store canonical + aliases

UI model:

```ts
interface RecentProject {
  projectId: string;
  canonicalProjectPath: string;
  displayPath: string;
  clientRawPath: string;
  hostKind: string;
  lastSeenAt: string;
}
```

Display path selection:

1. Prefer alias for same `clientId`.
2. Then alias for same `hostKind`.
3. Then canonical path converted to host kind.
4. Fallback to canonical path.

### Do not show canonical path blindly

For WSL users, `c:/Users/Alice/Repo` may be the correct identity but a confusing display. Show `/mnt/c/Users/Alice/Repo` in WSL contexts if that is how the user opened it.

## Phase 6 — Fix config loading

Config files like `.opencode.json` or workspace config should store both canonical identity and user-facing raw path if needed.

Suggested config shape:

```json
{
  "projects": [
    {
      "project_id": "proj_123",
      "canonical_project_path": "c:/Users/Alice/Repo",
      "aliases": [
        {
          "client_type": "vscode",
          "host_kind": "win32",
          "raw_path": "C:\\Users\\Alice\\Repo"
        },
        {
          "client_type": "cli",
          "host_kind": "wsl",
          "raw_path": "/mnt/c/Users/Alice/Repo"
        }
      ]
    }
  ]
}
```

Migration:

- Read legacy raw path.
- Normalize to canonical.
- Preserve raw path as alias.
- Write new config atomically.
- Back up old config.

## Phase 7 — Add regression tests in opencode/openchamber

### Required unit tests

1. `C:\repo`, `c:/repo`, `/mnt/c/repo`, `file:///c%3A/repo` map to one project.
2. `sessions` can have multiple rows for one `project_id`.
3. alias lookup returns correct path for WSL and Windows clients.
4. `relative(c:/repo, c:/repo-evil/file)` fails.
5. Git branch `feature/auth` and `feature__auth` produce different worktree dirs.
6. VS Code URI path with spaces decodes once.
7. encoded slash is rejected by default.

### Required integration tests

1. VS Code client on Windows opens repo; daemon in WSL sees same project.
2. Web UI recent project opens the existing project, not a duplicate.
3. `view` cannot read `../../.ssh/id_rsa`.
4. `write` cannot write outside root through symlink.
5. `patch` temp file is created inside project root.
6. `git status -z` with weird filenames maps correctly.

### E2E fixture design

```text
tmp/
  fixture/
    project/
      src/main.ts
      link_out -> ../outside
      .opencode/
    outside/
      secret.txt
```

Test cases:

```text
view src/main.ts                       -> success
view ../outside/secret.txt             -> fail
view link_out/secret.txt               -> fail
write link_out/pwned.txt               -> fail
patch src/main.ts                      -> success
patch ../outside/secret.txt            -> fail
```

## Phase 8 — Deprecate direct path APIs

Add deprecation comments and runtime warnings to old API surfaces that accept arbitrary paths.

Example:

```go
// Deprecated: use ProjectFS.View(projectID, relativePath). This function accepts
// arbitrary host paths and cannot enforce project-root confinement.
func ViewPath(path string) ([]byte, error) { ... }
```

Telemetry/logging:

```text
WARN deprecated_absolute_tool_path_used tool=view project=proj_123
```

Do not remove old APIs immediately if clients still rely on them. Add compatibility shim:

```go
func CompatibilityView(projectID string, rawPath string) ([]byte, error) {
    project := db.GetProject(projectID)
    rel, err := NormalizeToolPath(project, rawPath)
    if err != nil { return nil, err }
    pfs := OpenProjectFS(projectID)
    return pfs.View(rel)
}
```

## Suggested PR sequence

For Unity-first bridge work, use this priority before enabling Unity write commands:

1. [x] Gateway skeleton + public docs.
2. [x] MCP tools + fake bridge.
3. [x] TypeScript `CanonicalPathService` / `CanonicalPathBroker`.
4. [x] Minimal Unity `ICanonicalPathService` + `PathGuard`.
5. [x] Unity Bridge built-in read/status/log commands.
6. [x] Unity Bridge write commands: `assets.refresh`, `scene.save`, `asset.import`, prefab/module commands.
7. [x] Standalone C#/.NET lexical target is active; full Unity package hardening remains pending while managed shared-vector/allocation smoke, the Unity `2022.3` / `6000.1` / `6000.2` / `6000.3` / `6000.4` EditMode matrix, Burst-compatible unsafe buffer surface smoke, optional Burst compiler/allocation probes, and the same versioned Burst zero-GC allocation matrix are active locally.
8. [x] Optional CanonicalFS/daemon integration for real filesystem I/O; Go daemon remains the security boundary.

`PathGuard` must reject null/empty invalid inputs, NUL, absolute paths from agent payloads, non-`Assets/...`/`Packages/...` Unity paths, `../` traversal, and unsafe generated filenames before write commands are exposed.

### PR 1 — Add dependency and adapters

- Add `canonicalpath` dependency to Go and TS.
- Add internal adapter packages.
- Add unit tests for path normalization.
- No behavior change yet.

### PR 2 — Add DB project identity tables

- Add migrations.
- Add `projects` and `project_path_aliases` queries.
- Backfill `sessions.project_id`.
- Add migration tests.

### PR 3 — Update project open flow

- Update client payloads.
- Normalize and upsert project.
- Register alias.
- Keep old fields for compatibility.

### PR 4 — SafeProjectFS for read-only tools

- Introduce `internal/projectfs`.
- Convert `view`, `ls`, `glob`, `grep` to project-relative paths.
- Add traversal and symlink tests.

### PR 5 — SafeProjectFS for write tools

- Convert `write`, `edit`, `patch`.
- Add atomic temp write inside root.
- Add symlink and traversal write tests.

### PR 6 — Git and worktrees

- Parse Git `-z` output.
- Map Git relative paths to canonical root.
- Replace branch folder logic with slug + hash.
- Add collision tests.

### PR 7 — UI aliases and recent projects

- Update recent projects storage and display.
- Prefer alias matching current client context.
- Add UI tests for Windows/WSL display.

### PR 8 — Remove/deprecate old path-as-identity logic

- Remove old duplicate lookup paths.
- Keep migration fallback.
- Update docs.

## Code snippets for agents

### Component-aware relative check

```go
func RelativeInside(root, target canonicalpath.Path) (canonicalpath.RelativePath, error) {
    r := strings.TrimSuffix(string(root), "/")
    t := string(target)

    if t == r {
        return ".", nil
    }
    if !strings.HasPrefix(t, r + "/") {
        return "", ErrOutsideRoot
    }
    rel := strings.TrimPrefix(t, r + "/")
    if rel == "" || strings.HasPrefix(rel, "../") || rel == ".." {
        return "", ErrOutsideRoot
    }
    return canonicalpath.NormalizeRelative(rel)
}
```

Note: this is acceptable for identity-level relative derivation after both paths are canonical. It is not sufficient for real I/O security.

### Go `os.OpenInRoot` one-shot read

```go
func ReadProjectFile(hostRoot string, rel string, limit int64) ([]byte, error) {
    if filepath.IsAbs(rel) {
        return nil, ErrAbsolutePathNotAllowed
    }

    f, err := os.OpenInRoot(hostRoot, rel)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    return io.ReadAll(io.LimitReader(f, limit))
}
```

### RPC payload example

```json
{
  "type": "project.open",
  "raw_path": "file:///c%3A/Users/Alice/Repo",
  "canonical_path": "c:/Users/Alice/Repo",
  "client": {
    "client_id": "vscode:machine-abc",
    "client_type": "vscode",
    "host_kind": "win32",
    "platform": "win32"
  }
}
```

### File tool payload example

```json
{
  "type": "tool.view",
  "project_id": "proj_123",
  "path": "src/main.ts"
}
```

## Review checklist for opencode/openchamber PRs

Reject or request changes if:

- [ ] a file tool accepts arbitrary absolute path without project_id;
- [ ] sandbox check uses `strings.HasPrefix` as security boundary;
- [ ] code uses `filepath.Join(root, userPath)` and then `os.Open`;
- [ ] TS/Node `path.resolve` is treated as security;
- [ ] WSL daemon tries to open `c:/...` directly;
- [ ] full path is lowercased;
- [ ] branch slash is replaced without collision protection;
- [ ] project identity is stored only in `sessions` with unique path;
- [ ] aliases are keyed only by `client_type`;
- [ ] URI is decoded more than once or encoded slash is accepted silently.

Approve only if:

- [ ] identity layer and access layer are separate;
- [ ] project root has stable canonical ID;
- [ ] client raw path is preserved as alias;
- [ ] file tools use relative paths and root-bound I/O;
- [ ] tests cover Windows, WSL, POSIX and symlink escape;
- [ ] migration is backward compatible;
- [ ] docs explain limitations.

## Rollout and compatibility plan

### Release N

- Add new tables.
- Add alias registration.
- Keep old path fields.
- File tools still support old payloads through compatibility shim.
- Add warnings.

### Release N+1

- Default new clients to project_id + relative path.
- Convert read-only tools.
- Enable strict path validation.

### Release N+2

- Convert write tools.
- Disable arbitrary absolute path tool calls by default.
- Keep escape hatch behind config flag for one release.

### Release N+3

- Remove escape hatch.
- Remove old path-as-session-key logic.

## User-facing behavior changes

Expected improvements:

- Opening the same Windows project from VS Code and WSL no longer creates duplicate projects.
- Recent projects display paths in the format expected by the current client.
- File tools stop reading/writing outside project root.
- Git worktrees no longer break on slash-named branches.
- Projects with spaces and URI-encoded characters open reliably.

Possible breaking changes:

- Absolute paths in tool calls may be rejected.
- Symlinks pointing outside project may no longer be readable/writable.
- Windows reserved names may be rejected or escaped.
- Some legacy sessions may require migration if their old path cannot be normalized.

## Issue templates to create

### Path identity bug

```markdown
## Environment
- OS:
- Client: VS Code / Web / Desktop / CLI
- Daemon host: native / WSL / container / SSH

## Paths
- Raw path shown by client:
- Raw path used by daemon:
- Expected canonical path:

## Symptom
- Duplicate project/session?
- File tool failure?
- Wrong recent project?

## Logs
Attach redacted daemon logs with project_id and error code.
```

### Sandbox escape bug

```markdown
## Environment
- OS:
- Filesystem:
- Go version:

## Fixture
Describe symlinks, paths, archive entries, or traversal payloads.

## Expected
Operation should fail with ERR_OUTSIDE_ROOT or ERR_SYMLINK_ESCAPE.

## Actual
Describe file read/write outside root.
```

## Final agent instruction

When implementing fixes in `opencode` or `openchamber`, always ask:

1. Is this path being used for identity, display, or I/O?
2. If identity: use `canonicalpath`.
3. If display: use client alias.
4. If I/O: use project_id + relative path + `canonicalfs`.
5. If Git: use repo root + `-z` output + relative mapping.
6. If worktree: use collision-resistant component encoding.

Any PR that cannot answer these questions should be split before merging.
