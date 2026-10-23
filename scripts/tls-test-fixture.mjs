import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { Readable } from "node:stream";

// Every test run gets its own private key. No reusable server private keys are
// committed to the repository, and these certificates are never system-trusted.
export function createTlsFixture({ subjectAltName = "DNS:localhost,IP:127.0.0.1,IP:::1" } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "canonicalfs-tls-test-"));
  const certFile = path.join(directory, "certificate.pem");
  const keyFile = path.join(directory, "private-key.pem");
  const gitOpenSsl = path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "usr", "bin", "openssl.exe");
  const openssl = process.env.OPENSSL || (process.platform === "win32" && existsSync(gitOpenSsl) ? gitOpenSsl : "openssl");
  try {
    execFileSync(openssl, ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-sha256", "-nodes",
      "-keyout", keyFile, "-out", certFile, "-days", "2", "-subj", "/CN=CanonicalFS test only",
      "-addext", `subjectAltName=${subjectAltName}`, "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,digitalSignature,keyCertSign", "-addext", "extendedKeyUsage=serverAuth"],
    { stdio: "ignore", windowsHide: true, timeout: 10000 });
    if (process.platform !== "win32") chmodSync(keyFile, 0o600);
    const cert = readFileSync(certFile, "utf8");
    const key = readFileSync(keyFile, "utf8");
    const certificate = new X509Certificate(cert);
    const certificateSha256 = createHash("sha256").update(certificate.raw).digest("hex");
    const publicKeyPin = "sha256//" + createHash("sha256").update(certificate.publicKey.export({ format: "der", type: "spki" })).digest("base64");
    return {
      directory, certFile, keyFile, cert, key, certificateSha256, publicKeyPin,
      tls: { caCertificatePem: cert, certificateSha256 },
      env: { CANONICALFS_TLS_CA_FILE: certFile, CANONICALFS_TLS_CERTIFICATE_SHA256: certificateSha256, CANONICALFS_TLS_PUBLIC_KEY_PIN: publicKeyPin },
      daemonArgs: ["-tls-cert", certFile, "-tls-key", keyFile],
      dispose() { rmSync(directory, { recursive: true, force: true }); },
    };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}

export function tlsFetch(url, init = {}, fixture) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: init.method || "GET", headers: init.headers, signal: init.signal,
      ca: fixture.cert, rejectUnauthorized: true, minVersion: "TLSv1.2", agent: false,
      checkServerIdentity(host, certificate) {
        const invalid = checkServerIdentity(host, certificate);
        if (invalid) return invalid;
        if (createHash("sha256").update(certificate.raw).digest("hex") !== fixture.certificateSha256) return new Error("fixture certificate pin mismatch");
      },
    }, response => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach(entry => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
}
