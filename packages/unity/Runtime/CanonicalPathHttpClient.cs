using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CanonicalPath
{
    public sealed class CanonicalFSDaemonException : Exception
    {
        private readonly string code;

        public CanonicalFSDaemonException(string code, string message)
            : base(message)
        {
            this.code = code;
        }

        public string Code
        {
            get { return code; }
        }
    }

    public sealed class CanonicalFSDaemonCapabilities
    {
        public bool AuthRequired { get; set; }
        public string[] Endpoints { get; set; }
        public CanonicalFSDaemonLimits Limits { get; set; }
    }

    public sealed class CanonicalFSDaemonLimits
    {
        public long MaxRequestBytes { get; set; }
        public long DefaultReadBytes { get; set; }
        public long MaxReadBytes { get; set; }
        public long MaxResponseBytes { get; set; }
    }

    public sealed class CanonicalFSFileStat
    {
        public string Path { get; set; }
        public long Size { get; set; }
        public bool IsDirectory { get; set; }
    }

    public sealed class CanonicalFSDaemonHttpClient : IDisposable
    {
        private readonly Uri endpoint;
        private readonly string capabilityToken;
        private readonly HttpClient http;
        private readonly bool ownsHttp;

        public CanonicalFSDaemonHttpClient(Uri endpoint, string capabilityToken)
            : this(endpoint, capabilityToken, null)
        {
        }

        public CanonicalFSDaemonHttpClient(Uri endpoint, string capabilityToken, HttpMessageHandler handler)
        {
            if (endpoint == null) throw new ArgumentNullException("endpoint");
            if (string.IsNullOrEmpty(capabilityToken) || capabilityToken.Trim().Length == 0) throw new ArgumentException("capabilityToken is required.", "capabilityToken");

            string endpointValue = endpoint.ToString().TrimEnd('/') + "/";
            this.endpoint = new Uri(endpointValue, UriKind.Absolute);
            this.capabilityToken = capabilityToken.Trim();
            if (handler == null)
            {
                this.http = new HttpClient();
                this.ownsHttp = true;
            }
            else
            {
                this.http = new HttpClient(handler, false);
                this.ownsHttp = true;
            }
        }

        public async Task<bool> HealthAsync()
        {
            return await HealthAsync(CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<bool> HealthAsync(CancellationToken cancellationToken)
        {
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, BuildUri("/healthz")))
            using (HttpResponseMessage response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false))
            {
                return response.IsSuccessStatusCode;
            }
        }

        public async Task<CanonicalFSDaemonCapabilities> CapabilitiesAsync()
        {
            return await CapabilitiesAsync(CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<CanonicalFSDaemonCapabilities> CapabilitiesAsync(CancellationToken cancellationToken)
        {
            CapsEnvelope envelope = await RequestAsync<CapsEnvelope>(HttpMethod.Get, "/v1/caps", null, cancellationToken).ConfigureAwait(false);
            return new CanonicalFSDaemonCapabilities
            {
                AuthRequired = envelope.AuthRequired,
                Endpoints = envelope.Endpoints ?? new string[0],
                Limits = envelope.Limits == null ? null : new CanonicalFSDaemonLimits
                {
                    MaxRequestBytes = envelope.Limits.MaxRequestBytes,
                    DefaultReadBytes = envelope.Limits.DefaultReadBytes,
                    MaxReadBytes = envelope.Limits.MaxReadBytes,
                    MaxResponseBytes = envelope.Limits.MaxResponseBytes,
                },
            };
        }

        public Task OpenProjectAsync(string projectId, string hostRoot)
        {
            return OpenProjectAsync(projectId, hostRoot, CancellationToken.None);
        }

        public Task OpenProjectAsync(string projectId, string hostRoot, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/projects/open", new RequestEnvelope { ProjectID = projectId, HostRoot = hostRoot }, cancellationToken);
        }

        public Task CloseProjectAsync(string projectId)
        {
            return CloseProjectAsync(projectId, CancellationToken.None);
        }

        public Task CloseProjectAsync(string projectId, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/projects/close", new RequestEnvelope { ProjectID = projectId }, cancellationToken);
        }

        public async Task<byte[]> ReadFileAsync(string projectId, string path)
        {
            return await ReadFileAsync(projectId, path, null, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<byte[]> ReadFileAsync(string projectId, string path, CancellationToken cancellationToken)
        {
            return await ReadFileAsync(projectId, path, null, cancellationToken).ConfigureAwait(false);
        }

        public async Task<byte[]> ReadFileAsync(string projectId, string path, long? maxBytes)
        {
            return await ReadFileAsync(projectId, path, maxBytes, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<byte[]> ReadFileAsync(string projectId, string path, long? maxBytes, CancellationToken cancellationToken)
        {
            ResponseEnvelope envelope = await PostAsync("/v1/fs/readFile", new RequestEnvelope { ProjectID = projectId, Path = path, MaxBytes = maxBytes }, cancellationToken).ConfigureAwait(false);
            return Convert.FromBase64String(envelope.DataBase64 ?? string.Empty);
        }

        public async Task<string> ReadTextAsync(string projectId, string path)
        {
            return await ReadTextAsync(projectId, path, null, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<string> ReadTextAsync(string projectId, string path, CancellationToken cancellationToken)
        {
            return await ReadTextAsync(projectId, path, null, cancellationToken).ConfigureAwait(false);
        }

        public async Task<string> ReadTextAsync(string projectId, string path, long? maxBytes)
        {
            return await ReadTextAsync(projectId, path, maxBytes, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<string> ReadTextAsync(string projectId, string path, long? maxBytes, CancellationToken cancellationToken)
        {
            byte[] data = await ReadFileAsync(projectId, path, maxBytes, cancellationToken).ConfigureAwait(false);
            return Encoding.UTF8.GetString(data);
        }

        public Task WriteFileAsync(string projectId, string path, byte[] data)
        {
            return WriteFileAsync(projectId, path, data, CancellationToken.None);
        }

        public Task WriteFileAsync(string projectId, string path, byte[] data, CancellationToken cancellationToken)
        {
            if (data == null) throw new ArgumentNullException("data");
            return CallAsync("/v1/fs/writeFile", new RequestEnvelope { ProjectID = projectId, Path = path, DataBase64 = Convert.ToBase64String(data) }, cancellationToken);
        }

        public Task WriteTextAsync(string projectId, string path, string text)
        {
            return WriteTextAsync(projectId, path, text, CancellationToken.None);
        }

        public Task WriteTextAsync(string projectId, string path, string text, CancellationToken cancellationToken)
        {
            if (text == null) throw new ArgumentNullException("text");
            return WriteFileAsync(projectId, path, Encoding.UTF8.GetBytes(text), cancellationToken);
        }

        public async Task<CanonicalFSFileStat> StatAsync(string projectId, string path)
        {
            return await StatAsync(projectId, path, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<CanonicalFSFileStat> StatAsync(string projectId, string path, CancellationToken cancellationToken)
        {
            ResponseEnvelope envelope = await PostAsync("/v1/fs/stat", new RequestEnvelope { ProjectID = projectId, Path = path }, cancellationToken).ConfigureAwait(false);
            if (envelope.Stat == null) throw new CanonicalFSDaemonException("ERR_DAEMON", "stat response is missing");
            return new CanonicalFSFileStat
            {
                Path = envelope.Stat.Path,
                Size = envelope.Stat.Size,
                IsDirectory = envelope.Stat.IsDirectory,
            };
        }

        public Task MkdirAllAsync(string projectId, string path)
        {
            return MkdirAllAsync(projectId, path, CancellationToken.None);
        }

        public Task MkdirAllAsync(string projectId, string path, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/fs/mkdirAll", new RequestEnvelope { ProjectID = projectId, Path = path }, cancellationToken);
        }

        public Task RemoveAsync(string projectId, string path)
        {
            return RemoveAsync(projectId, path, CancellationToken.None);
        }

        public Task RemoveAsync(string projectId, string path, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/fs/remove", new RequestEnvelope { ProjectID = projectId, Path = path }, cancellationToken);
        }

        public async Task<byte[]> ReadScopedFileAsync(string projectId, UnityMcpPathScope scope, string path)
        {
            return await ReadScopedFileAsync(projectId, scope, path, null, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<byte[]> ReadScopedFileAsync(string projectId, UnityMcpPathScope scope, string path, CancellationToken cancellationToken)
        {
            return await ReadScopedFileAsync(projectId, scope, path, null, cancellationToken).ConfigureAwait(false);
        }

        public async Task<byte[]> ReadScopedFileAsync(string projectId, UnityMcpPathScope scope, string path, long? maxBytes)
        {
            return await ReadScopedFileAsync(projectId, scope, path, maxBytes, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<byte[]> ReadScopedFileAsync(string projectId, UnityMcpPathScope scope, string path, long? maxBytes, CancellationToken cancellationToken)
        {
            RequestEnvelope request = ScopedRequest(projectId, scope, "read", path);
            request.MaxBytes = maxBytes;
            ResponseEnvelope envelope = await PostAsync("/v1/scoped/readFile", request, cancellationToken).ConfigureAwait(false);
            return Convert.FromBase64String(envelope.DataBase64 ?? string.Empty);
        }

        public async Task<string> ReadScopedTextAsync(string projectId, UnityMcpPathScope scope, string path)
        {
            return await ReadScopedTextAsync(projectId, scope, path, null, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<string> ReadScopedTextAsync(string projectId, UnityMcpPathScope scope, string path, CancellationToken cancellationToken)
        {
            return await ReadScopedTextAsync(projectId, scope, path, null, cancellationToken).ConfigureAwait(false);
        }

        public async Task<string> ReadScopedTextAsync(string projectId, UnityMcpPathScope scope, string path, long? maxBytes)
        {
            return await ReadScopedTextAsync(projectId, scope, path, maxBytes, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<string> ReadScopedTextAsync(string projectId, UnityMcpPathScope scope, string path, long? maxBytes, CancellationToken cancellationToken)
        {
            byte[] data = await ReadScopedFileAsync(projectId, scope, path, maxBytes, cancellationToken).ConfigureAwait(false);
            return Encoding.UTF8.GetString(data);
        }

        public Task WriteScopedFileAsync(string projectId, UnityMcpPathScope scope, string path, byte[] data)
        {
            return WriteScopedFileAsync(projectId, scope, path, data, CancellationToken.None);
        }

        public Task WriteScopedFileAsync(string projectId, UnityMcpPathScope scope, string path, byte[] data, CancellationToken cancellationToken)
        {
            if (data == null) throw new ArgumentNullException("data");
            RequestEnvelope request = ScopedRequest(projectId, scope, "write", path);
            request.DataBase64 = Convert.ToBase64String(data);
            return CallAsync("/v1/scoped/writeFile", request, cancellationToken);
        }

        public Task WriteScopedTextAsync(string projectId, UnityMcpPathScope scope, string path, string text)
        {
            return WriteScopedTextAsync(projectId, scope, path, text, CancellationToken.None);
        }

        public Task WriteScopedTextAsync(string projectId, UnityMcpPathScope scope, string path, string text, CancellationToken cancellationToken)
        {
            if (text == null) throw new ArgumentNullException("text");
            return WriteScopedFileAsync(projectId, scope, path, Encoding.UTF8.GetBytes(text), cancellationToken);
        }

        public async Task<CanonicalFSFileStat> StatScopedAsync(string projectId, UnityMcpPathScope scope, string path)
        {
            return await StatScopedAsync(projectId, scope, path, CancellationToken.None).ConfigureAwait(false);
        }

        public async Task<CanonicalFSFileStat> StatScopedAsync(string projectId, UnityMcpPathScope scope, string path, CancellationToken cancellationToken)
        {
            ResponseEnvelope envelope = await PostAsync("/v1/scoped/stat", ScopedRequest(projectId, scope, "read", path), cancellationToken).ConfigureAwait(false);
            if (envelope.Stat == null) throw new CanonicalFSDaemonException("ERR_DAEMON", "stat response is missing");
            return new CanonicalFSFileStat
            {
                Path = envelope.Stat.Path,
                Size = envelope.Stat.Size,
                IsDirectory = envelope.Stat.IsDirectory,
            };
        }

        public Task MkdirAllScopedAsync(string projectId, UnityMcpPathScope scope, string path)
        {
            return MkdirAllScopedAsync(projectId, scope, path, CancellationToken.None);
        }

        public Task MkdirAllScopedAsync(string projectId, UnityMcpPathScope scope, string path, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/scoped/mkdirAll", ScopedRequest(projectId, scope, "write", path), cancellationToken);
        }

        public Task RemoveScopedAsync(string projectId, UnityMcpPathScope scope, string path)
        {
            return RemoveScopedAsync(projectId, scope, path, CancellationToken.None);
        }

        public Task RemoveScopedAsync(string projectId, UnityMcpPathScope scope, string path, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/scoped/remove", ScopedRequest(projectId, scope, "delete", path), cancellationToken);
        }

        public Task RenameAsync(string projectId, string path, string target)
        {
            return RenameAsync(projectId, path, target, CancellationToken.None);
        }

        public Task RenameAsync(string projectId, string path, string target, CancellationToken cancellationToken)
        {
            return CallAsync("/v1/fs/rename", new RequestEnvelope { ProjectID = projectId, Path = path, Target = target }, cancellationToken);
        }

        public void Dispose()
        {
            if (ownsHttp) http.Dispose();
        }

        private async Task CallAsync(string path, RequestEnvelope body, CancellationToken cancellationToken)
        {
            await PostAsync(path, body, cancellationToken).ConfigureAwait(false);
        }

        private Task<ResponseEnvelope> PostAsync(string path, RequestEnvelope body, CancellationToken cancellationToken)
        {
            return RequestAsync<ResponseEnvelope>(HttpMethod.Post, path, body, cancellationToken);
        }

        private async Task<T> RequestAsync<T>(HttpMethod method, string path, object body, CancellationToken cancellationToken) where T : class, ITransportEnvelope
        {
            using (HttpRequestMessage request = new HttpRequestMessage(method, BuildUri(path)))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", capabilityToken);
                if (body != null)
                {
                    request.Content = new StringContent(Serialize(body), Encoding.UTF8, "application/json");
                }

                using (HttpResponseMessage response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    T payload;
                    try
                    {
                        payload = Deserialize<T>(json);
                    }
                    catch (Exception ex)
                    {
                        throw new CanonicalFSDaemonException("ERR_DAEMON", "daemon response is not valid JSON: " + ex.Message);
                    }
                    if (!response.IsSuccessStatusCode || payload.Error != null)
                    {
                        TransportError error = payload.Error ?? new TransportError { Code = "ERR_DAEMON", Message = response.ReasonPhrase };
                        throw new CanonicalFSDaemonException(error.Code ?? "ERR_DAEMON", error.Message ?? "daemon request failed");
                    }
                    return payload;
                }
            }
        }

        private Uri BuildUri(string path)
        {
            return new Uri(endpoint, path.TrimStart('/'));
        }

        private static RequestEnvelope ScopedRequest(string projectId, UnityMcpPathScope scope, string operation, string path)
        {
            return new RequestEnvelope { ProjectID = projectId, Scope = ScopeToWireName(scope), Operation = operation, Path = path };
        }

        private static string ScopeToWireName(UnityMcpPathScope scope)
        {
            if (scope == UnityMcpPathScope.UnityAsset) return "unity_asset";
            if (scope == UnityMcpPathScope.Knowledge) return "knowledge";
            if (scope == UnityMcpPathScope.PackageManifest) return "package_manifest";
            if (scope == UnityMcpPathScope.Artifact) return "artifact";
            if (scope == UnityMcpPathScope.GatewayCache) return "gateway_cache";
            if (scope == UnityMcpPathScope.TempSession) return "temp_session";
            throw new ArgumentOutOfRangeException("scope");
        }

        private static string Serialize(object value)
        {
            DataContractJsonSerializer serializer = new DataContractJsonSerializer(value.GetType());
            using (MemoryStream stream = new MemoryStream())
            {
                serializer.WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        private static T Deserialize<T>(string value)
        {
            DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(T));
            using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(value)))
            {
                return (T)serializer.ReadObject(stream);
            }
        }
    }

    public static class CanonicalPathHttpClient
    {
        [Obsolete("The Go daemon exposes CanonicalFS endpoints, not CanonicalPath normalization. Use CanonicalFSDaemonHttpClient for daemon transport.")]
        public static string NormalizeViaDaemon(Uri baseUrl, string raw)
        {
            throw new NotSupportedException("The Go daemon exposes CanonicalFS endpoints, not CanonicalPath normalization. Use CanonicalFSDaemonHttpClient for daemon transport.");
        }
    }

    internal interface ITransportEnvelope
    {
        TransportError Error { get; }
    }

    [DataContract]
    internal sealed class RequestEnvelope
    {
        [DataMember(Name = "project_id", EmitDefaultValue = false)]
        public string ProjectID { get; set; }

        [DataMember(Name = "host_root", EmitDefaultValue = false)]
        public string HostRoot { get; set; }

        [DataMember(Name = "path", EmitDefaultValue = false)]
        public string Path { get; set; }

        [DataMember(Name = "target", EmitDefaultValue = false)]
        public string Target { get; set; }

        [DataMember(Name = "scope", EmitDefaultValue = false)]
        public string Scope { get; set; }

        [DataMember(Name = "operation", EmitDefaultValue = false)]
        public string Operation { get; set; }

        [DataMember(Name = "data_base64", EmitDefaultValue = false)]
        public string DataBase64 { get; set; }

        [DataMember(Name = "max_bytes", EmitDefaultValue = false)]
        public long? MaxBytes { get; set; }
    }

    [DataContract]
    internal sealed class ResponseEnvelope : ITransportEnvelope
    {
        [DataMember(Name = "data_base64", EmitDefaultValue = false)]
        public string DataBase64 { get; set; }

        [DataMember(Name = "stat", EmitDefaultValue = false)]
        public StatEnvelope Stat { get; set; }

        [DataMember(Name = "error", EmitDefaultValue = false)]
        public TransportError Error { get; set; }
    }

    [DataContract]
    internal sealed class CapsEnvelope : ITransportEnvelope
    {
        [DataMember(Name = "auth_required")]
        public bool AuthRequired { get; set; }

        [DataMember(Name = "endpoints", EmitDefaultValue = false)]
        public string[] Endpoints { get; set; }

        [DataMember(Name = "limits", EmitDefaultValue = false)]
        public LimitsEnvelope Limits { get; set; }

        [DataMember(Name = "error", EmitDefaultValue = false)]
        public TransportError Error { get; set; }
    }

    [DataContract]
    internal sealed class LimitsEnvelope
    {
        [DataMember(Name = "max_request_bytes")]
        public long MaxRequestBytes { get; set; }

        [DataMember(Name = "default_read_bytes")]
        public long DefaultReadBytes { get; set; }

        [DataMember(Name = "max_read_bytes")]
        public long MaxReadBytes { get; set; }

        [DataMember(Name = "max_response_bytes")]
        public long MaxResponseBytes { get; set; }
    }

    [DataContract]
    internal sealed class StatEnvelope
    {
        [DataMember(Name = "path", EmitDefaultValue = false)]
        public string Path { get; set; }

        [DataMember(Name = "size")]
        public long Size { get; set; }

        [DataMember(Name = "is_directory")]
        public bool IsDirectory { get; set; }
    }

    [DataContract]
    internal sealed class TransportError
    {
        [DataMember(Name = "code", EmitDefaultValue = false)]
        public string Code { get; set; }

        [DataMember(Name = "message", EmitDefaultValue = false)]
        public string Message { get; set; }
    }
}
