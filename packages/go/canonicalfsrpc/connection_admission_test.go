package canonicalfsrpc

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUnauthenticatedResponsesCloseConnections(t *testing.T) {
	daemon, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = daemon.Close() })
	server := httptest.NewTLSServer(daemon.Handler())
	t.Cleanup(server.Close)
	for _, endpoint := range []string{"/v1/caps", "/healthz"} {
		response, err := server.Client().Get(server.URL + endpoint)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		wantStatus := http.StatusUnauthorized
		if endpoint == "/healthz" {
			wantStatus = http.StatusOK
		}
		if response.StatusCode != wantStatus {
			t.Fatalf("%s status = %d, want %d", endpoint, response.StatusCode, wantStatus)
		}
		if !response.Close {
			t.Errorf("%s retained an unauthenticated keep-alive connection", endpoint)
		}
	}
}

// Each socket is real loopback TCP/TLS. Internal accounting checks accompany
// observable rejection/closure and authenticated requests on existing sockets.
func TestConnectionAdmissionPreservesAuthenticatedKeepalive(t *testing.T) {
	server, limiter := admissionTestServer(t, ConnectionLimits{MaxConnections: 4, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: 10 * time.Second})
	authenticated := admissionTLSClient(t, server)
	admissionRequest(t, authenticated, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 1, 0)
	pending := []net.Conn{admissionTCPClient(t, server), admissionTCPClient(t, server)}
	waitAdmissionCounts(t, limiter, 3, 2)
	for attempt := 0; attempt < 24; attempt++ {
		rejected := admissionTCPClient(t, server)
		requireConnectionClosed(t, rejected)
	}
	waitAdmissionCounts(t, limiter, 3, 2)
	admissionRequest(t, authenticated, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	_ = pending[0].Close()
	waitAdmissionCounts(t, limiter, 2, 1)
	second := admissionTLSClient(t, server)
	admissionRequest(t, second, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 3, 1)
	_ = pending[1].Close()
	waitAdmissionCounts(t, limiter, 2, 0)
	for i := 0; i < 2; i++ {
		client := admissionTLSClient(t, server)
		admissionRequest(t, client, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	}
	waitAdmissionCounts(t, limiter, 4, 0)
	requireConnectionClosed(t, admissionTCPClient(t, server))
	admissionRequest(t, authenticated, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	_ = second.Close()
	waitAdmissionCounts(t, limiter, 3, 0)
	replacement := admissionTLSClient(t, server)
	admissionRequest(t, replacement, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 4, 0)
}

func TestConnectionAdmissionAbsoluteAuthenticationDeadline(t *testing.T) {
	const timeout = 120 * time.Millisecond
	server, limiter := admissionTestServer(t, ConnectionLimits{MaxConnections: 3, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: timeout})
	for _, state := range []string{"before-tls", "after-tls", "partial-http-header"} {
		t.Run(state, func(t *testing.T) {
			var connection net.Conn
			if state == "before-tls" {
				connection = admissionTCPClient(t, server)
			} else {
				connection = admissionTLSClient(t, server)
			}
			if state == "partial-http-header" {
				if _, err := io.WriteString(connection, "GET /v1/caps HTTP/1.1\r\nHost: pending"); err != nil {
					t.Fatal(err)
				}
			}
			requireConnectionClosed(t, connection)
			waitAdmissionCounts(t, limiter, 0, 0)
		})
	}
	authenticated := admissionTLSClient(t, server)
	admissionRequest(t, authenticated, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 1, 0)
	time.Sleep(3 * timeout)
	admissionRequest(t, authenticated, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 1, 0)
}

func TestQueuedExpirationDoesNotCloseAuthenticatedConnection(t *testing.T) {
	server, limiter := admissionTestServer(t, ConnectionLimits{MaxConnections: 3, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: 5 * time.Second})
	client := admissionTLSClient(t, server)
	admissionRequest(t, client, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 1, 0)
	limiter.mu.Lock()
	var accepted *admittedConnection
	for connection := range limiter.active {
		accepted = connection
	}
	limiter.mu.Unlock()
	// Execute a callback that was queued before Stop could retract it. The
	// authenticated socket must remain usable regardless of callback scheduling.
	accepted.expire()
	admissionRequest(t, client, server.URL, "/v1/caps", testCapabilityToken, "", http.StatusOK)
	waitAdmissionCounts(t, limiter, 1, 0)
	_ = client.Close()
	waitAdmissionCounts(t, limiter, 0, 0)
	accepted.expire()
	waitAdmissionCounts(t, limiter, 0, 0)
}

func TestConnectionAdmissionAuthenticationFailureAndHeaders(t *testing.T) {
	server, limiter := admissionTestServer(t, ConnectionLimits{MaxConnections: 3, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: 5 * time.Second})
	for attempt := 0; attempt < 20; attempt++ {
		connection := admissionTLSClient(t, server)
		admissionRequest(t, connection, server.URL, "/v1/caps", "invalid-test-bearer", "", http.StatusUnauthorized)
		requireConnectionClosed(t, connection)
		waitAdmissionCounts(t, limiter, 0, 0)
	}
	health := admissionTLSClient(t, server)
	admissionRequest(t, health, server.URL, "/healthz", "", "", http.StatusOK)
	requireConnectionClosed(t, health)
	waitAdmissionCounts(t, limiter, 0, 0)
	oversized := admissionTLSClient(t, server)
	admissionRequest(t, oversized, server.URL, "/v1/caps", testCapabilityToken, strings.Repeat("x", DefaultMaxHeaderBytes+8192), http.StatusRequestHeaderFieldsTooLarge)
	requireConnectionClosed(t, oversized)
	waitAdmissionCounts(t, limiter, 0, 0)
}

func TestConnectionLimitsRejectUnboundedConfiguration(t *testing.T) {
	valid := ConnectionLimits{MaxConnections: 3, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: time.Second}
	cases := []ConnectionLimits{
		{},
		{MaxConnections: -1, MaxUnauthenticatedConnections: 1, AuthenticationTimeout: time.Second},
		{MaxConnections: 3, MaxUnauthenticatedConnections: 0, AuthenticationTimeout: time.Second},
		{MaxConnections: 3, MaxUnauthenticatedConnections: 3, AuthenticationTimeout: time.Second},
		{MaxConnections: 3, MaxUnauthenticatedConnections: 4, AuthenticationTimeout: time.Second},
		{MaxConnections: 3, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: 0},
		{MaxConnections: 3, MaxUnauthenticatedConnections: 2, AuthenticationTimeout: -time.Second},
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	for _, limits := range cases {
		if _, err := NewBoundedListener(listener, limits); err == nil {
			t.Errorf("accepted invalid limits: %+v", limits)
		}
	}
	if _, err := NewBoundedListener(nil, valid); err == nil {
		t.Fatal("nil listener accepted")
	}
}

func admissionTestServer(t *testing.T, limits ConnectionLimits) (*httptest.Server, *BoundedListener) {
	t.Helper()
	daemon, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = daemon.Close() })
	server := httptest.NewUnstartedServer(daemon.Handler())
	limiter, err := NewBoundedListener(server.Listener, limits)
	if err != nil {
		_ = server.Listener.Close()
		t.Fatal(err)
	}
	server.Listener = limiter
	server.Config.ConnContext = limiter.ConnContext
	server.Config.MaxHeaderBytes = DefaultMaxHeaderBytes
	server.Config.ReadHeaderTimeout = 2 * time.Second
	server.Config.IdleTimeout = 5 * time.Second
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.Config.Protocols = new(http.Protocols)
	server.Config.Protocols.SetHTTP1(true)
	server.StartTLS()
	t.Cleanup(server.Close)
	return server, limiter
}

func admissionTCPClient(t *testing.T, server *httptest.Server) net.Conn {
	t.Helper()
	connection, err := net.DialTimeout("tcp", server.Listener.Addr().String(), 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	return connection
}

func admissionTLSClient(t *testing.T, server *httptest.Server) *tls.Conn {
	t.Helper()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	connection, err := tls.DialWithDialer(&net.Dialer{Timeout: 2 * time.Second}, "tcp", server.Listener.Addr().String(), &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12, NextProtos: []string{"h2", "http/1.1"}})
	if err != nil {
		t.Fatal(err)
	}
	if connection.ConnectionState().NegotiatedProtocol == "h2" {
		t.Fatal("HTTP/2 bypassed the HTTP/1.1 admission policy")
	}
	t.Cleanup(func() { _ = connection.Close() })
	return connection
}

func admissionRequest(t *testing.T, connection net.Conn, base, endpoint, token, largeHeader string, status int) {
	t.Helper()
	if err := connection.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodGet, base+endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if largeHeader != "" {
		request.Header.Set("X-Over-Budget", largeHeader)
	}
	if err := request.Write(connection); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(connection), request)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status {
		t.Fatalf("status %d, want %d", response.StatusCode, status)
	}
	if status == http.StatusUnauthorized && !response.Close {
		t.Fatal("unauthorized response retained connection")
	}
}

func requireConnectionClosed(t *testing.T, connection net.Conn) {
	t.Helper()
	if err := connection.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var data [1]byte
	_, err := connection.Read(data[:])
	if err == nil {
		t.Fatal("connection remains readable")
	}
	if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatalf("connection was not closed: %v", err)
	}
}

func waitAdmissionCounts(t *testing.T, listener *BoundedListener, wantTotal, wantPending int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		listener.mu.Lock()
		total, pending := len(listener.active), listener.pending
		listener.mu.Unlock()
		if total == wantTotal && pending == wantPending {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("admitted total/pending=%d/%d, want %d/%d", total, pending, wantTotal, wantPending)
		}
		time.Sleep(time.Millisecond)
	}
}
