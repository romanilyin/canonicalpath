# Safe Worktree Branch Folder Example

Use collision-resistant branch directory encoding for worktree folders.

```ts
import { encodeGitRef } from "@romanilyin/canonicalpath";

console.log(encodeGitRef("feature/auth"));  // v2-feature-auth--fc659bd735856486b656ea75488903eac295b13e5d7cce7f55339ed029ceabc6
console.log(encodeGitRef("feature-auth"));  // v2-feature-auth--473f3d0e807867c2452edc63a8c20f348ddb1bf5fdac7a2647d79e120e2c5256
```

Do not use simple slash replacement. `feature/auth` and `feature-auth` must not collide.
