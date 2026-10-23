using System;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace CanonicalPath.PowerShell
{
    // Trust material must come from the launching application/private local
    // configuration. Never obtain a pin or CA from the endpoint being verified.
    public sealed class CanonicalFSTlsOptions
    {
        private readonly string pin;
        private readonly X509Certificate2 trustedRoot;

        public CanonicalFSTlsOptions(string certificateSha256, string caCertificatePem = null)
        {
            if (certificateSha256 == null || certificateSha256.Length != 64)
                throw new ArgumentException("A trusted 64-hex SHA-256 certificate pin is required.");
            foreach (char c in certificateSha256)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
                    throw new ArgumentException("Invalid SHA-256 certificate pin.");
            pin = certificateSha256.ToLowerInvariant();
            if (!String.IsNullOrEmpty(caCertificatePem))
            {
                if (caCertificatePem.Length > 65536) throw new ArgumentException("Trusted CA certificate is too large.");
                try
                {
                    string body = caCertificatePem.Replace("-----BEGIN CERTIFICATE-----", "").Replace("-----END CERTIFICATE-----", "");
                    trustedRoot = new X509Certificate2(Convert.FromBase64String(body));
                }
                catch (Exception) { throw new ArgumentException("Invalid trusted CA certificate."); }
            }
        }

        internal bool Validate(X509Certificate certificate, X509Chain suppliedChain, SslPolicyErrors errors)
        {
            if (certificate == null || (errors & (SslPolicyErrors.RemoteCertificateNotAvailable | SslPolicyErrors.RemoteCertificateNameMismatch)) != 0)
                return false;
            using (X509Certificate2 leaf = new X509Certificate2(certificate))
            {
                if (Fingerprint(leaf) != pin) return false;
                if (trustedRoot == null) return errors == SslPolicyErrors.None;
                using (X509Chain chain = new X509Chain())
                {
                    chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                    chain.ChainPolicy.VerificationFlags = X509VerificationFlags.AllowUnknownCertificateAuthority;
                    chain.ChainPolicy.UrlRetrievalTimeout = TimeSpan.FromSeconds(2);
                    chain.ChainPolicy.ApplicationPolicy.Add(new Oid("1.3.6.1.5.5.7.3.1"));
                    chain.ChainPolicy.ExtraStore.Add(trustedRoot);
                    if (suppliedChain != null)
                        foreach (X509ChainElement element in suppliedChain.ChainElements)
                            chain.ChainPolicy.ExtraStore.Add(element.Certificate);
                    if (!chain.Build(leaf) || chain.ChainElements.Count == 0) return false;
                    foreach (X509ChainStatus status in chain.ChainStatus)
                        if ((status.Status & ~X509ChainStatusFlags.UntrustedRoot) != X509ChainStatusFlags.NoError) return false;
                    return Fingerprint(chain.ChainElements[chain.ChainElements.Count - 1].Certificate) == Fingerprint(trustedRoot);
                }
            }
        }

        private static string Fingerprint(X509Certificate2 certificate)
        {
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(certificate.RawData)).Replace("-", "").ToLowerInvariant();
        }
    }

    public sealed class DaemonTransportException : Exception
    {
        public string Code { get; private set; }
        public DaemonTransportException(string code, string message) : base(message) { Code = code; }
    }

    public sealed class DaemonResponse
    {
        public int StatusCode { get; private set; }
        public string Json { get; private set; }
        internal DaemonResponse(int statusCode, string json) { StatusCode = statusCode; Json = json; }
    }

    // Public properties are safe to enumerate, format and serialize. The bearer
    // is used only inside the transport, never exposed as object data.
    public sealed class DaemonClient
    {
        private readonly string token;
        private readonly CanonicalFSTlsOptions tls;
        public string Endpoint { get; private set; }
        public int TimeoutMilliseconds { get; private set; }
        public int MaxResponseBytes { get; private set; }

        public DaemonClient(string endpoint, string token, int timeoutMilliseconds, int maxResponseBytes)
            : this(endpoint, token, timeoutMilliseconds, maxResponseBytes, null, null) { }

        public DaemonClient(string endpoint, string token, int timeoutMilliseconds, int maxResponseBytes, string caCertificatePem, string certificateSha256)
        {
            try { tls = new CanonicalFSTlsOptions(certificateSha256, caCertificatePem); }
            catch (ArgumentException) { throw new DaemonTransportException("ERR_DAEMON_CLIENT", "A trusted TLS certificate pin and valid optional CA are required"); }
            Uri uri;
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || uri.Scheme != "https"
                || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
                throw new DaemonTransportException("ERR_DAEMON_CLIENT", "endpoint must be an HTTPS URL without credentials, query or fragment");
            if (timeoutMilliseconds < 1 || timeoutMilliseconds > 30000 || maxResponseBytes < 1 || maxResponseBytes > 24 * 1048576)
                throw new DaemonTransportException("ERR_DAEMON_CLIENT", "transport limits must be positive and cannot exceed 30 seconds or 24 MiB");
            this.token = token ?? "";
            if (this.token.IndexOf('\r') >= 0 || this.token.IndexOf('\n') >= 0)
                throw new DaemonTransportException("ERR_DAEMON_CLIENT", "bearer token contains a line break");
            Endpoint = uri.AbsoluteUri.TrimEnd('/');
            TimeoutMilliseconds = timeoutMilliseconds;
            MaxResponseBytes = maxResponseBytes;
        }

        public override string ToString() { return "CanonicalFSDaemonClient(" + Endpoint + ")"; }

        public DaemonResponse Send(string method, string path, string json, bool noAuth)
        {
            if (!noAuth && token.Length == 0)
                throw new DaemonTransportException("ERR_DAEMON_CLIENT", "bearer token is required for this daemon endpoint");
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Endpoint + path);
            request.Method = method.ToUpperInvariant();
            request.AllowAutoRedirect = false;
            request.Proxy = null;
            // HttpWebRequest has no public per-request TLS-version setting.
            // Preserve PowerShell 5.1 compatibility and leave OS/runtime TLS
            // defaults unchanged; the daemon requires TLS 1.2 or later. A
            // legacy runtime with incompatible defaults fails the handshake.
            // Do not change process-global ServicePointManager settings here.
            // Isolate legacy .NET connection pools so a request cannot reuse a
            // connection authenticated under a different client's pin policy.
            string connectionGroup = "CanonicalFS-" + Guid.NewGuid().ToString("N");
            request.ConnectionGroupName = connectionGroup;
            request.KeepAlive = false;
            request.ServerCertificateValidationCallback = (sender, certificate, chain, errors) => tls.Validate(certificate, chain, errors);
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            request.Timeout = TimeoutMilliseconds;
            request.ReadWriteTimeout = TimeoutMilliseconds;
            if (!noAuth) request.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
            // Include any synchronous setup/DNS work before the first await in
            // the outer deadline as well.
            Task<DaemonResponse> operation = Task.Run(() => SendAsync(request, json));
            try
            {
                // Includes connection, upload, headers, every body read and UTF-8
                // decoding, even when a peer sends bytes often enough to evade
                // per-read timeouts. Abort also closes an in-progress body read.
                if (!operation.Wait(TimeoutMilliseconds))
                {
                    request.Abort();
                    operation.ContinueWith(t => { var ignored = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                    throw new DaemonTransportException("ERR_DAEMON", "daemon request timed out");
                }
                return operation.GetAwaiter().GetResult();
            }
            catch (AggregateException)
            {
                try { return operation.GetAwaiter().GetResult(); }
                catch (DaemonTransportException) { throw; }
                catch { throw new DaemonTransportException("ERR_DAEMON", "daemon transport request failed"); }
            }
            finally
            {
                request.Abort();
                request.ServicePoint.CloseConnectionGroup(connectionGroup);
            }
        }

        private async Task<DaemonResponse> SendAsync(HttpWebRequest request, string json)
        {
            if (!String.IsNullOrEmpty(json))
            {
                byte[] body = new UTF8Encoding(false, true).GetBytes(json);
                request.ContentType = "application/json";
                request.ContentLength = body.Length;
                using (Stream stream = await request.GetRequestStreamAsync().ConfigureAwait(false))
                    await stream.WriteAsync(body, 0, body.Length).ConfigureAwait(false);
            }
            HttpWebResponse response;
            try { response = (HttpWebResponse)await request.GetResponseAsync().ConfigureAwait(false); }
            catch (WebException ex)
            {
                response = ex.Response as HttpWebResponse;
                if (response == null) throw;
            }
            using (response)
            {
                if (response.ContentLength > MaxResponseBytes)
                    throw new DaemonTransportException("ERR_RESPONSE_TOO_LARGE", "daemon response exceeds local byte limit");
                using (Stream stream = response.GetResponseStream())
                using (MemoryStream output = new MemoryStream())
                {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0)
                    {
                        if (output.Length + count > MaxResponseBytes)
                            throw new DaemonTransportException("ERR_RESPONSE_TOO_LARGE", "daemon response exceeds local byte limit");
                        output.Write(buffer, 0, count);
                    }
                    string text;
                    try { text = new UTF8Encoding(false, true).GetString(output.ToArray()); }
                    catch (DecoderFallbackException) { throw new DaemonTransportException("ERR_DAEMON", "daemon response is not valid UTF-8 JSON"); }
                    return new DaemonResponse((int)response.StatusCode, text);
                }
            }
        }
    }
}
