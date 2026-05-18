# Daemon / Client Transport Example

Run the Go canonicalfs daemon locally:

```bash
CANONICALFS_DAEMON_TOKEN=dev-token go run ./packages/go/cmd/canonicalfs-daemon -listen 127.0.0.1:8765 -allow-root /home/alice/repo
```

Use the TypeScript HTTP client to register a project root and access project-relative files through the daemon:

```ts
import { CanonicalFSHTTPClient, CanonicalFSRPCRoot } from "@romanilyin/canonicalpath/canonicalfs";

const client = new CanonicalFSHTTPClient("http://127.0.0.1:8765", { capabilityToken: "dev-token" });
await client.openProject("project-1", "/home/alice/repo");

const root = new CanonicalFSRPCRoot("project-1", client);
await root.writeFile("safe/README.md", new TextEncoder().encode("ok"));
const data = await root.readFile("safe/README.md");

console.log(new TextDecoder().decode(data));
await client.closeProject("project-1");
```

The TypeScript side validates relative paths before transport. The Go daemon requires a bearer capability token for every endpoint except `/healthz`, only registers host roots under its configured `-allow-root` allowlist, and remains the security boundary for real filesystem I/O.
