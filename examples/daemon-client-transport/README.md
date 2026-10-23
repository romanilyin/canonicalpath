# Daemon / Client Transport Example

Create a private per-launch bundle and start the HTTPS daemon using the [bootstrap guide](../../docs/daemon-tls-bootstrap.md). Pass the trusted local path to `connection.json` as `CANONICALFS_CONNECTION_FILE`; never retrieve that file from a network endpoint.

Use the TypeScript HTTP client to register a project root and access project-relative files through the daemon:

```ts
import { readFileSync } from "node:fs";
import { CanonicalFSHTTPClient, CanonicalFSRPCRoot } from "@romanilyin/canonicalpath/canonicalfs";

const connection = JSON.parse(readFileSync(process.env.CANONICALFS_CONNECTION_FILE!, "utf8"));
const client = new CanonicalFSHTTPClient(connection.endpoint, {
  capabilityToken: connection.token,
  tls: { certificateSha256: connection.certificate_sha256, caCertificatePem: connection.ca_certificate_pem },
});
await client.openProject("project-1", "/home/alice/repo");

const root = new CanonicalFSRPCRoot("project-1", client);
await root.writeFile("safe/README.md", new TextEncoder().encode("ok"));
const data = await root.readFile("safe/README.md");

console.log(new TextDecoder().decode(data));
await client.closeProject("project-1");
```

The TypeScript side validates relative paths before transport. The Go daemon requires a bearer capability token for every endpoint except `/healthz`, only registers host roots under its configured `-allow-root` allowlist, and remains the security boundary for real filesystem I/O.
