import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { CanonicalFSHTTPClient, fsErrorCode } from "../src/canonicalfs";
import type { CanonicalRelativePath } from "../src/canonicalpath";

interface RequestRecord {
  url: string;
  authorization?: string;
  body: unknown;
}

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("canonicalfs HTTP client", () => {
  it("sends daemon transport requests and decodes responses", async () => {
    const requests: RequestRecord[] = [];
    const endpoint = await startServer(requests, (url) => {
      if (url === "/v1/caps") {
        return {
          auth_required: true,
          endpoints: ["GET /v1/caps", "POST /v1/fs/readFile"],
          limits: { max_request_bytes: 1024, default_read_bytes: 128, max_read_bytes: 4096, max_response_bytes: 8192 },
        };
      }
      if (url === "/v1/fs/readFile") return { data_base64: Buffer.from("ok", "utf8").toString("base64") };
      if (url === "/v1/fs/stat") return { stat: { path: "safe/file.txt", size: 2, is_directory: false } };
      return {};
    });
    const client = new CanonicalFSHTTPClient(endpoint, { capabilityToken: "test-token" });

    await expect(client.capabilities()).resolves.toEqual({
      authRequired: true,
      endpoints: ["GET /v1/caps", "POST /v1/fs/readFile"],
      limits: { maxRequestBytes: 1024, defaultReadBytes: 128, maxReadBytes: 4096, maxResponseBytes: 8192 },
    });
    await client.openProject("project-1", "/tmp/project");
    await client.mkdirAll("project-1", "safe" as CanonicalRelativePath);
    await client.writeFile("project-1", "safe/file.txt" as CanonicalRelativePath, new TextEncoder().encode("ok"));
    await expect(client.readFile("project-1", "safe/file.txt" as CanonicalRelativePath)).resolves.toEqual(new TextEncoder().encode("ok"));
    await expect(client.stat("project-1", "safe/file.txt" as CanonicalRelativePath)).resolves.toEqual({ path: "safe/file.txt", size: 2, isDirectory: false });
    await client.rename("project-1", "safe/file.txt" as CanonicalRelativePath, "safe/file2.txt" as CanonicalRelativePath);
    await client.remove("project-1", "safe/file2.txt" as CanonicalRelativePath);
    await client.closeProject("project-1");

    expect(requests.map((request) => request.url)).toEqual([
      "/v1/caps",
      "/v1/projects/open",
      "/v1/fs/mkdirAll",
      "/v1/fs/writeFile",
      "/v1/fs/readFile",
      "/v1/fs/stat",
      "/v1/fs/rename",
      "/v1/fs/remove",
      "/v1/projects/close",
    ]);
    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
    ]);
    expect(requests[3]?.body).toEqual({ project_id: "project-1", path: "safe/file.txt", data_base64: Buffer.from("ok", "utf8").toString("base64") });
    expect(requests[6]?.body).toEqual({ project_id: "project-1", path: "safe/file.txt", target: "safe/file2.txt" });
  });

  it("requires a non-empty capability token", async () => {
    const endpoint = await startServer([], () => ({}));

    expect(() => new CanonicalFSHTTPClient(endpoint, { capabilityToken: "" })).toThrow("capabilityToken is required");
  });

  it("maps canonical daemon errors to CanonicalFSError", async () => {
    const endpoint = await startServer([], () => ({ error: { code: "ERR_OUTSIDE_ROOT", message: "path escapes root" } }), 400);
    const client = new CanonicalFSHTTPClient(endpoint, { capabilityToken: "test-token" });

    try {
      await client.readFile("project-1", "../outside.txt" as CanonicalRelativePath);
    } catch (error) {
      expect(fsErrorCode(error)).toBe("ERR_OUTSIDE_ROOT");
      return;
    }
    throw new Error("expected ERR_OUTSIDE_ROOT");
  });

  it("maps daemon transport errors to CanonicalFSError", async () => {
    const endpoint = await startServer([], () => ({ error: { code: "ERR_UNAUTHORIZED", message: "missing or invalid bearer token" } }), 401);
    const client = new CanonicalFSHTTPClient(endpoint, { capabilityToken: "test-token" });

    try {
      await client.capabilities();
    } catch (error) {
      expect(fsErrorCode(error)).toBe("ERR_UNAUTHORIZED");
      return;
    }
    throw new Error("expected ERR_UNAUTHORIZED");
  });

  it("wraps non-JSON daemon responses", async () => {
    const endpoint = await startRawServer(502, "not json");
    const client = new CanonicalFSHTTPClient(endpoint, { capabilityToken: "test-token" });

    await expect(client.readFile("project-1", "safe/file.txt" as CanonicalRelativePath)).rejects.toThrow("ERR_DAEMON: daemon response is not valid JSON");
  });
});

async function startServer(requests: RequestRecord[], respond: (url: string, body: unknown) => unknown, status = 200): Promise<string> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = body ? (JSON.parse(body) as unknown) : undefined;
      requests.push({ url: request.url ?? "", authorization: request.headers.authorization, body: parsed });
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(respond(request.url ?? "", parsed)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address is unavailable");
  servers.push({ close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))) });
  return `http://127.0.0.1:${address.port}`;
}

async function startRawServer(status: number, body: string): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.setHeader("content-type", "text/plain");
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address is unavailable");
  servers.push({ close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))) });
  return `http://127.0.0.1:${address.port}`;
}
