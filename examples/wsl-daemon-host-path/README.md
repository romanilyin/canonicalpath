# WSL Daemon Host Path Example

Canonical identity may be Windows-shaped while daemon I/O uses the WSL host path.

```ts
import { normalize } from "@romanilyin/canonicalpath";

const canonicalProjectPath = normalize("/mnt/c/Users/Alice/Repo", {
  sourceHost: "wsl",
  targetProfile: "win32-drive",
  wsl: { enabled: true, mountRoot: "/mnt" },
});

console.log(canonicalProjectPath); // c:/Users/Alice/Repo
```

Daemon registration should keep both values:

```json
{
  "project_id": "project-1",
  "canonical_project_path": "c:/Users/Alice/Repo",
  "host_root_for_daemon_io": "/mnt/c/Users/Alice/Repo"
}
```

Never ask the Go daemon to open `c:/Users/Alice/Repo` inside WSL. Start the daemon with `/mnt/c/Users/Alice/Repo` in its allowed roots, register that path as the host root, and send only project-relative file paths after that.
