import { createServer } from "node:https";
import { createServer as createPlainServer } from "node:http";
import type { ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createTlsFixture, type TLSFixture } from "../../../scripts/tls-test-fixture.mjs";
import { CanonicalFSHTTPClient } from "../src/canonicalfs/http.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
function certificate(options?: { subjectAltName: string }): TLSFixture {
  const fixture = createTlsFixture(options);
  cleanup.push(() => fixture.dispose());
  return fixture;
}
async function server(fixture?: TLSFixture, respond: (response: ServerResponse) => void = response => response.end("{}")) {
  const received: Array<string | undefined> = [];
  const handler = (request: import("node:http").IncomingMessage, response: ServerResponse) => {
    received.push(request.headers.authorization); request.resume(); respond(response);
  };
  const instance = fixture ? createServer({ cert: fixture.cert, key: fixture.key }, handler) : createPlainServer(handler);
  instance.on("tlsClientError", () => {});
  await new Promise<void>((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", resolve); });
  cleanup.push(() => { instance.closeAllConnections(); return new Promise<void>(resolve => instance.close(() => resolve())); });
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("missing listener");
  return { endpoint: `${fixture ? "https" : "http"}://127.0.0.1:${address.port}`, received };
}

it("sends bearer only to the authenticated TLS peer", async () => {
  const fixture = certificate();
  const peer = await server(fixture);
  await new CanonicalFSHTTPClient(peer.endpoint, { capabilityToken: "test-private-token", tls: fixture.tls }).closeProject("p");
  expect(peer.received).toEqual(["Bearer test-private-token"]);
});

it("rejects plaintext loopback and absent pins before sending a request", async () => {
  const fixture = certificate();
  const peer = await server();
  expect(() => new CanonicalFSHTTPClient(peer.endpoint, { capabilityToken: "must-not-leak", tls: fixture.tls })).toThrow("HTTPS");
  expect(() => new CanonicalFSHTTPClient(peer.endpoint.replace("http:", "https:"), { capabilityToken: "must-not-leak", tls: { certificateSha256: "" } })).toThrow("pin");
  expect(peer.received).toEqual([]);
});

for (const failure of ["pin", "untrusted", "hostname"] as const) {
  it(`never delivers headers to a peer with invalid ${failure}`, async () => {
    const fixture = certificate(failure === "hostname" ? { subjectAltName: "DNS:wrong.invalid" } : undefined);
    const peer = await server(fixture);
    const tls = { certificateSha256: failure === "pin" ? "0".repeat(64) : fixture.certificateSha256,
      caCertificatePem: failure === "untrusted" ? undefined : fixture.cert };
    await expect(new CanonicalFSHTTPClient(peer.endpoint, { capabilityToken: "must-not-leak", tls }).closeProject("p")).rejects.toMatchObject({ code: "ERR_DAEMON" });
    expect(peer.received).toEqual([]);
  });
}

it("never follows a redirect from the authenticated server to another endpoint", async () => {
  const receiver = await server();
  const fixture = certificate();
  const sender = await server(fixture, response => { response.writeHead(302, { location: receiver.endpoint }); response.end("{}"); });
  await expect(new CanonicalFSHTTPClient(sender.endpoint, { capabilityToken: "must-not-forward", tls: fixture.tls }).closeProject("p")).rejects.toMatchObject({ code: "ERR_DAEMON" });
  expect(sender.received).toEqual(["Bearer must-not-forward"]);
  expect(receiver.received).toEqual([]);
});

for (const status of [204, 205, 600]) {
  it(`rejects malformed authenticated response ${status} without an uncaught callback or decoder error`, async () => {
    const fixture = certificate();
    const peer = await server(fixture, response => {
      response.writeHead(status, { "content-encoding": "gzip", "content-length": "0" });
      response.end();
    });
    await expect(new CanonicalFSHTTPClient(peer.endpoint, { capabilityToken: "test-private-token", tls: fixture.tls }).closeProject("p"))
      .rejects.toMatchObject({ code: "ERR_DAEMON" });
  });
}
