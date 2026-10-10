using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace CanonicalPath.PowerShell
{
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
        public string Endpoint { get; private set; }
        public int TimeoutMilliseconds { get; private set; }
        public int MaxResponseBytes { get; private set; }

        public DaemonClient(string endpoint, string token, int timeoutMilliseconds, int maxResponseBytes)
        {
            Uri uri;
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https")
                || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
                throw new DaemonTransportException("ERR_DAEMON_CLIENT", "endpoint must be an HTTP(S) URL without credentials, query or fragment");
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
            finally { request.Abort(); }
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
