export interface TLSFixture {
  directory: string;
  certFile: string;
  keyFile: string;
  cert: string;
  key: string;
  certificateSha256: string;
  publicKeyPin: string;
  tls: { caCertificatePem: string; certificateSha256: string };
  env: Record<string, string>;
  daemonArgs: string[];
  dispose(): void;
}
export function createTlsFixture(options?: { subjectAltName?: string }): TLSFixture;
export function tlsFetch(url: string, init: RequestInit | undefined, fixture: TLSFixture): Promise<Response>;
