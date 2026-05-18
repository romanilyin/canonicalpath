# Git Status Path Mapping Example

Git output is usually relative to the repository root. Keep that shape for file tools.

```ts
import { join, normalize, relative } from "@romanilyin/canonicalpath";
import type { CanonicalPath, CanonicalRelativePath } from "@romanilyin/canonicalpath";

const projectRoot = normalize("/home/alice/repo", { sourceHost: "posix", targetProfile: "posix" });
const gitPath = "src/main.ts" as CanonicalRelativePath;

const canonicalFile = join(projectRoot, gitPath);
const toolPath = relative(projectRoot, canonicalFile as CanonicalPath);

console.log(toolPath); // src/main.ts
```

Rules:

- Treat Git paths as project-relative unless Git explicitly reports an absolute path.
- If an absolute path appears, normalize it and derive `relative(projectRoot, target)` before file I/O.
- Reject prefix siblings such as `/home/alice/repo-evil/file.txt`.
