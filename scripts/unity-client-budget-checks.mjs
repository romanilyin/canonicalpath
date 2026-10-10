// Shared hostile-response checks for .NET and every installed Unity Editor.
export const unityClientBudgetChecks = String.raw`
internal static class UnityClientBudgetChecks
{
    public static void Run()
    {
        foreach (bool health in new[] { true, false })
        foreach (string mode in new[] { "valid", "fixed", "chunked", "error", "headers", "body", "drip" })
        using (BudgetHandler handler = new BudgetHandler(mode))
        using (CanonicalPath.CanonicalFSDaemonHttpClient client = new CanonicalPath.CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "dummy-bearer", handler, 150, 1024))
        {
            var elapsed = System.Diagnostics.Stopwatch.StartNew();
            string code = null;
            try {
                if (health) client.HealthAsync().GetAwaiter().GetResult();
                else client.CapabilitiesAsync().GetAwaiter().GetResult();
            } catch (CanonicalPath.CanonicalFSDaemonException error) { code = error.Code; }
            string expected = mode == "valid" ? null : (mode == "fixed" || mode == "chunked" || mode == "error" ? "ERR_RESPONSE_TOO_LARGE" : "ERR_DAEMON");
            if (code != expected || elapsed.ElapsedMilliseconds > 2000) throw new InvalidOperationException("Unity client budget failed: " + health + "/" + mode + "/" + code);
        }
        using (BudgetHandler handler = new BudgetHandler("headers"))
        using (CanonicalPath.CanonicalFSDaemonHttpClient client = new CanonicalPath.CanonicalFSDaemonHttpClient(new Uri("http://127.0.0.1:1234"), "dummy-bearer", handler, 1000, 1024))
        using (CancellationTokenSource caller = new CancellationTokenSource(50))
        {
            bool cancelled = false;
            try { client.HealthAsync(caller.Token).GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { cancelled = true; }
            if (!cancelled) throw new InvalidOperationException("caller cancellation was lost");
        }
        Console.WriteLine("Unity transport response caps and total deadlines passed");
    }

    private sealed class BudgetHandler : HttpMessageHandler
    {
        private readonly string mode;
        public BudgetHandler(string mode) { this.mode = mode; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (mode == "headers") return new TaskCompletionSource<HttpResponseMessage>().Task;
            HttpContent content;
            if (mode == "valid") content = new StringContent("{\"auth_required\":true}");
            else if (mode == "fixed" || mode == "error") content = new StringContent(new string('x', 4096));
            else content = new StreamContent(new BudgetStream(mode));
            return Task.FromResult(new HttpResponseMessage(mode == "error" ? HttpStatusCode.InternalServerError : HttpStatusCode.OK) { Content = content });
        }
    }

    private sealed class BudgetStream : System.IO.Stream
    {
        private readonly string mode;
        private bool disposed;
        private int remaining = 4096;
        public BudgetStream(string mode) { this.mode = mode; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token)
        {
            if (mode == "body") return await new TaskCompletionSource<int>().Task;
            if (mode == "drip") await Task.Delay(30).ConfigureAwait(false);
            if (disposed) throw new ObjectDisposedException("BudgetStream");
            int size = mode == "drip" ? 1 : Math.Min(count, remaining);
            for (int i = 0; i < size; i++) buffer[offset + i] = 120;
            remaining -= size;
            return size;
        }
        protected override void Dispose(bool disposing) { disposed = true; base.Dispose(disposing); }
        public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, System.IO.SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }
}
`;
