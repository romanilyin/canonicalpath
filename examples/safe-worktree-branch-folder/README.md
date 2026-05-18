# Safe Worktree Branch Folder Example

Use collision-resistant branch directory encoding for worktree folders.

```ts
import { encodeGitRef } from "@romanilyin/canonicalpath";

console.log(encodeGitRef("feature/auth"));  // feature-auth--fc659bd73585
console.log(encodeGitRef("feature-auth"));  // feature-auth--473f3d0e8078
```

Do not use simple slash replacement. `feature/auth` and `feature-auth` must not collide.
