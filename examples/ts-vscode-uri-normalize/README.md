# TypeScript VS Code URI Normalize Example

Use TypeScript `canonicalpath` on the client side to send the daemon both raw path context and deterministic identity.

```ts
import { normalize } from "@romanilyin/canonicalpath";

const canonicalPath = normalize("file:///c%3A/Users/Alice/Repo", {
  sourceHost: "vscode-file-uri",
  targetProfile: "win32-drive",
  uri: {
    allowFileUri: true,
    rejectEncodedSlash: true,
  },
});

console.log(canonicalPath); // c:/Users/Alice/Repo
```

RPC payloads should include:

- `rawPath`: the original client path or URI.
- `canonicalPath`: deterministic project identity.
- `context`: client id, client type, host kind, and WSL mount settings when relevant.

Do not use client-side normalization as a filesystem security boundary.
