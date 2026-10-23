import { createHash, X509Certificate } from "node:crypto";
import { Agent, request } from "node:https";
import { Readable } from "node:stream";
import { checkServerIdentity } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { fsError } from "./errors.js";
import { trimBoundaryCharacters } from "../canonicalpath/internal.js";
import type { CanonicalFSFetch } from "./http.js";

/** Trust is supplied by the application over a trusted local channel, never fetched from the daemon. */
export interface CanonicalFSTLSOptions {
  /** SHA-256 of the expected leaf certificate DER, as 64 hexadecimal characters. */
  certificateSha256: string;
  /** Optional private CA PEM. When omitted, the platform's normal trusted CAs are used. */
  caCertificatePem?: string;
}

export function secureDaemonEndpoint(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw fsError("ERR_DAEMON", "daemon endpoint must be an HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /[\u0000-\u0020\u007f]/.test(endpoint)) {
    throw fsError("ERR_DAEMON", "daemon endpoint must be HTTPS without credentials, query, fragment or whitespace");
  }
  return trimBoundaryCharacters(url.href, "/", false);
}

export function pinnedFetch(options: CanonicalFSTLSOptions | undefined): CanonicalFSFetch {
  if (!options || !/^[0-9a-f]{64}$/i.test(options.certificateSha256)) {
    throw fsError("ERR_DAEMON", "a trusted daemon certificateSha256 pin is required");
  }
  const pin = options.certificateSha256.toLowerCase();
  if (options.caCertificatePem !== undefined) {
    try {
      if (Buffer.byteLength(options.caCertificatePem) > 65536) throw new Error();
      new X509Certificate(options.caCertificatePem);
    } catch { throw fsError("ERR_DAEMON", "invalid trusted daemon CA certificate"); }
  }
  const agent = new Agent({
    ca: options.caCertificatePem,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    // Never reuse a TLS session whose certificate callback would be skipped.
    maxCachedSessions: 0,
    keepAlive: false,
    checkServerIdentity(host, certificate) {
      const identityError = checkServerIdentity(host, certificate);
      if (identityError) return identityError;
      if (!certificate.raw || createHash("sha256").update(certificate.raw).digest("hex") !== pin) {
        return new Error("daemon certificate pin mismatch");
      }
      return undefined;
    },
  });
  return (input, init) => new Promise<Response>((resolve, reject) => {
    const req = request(secureDaemonEndpoint(input), {
      agent, method: init.method, signal: init.signal,
      headers: { ...init.headers, "accept-encoding": "gzip, deflate, br" },
    }, response => {
      let stream: Readable = response;
      try {
        const status = response.statusCode ?? 502;
        if (status < 200 || status > 599) throw fsError("ERR_DAEMON", "daemon returned an invalid HTTP status");
        if (status >= 300 && status < 400) throw fsError("ERR_DAEMON", "daemon redirects are not allowed");
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
          else if (value !== undefined) headers.set(name, value);
        }
        // No-body statuses must not create an orphaned decompressor. Even a
        // malformed authenticated peer must produce a rejected request, not an
        // uncaught asynchronous exception in the caller's process.
        if (status === 204 || status === 205) {
          response.destroy();
          resolve(new Response(null, { status, headers }));
          return;
        }
        const encoding = response.headers["content-encoding"];
        const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : undefined;
        if (decoder) {
          response.on("error", error => decoder.destroy(error));
          decoder.on("close", () => response.destroy());
          stream = response.pipe(decoder);
          headers.delete("content-encoding");
          headers.delete("content-length");
        }
        const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, headers }));
      } catch (error) {
        stream.destroy(); response.destroy();
        reject(error);
      }
    });
    req.on("error", reject);
    // HTTPS never writes HTTP headers or a body until certificate verification succeeds.
    req.end(init.body);
  });
}
