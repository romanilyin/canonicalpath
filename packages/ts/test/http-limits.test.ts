import { createServer, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { CanonicalFSHTTPClient } from "../src/canonicalfs";

const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });
async function endpoint(respond: (response: ServerResponse) => void): Promise<string> {
  const server = createServer((request, response) => { request.resume(); respond(response); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  close.push(() => { server.closeAllConnections(); return new Promise(resolve => server.close(() => resolve())); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no server address");
  return `http://127.0.0.1:${address.port}`;
}
function client(url: string, maxResponseBytes = 1024, timeoutMs = 300) {
  return new CanonicalFSHTTPClient(url, { capabilityToken: "test-token", maxResponseBytes, timeoutMs });
}
it("rejects disabling or raising local hard limits", () => {
  for (const value of [0, -1, Infinity, NaN, 1.5, 24 * 1024 * 1024 + 1]) {
    expect(() => client("http://localhost", value)).toThrow();
  }
  for (const value of [0, -1, Infinity, NaN, 1.5, 30_001]) {
    expect(() => client("http://localhost", 1024, value)).toThrow();
  }
});
it("accepts valid JSON exactly at the local byte limit", async () => {
  const body = JSON.stringify({ padding: "x".repeat(900) });
  const url = await endpoint(response => response.end(body));
  await expect(client(url, Buffer.byteLength(body)).closeProject("p")).resolves.toBeUndefined();
  await expect(client(url, Buffer.byteLength(body) - 1).closeProject("p")).rejects.toMatchObject({ code: "ERR_RESPONSE_TOO_LARGE" });
});
for (const status of [200, 500]) {
  it(`bounds chunked response bytes on HTTP ${status}`, async () => {
    const url = await endpoint(response => {
      response.writeHead(status, { "content-type": "application/json" });
      response.write('{"padding":"'); response.write("x".repeat(4096)); response.end('"}');
    });
    await expect(client(url).closeProject("p")).rejects.toMatchObject({ code: "ERR_RESPONSE_TOO_LARGE" });
  });
}
it("bounds decoded gzip bytes even when Content-Length is small", async () => {
  const compressed = gzipSync(JSON.stringify({ padding: "x".repeat(4096) }));
  expect(compressed.byteLength).toBeLessThan(1024);
  const url = await endpoint(response => {
    response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": compressed.byteLength });
    response.end(compressed);
  });
  await expect(client(url).closeProject("p")).rejects.toMatchObject({ code: "ERR_RESPONSE_TOO_LARGE" });
});
for (const mode of ["headers", "body", "drip"]) {
  it(`applies the overall deadline to stalled ${mode}`, async () => {
    const url = await endpoint(response => {
      if (mode === "headers") return;
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"padding":"');
      if (mode === "drip") {
        const timer = setInterval(() => response.write("x"), 20);
        response.on("close", () => clearInterval(timer));
      }
    });
    const started = Date.now();
    await expect(client(url).closeProject("p")).rejects.toMatchObject({ code: "ERR_DAEMON", message: expect.stringContaining("timed out") });
    expect(Date.now() - started).toBeLessThan(2000);
  });
}
it("keeps its deadline when a custom fetch ignores cancellation", async () => {
  let signal: AbortSignal | undefined;
  const transport = new CanonicalFSHTTPClient("http://unused", {
    capabilityToken: "test-token", timeoutMs: 50,
    fetch: (_url, init) => { signal = init.signal; return new Promise<Response>(() => {}); },
  });
  await expect(transport.closeProject("p")).rejects.toMatchObject({ code: "ERR_DAEMON" });
  expect(signal?.aborted).toBe(true);
});
