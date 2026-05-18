# SQLite Project Aliases Example

Store project identity separately from client-specific host paths.

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

This avoids making sessions unique by path while still deduplicating project identity.

In WSL, one project may have:

- canonical identity: `c:/Users/Alice/Repo`
- WSL client raw path: `/mnt/c/Users/Alice/Repo`
- Windows client raw path: `C:\Users\Alice\Repo`
