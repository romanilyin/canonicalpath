package canonicalfsrpc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testCapabilityToken = "test-token"

func TestServerFileOperations(t *testing.T) {
	project := t.TempDir()
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{project}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})
	postOK(t, httpServer.URL+"/v1/fs/mkdirAll", request{ProjectID: "project-1", Path: "safe"})
	postOK(t, httpServer.URL+"/v1/fs/writeFile", request{ProjectID: "project-1", Path: "safe/file.txt", DataBase64: base64.StdEncoding.EncodeToString([]byte("ok"))})

	read := postOK(t, httpServer.URL+"/v1/fs/readFile", request{ProjectID: "project-1", Path: "safe/file.txt", MaxBytes: 16})
	data, err := base64.StdEncoding.DecodeString(read.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "ok" {
		t.Fatalf("expected ok, got %q", string(data))
	}

	stat := postOK(t, httpServer.URL+"/v1/fs/stat", request{ProjectID: "project-1", Path: "safe/file.txt"})
	if stat.Stat == nil || stat.Stat.Size != 2 || stat.Stat.IsDirectory {
		t.Fatalf("unexpected stat response: %+v", stat.Stat)
	}

	rename := post(t, httpServer.URL+"/v1/fs/rename", request{ProjectID: "project-1", Path: "safe/file.txt", Target: "safe/file2.txt"})
	if rename.Error != nil && rename.Error.Code != "ERR_UNSUPPORTED_OPERATION" {
		t.Fatalf("unexpected rename error: %+v", rename.Error)
	}
	if rename.Error == nil {
		postOK(t, httpServer.URL+"/v1/fs/remove", request{ProjectID: "project-1", Path: "safe/file2.txt"})
	} else {
		postOK(t, httpServer.URL+"/v1/fs/remove", request{ProjectID: "project-1", Path: "safe/file.txt"})
	}

	postOK(t, httpServer.URL+"/v1/projects/close", request{ProjectID: "project-1"})
}

func TestServerScopedFileOperations(t *testing.T) {
	project := t.TempDir()
	for _, dir := range []string{
		filepath.Join(project, "Assets", "UnityMcpKnowledge"),
		filepath.Join(project, "Library", "SGGUnityMcp", "job-artifacts", "run-1"),
		filepath.Join(project, "Packages"),
		filepath.Join(project, "Temp", "SGGUnityMcp", "session-1"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(project, "Assets", "UnityMcpKnowledge", "agent.md"), []byte("knowledge"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "Packages", "manifest.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "Temp", "SGGUnityMcp", "session-1", "delete.txt"), []byte("delete"), 0o644); err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{project}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})

	read := postOK(t, httpServer.URL+"/v1/scoped/readFile", request{ProjectID: "project-1", Scope: "knowledge", Operation: "read", Path: "agent.md", MaxBytes: 32})
	data, err := base64.StdEncoding.DecodeString(read.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "knowledge" {
		t.Fatalf("expected scoped knowledge read, got %q", string(data))
	}

	postOK(t, httpServer.URL+"/v1/scoped/writeFile", request{ProjectID: "project-1", Scope: "artifact", Operation: "write", Path: "job-artifacts/run-1/summary.json", DataBase64: base64.StdEncoding.EncodeToString([]byte("{}"))})
	if _, err := os.Stat(filepath.Join(project, "Library", "SGGUnityMcp", "job-artifacts", "run-1", "summary.json")); err != nil {
		t.Fatal(err)
	}

	stat := postOK(t, httpServer.URL+"/v1/scoped/stat", request{ProjectID: "project-1", Scope: "package_manifest", Operation: "read", Path: "Packages/manifest.json"})
	if stat.Stat == nil || stat.Stat.Path != "Packages/manifest.json" || stat.Stat.Size != 2 {
		t.Fatalf("unexpected scoped stat response: %+v", stat.Stat)
	}

	postOK(t, httpServer.URL+"/v1/scoped/mkdirAll", request{ProjectID: "project-1", Scope: "temp_session", Operation: "write", Path: "session-1/cache"})
	if _, err := os.Stat(filepath.Join(project, "Temp", "SGGUnityMcp", "session-1", "cache")); err != nil {
		t.Fatal(err)
	}

	postOK(t, httpServer.URL+"/v1/scoped/remove", request{ProjectID: "project-1", Scope: "temp_session", Operation: "delete", Path: "session-1/delete.txt"})
	if _, err := os.Stat(filepath.Join(project, "Temp", "SGGUnityMcp", "session-1", "delete.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected scoped remove to delete file, stat err=%v", err)
	}
}

func TestServerScopedOperationsRejectEscapesAndPolicyMismatches(t *testing.T) {
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, "Assets", "UnityMcpKnowledge"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "Assets", "UnityMcpKnowledge", "agent.md"), []byte("knowledge"), 0o644); err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{project}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})

	traversal := post(t, httpServer.URL+"/v1/scoped/readFile", request{ProjectID: "project-1", Scope: "knowledge", Operation: "read", Path: "../agent.md", MaxBytes: 32})
	if traversal.Error == nil || traversal.Error.Code != "ERR_OUTSIDE_ROOT" {
		t.Fatalf("expected ERR_OUTSIDE_ROOT, got %+v", traversal.Error)
	}

	cache := post(t, httpServer.URL+"/v1/scoped/readFile", request{ProjectID: "project-1", Scope: "gateway_cache", Operation: "read", Path: "index/key.json", MaxBytes: 32})
	if cache.Error == nil || cache.Error.Code != "ERR_UNSUPPORTED_OPERATION" {
		t.Fatalf("expected gateway cache ERR_UNSUPPORTED_OPERATION, got %+v", cache.Error)
	}

	mismatch := post(t, httpServer.URL+"/v1/scoped/readFile", request{ProjectID: "project-1", Scope: "knowledge", Operation: "write", Path: "agent.md", MaxBytes: 32})
	if mismatch.Error == nil || mismatch.Error.Code != "ERR_UNSUPPORTED_OPERATION" {
		t.Fatalf("expected operation mismatch ERR_UNSUPPORTED_OPERATION, got %+v", mismatch.Error)
	}

	deleteKnowledge := post(t, httpServer.URL+"/v1/scoped/remove", request{ProjectID: "project-1", Scope: "knowledge", Operation: "delete", Path: "agent.md"})
	if deleteKnowledge.Error == nil || deleteKnowledge.Error.Code != "ERR_UNSUPPORTED_OPERATION" {
		t.Fatalf("expected delete knowledge ERR_UNSUPPORTED_OPERATION, got %+v", deleteKnowledge.Error)
	}
}

func TestServerRejectsTraversal(t *testing.T) {
	project := t.TempDir()
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{project}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})
	res := post(t, httpServer.URL+"/v1/fs/readFile", request{ProjectID: "project-1", Path: "../outside/secret.txt"})
	if res.Error == nil || res.Error.Code != "ERR_OUTSIDE_ROOT" {
		t.Fatalf("expected ERR_OUTSIDE_ROOT, got %+v", res.Error)
	}
}

func TestServerRestrictsProjectRootsToAllowlist(t *testing.T) {
	parent := t.TempDir()
	project := filepath.Join(parent, "app")
	sibling := filepath.Join(parent, "app-evil")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(sibling, 0o755); err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{project}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})

	res := post(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-evil", HostRoot: sibling})
	if res.Error == nil || res.Error.Code != "ERR_ROOT_NOT_ALLOWED" {
		t.Fatalf("expected ERR_ROOT_NOT_ALLOWED, got %+v", res.Error)
	}
}

func TestServerAcceptsProjectRootInsideAllowedParent(t *testing.T) {
	parent := t.TempDir()
	project := filepath.Join(parent, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{parent}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})
}

func TestServerRequiresCapabilityExceptHealth(t *testing.T) {
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	health, err := http.Get(httpServer.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, health.Body)
	_ = health.Body.Close()
	if health.StatusCode != http.StatusOK {
		t.Fatalf("expected healthz without auth to return 200, got %d", health.StatusCode)
	}

	missing := postWithToken(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: t.TempDir()}, "")
	if missing.Error == nil || missing.Error.Code != "ERR_UNAUTHORIZED" {
		t.Fatalf("expected missing token to return ERR_UNAUTHORIZED, got %+v", missing.Error)
	}

	wrong := postWithToken(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: t.TempDir()}, "wrong-token")
	if wrong.Error == nil || wrong.Error.Code != "ERR_UNAUTHORIZED" {
		t.Fatalf("expected wrong token to return ERR_UNAUTHORIZED, got %+v", wrong.Error)
	}

	missingCaps := getCapsWithToken(t, httpServer.URL+"/v1/caps", "")
	if missingCaps.Error == nil || missingCaps.Error.Code != "ERR_UNAUTHORIZED" {
		t.Fatalf("expected caps without token to return ERR_UNAUTHORIZED, got %+v", missingCaps.Error)
	}
}

func TestServerReportsCapabilities(t *testing.T) {
	server, err := NewServer(ServerOptions{
		CapabilityToken:  testCapabilityToken,
		AllowedRoots:     []string{t.TempDir()},
		MaxRequestBytes:  128,
		DefaultReadBytes: 64,
		MaxReadBytes:     256,
		MaxResponseBytes: 512,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	caps := getCapsWithToken(t, httpServer.URL+"/v1/caps", testCapabilityToken)
	if caps.Error != nil {
		t.Fatalf("unexpected caps error: %+v", caps.Error)
	}
	if !caps.AuthRequired {
		t.Fatal("expected caps to report auth_required")
	}
	if caps.Limits.MaxRequestBytes != 128 || caps.Limits.DefaultReadBytes != 64 || caps.Limits.MaxReadBytes != 256 || caps.Limits.MaxResponseBytes != 512 {
		t.Fatalf("unexpected caps limits: %+v", caps.Limits)
	}
	if !containsEndpoint(caps.Endpoints, "POST /v1/fs/readFile") || !containsEndpoint(caps.Endpoints, "POST /v1/scoped/readFile") || !containsEndpoint(caps.Endpoints, "GET /v1/caps") {
		t.Fatalf("expected caps endpoints to include readFile, scoped readFile, and caps, got %+v", caps.Endpoints)
	}
}

func TestServerReturnsJSONForUnknownEndpoint(t *testing.T) {
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	httpReq, err := http.NewRequest(http.MethodGet, httpServer.URL+"/v1/missing", nil)
	if err != nil {
		t.Fatal(err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+testCapabilityToken)
	httpRes, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatal(err)
	}
	defer httpRes.Body.Close()

	if httpRes.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", httpRes.StatusCode)
	}
	if contentType := httpRes.Header.Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("expected JSON content type, got %q", contentType)
	}

	var res response
	if err := json.NewDecoder(httpRes.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if res.Error == nil || res.Error.Code != "ERR_DAEMON" {
		t.Fatalf("expected ERR_DAEMON, got %+v", res.Error)
	}
}

func TestServerReadLimits(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "large.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(ServerOptions{
		CapabilityToken:  testCapabilityToken,
		AllowedRoots:     []string{project},
		DefaultReadBytes: 4,
		MaxReadBytes:     8,
		MaxResponseBytes: 1024,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})

	defaultCap := post(t, httpServer.URL+"/v1/fs/readFile", request{ProjectID: "project-1", Path: "large.txt"})
	if defaultCap.Error == nil || defaultCap.Error.Code != "ERR_READ_LIMIT_EXCEEDED" {
		t.Fatalf("expected default cap ERR_READ_LIMIT_EXCEEDED, got %+v", defaultCap.Error)
	}

	hardCap := post(t, httpServer.URL+"/v1/fs/readFile", request{ProjectID: "project-1", Path: "large.txt", MaxBytes: 9})
	if hardCap.Error == nil || hardCap.Error.Code != "ERR_READ_LIMIT_EXCEEDED" {
		t.Fatalf("expected hard cap ERR_READ_LIMIT_EXCEEDED, got %+v", hardCap.Error)
	}

	read := postOK(t, httpServer.URL+"/v1/fs/readFile", request{ProjectID: "project-1", Path: "large.txt", MaxBytes: 5})
	data, err := base64.StdEncoding.DecodeString(read.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("expected hello, got %q", string(data))
	}
}

func TestServerResponseCap(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "large.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(ServerOptions{
		CapabilityToken:  testCapabilityToken,
		AllowedRoots:     []string{project},
		DefaultReadBytes: 5,
		MaxReadBytes:     5,
		MaxResponseBytes: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: project})
	res := post(t, httpServer.URL+"/v1/fs/readFile", request{ProjectID: "project-1", Path: "large.txt", MaxBytes: 5})
	if res.Error == nil || res.Error.Code != "ERR_RESPONSE_TOO_LARGE" {
		t.Fatalf("expected ERR_RESPONSE_TOO_LARGE, got %+v", res.Error)
	}
}

func TestServerRequestBodyCap(t *testing.T) {
	project := t.TempDir()
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{project}, MaxRequestBytes: 64})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	res := post(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "project-1", HostRoot: strings.Repeat("x", 1024)})
	if res.Error == nil || res.Error.Code != "ERR_REQUEST_TOO_LARGE" {
		t.Fatalf("expected ERR_REQUEST_TOO_LARGE, got %+v", res.Error)
	}
}

func postOK(t *testing.T, url string, req request) response {
	t.Helper()
	res := post(t, url, req)
	if res.Error != nil {
		t.Fatalf("unexpected error response: %+v", res.Error)
	}
	return res
}

func post(t *testing.T, url string, req request) response {
	t.Helper()
	return postWithToken(t, url, req, testCapabilityToken)
}

func postWithToken(t *testing.T, url string, req request, token string) response {
	t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	httpReq, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+token)
	}
	httpRes, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatal(err)
	}
	defer httpRes.Body.Close()

	var res response
	if err := json.NewDecoder(httpRes.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	return res
}

type capsTestResponse struct {
	AuthRequired bool           `json:"auth_required"`
	Endpoints    []string       `json:"endpoints"`
	Limits       limitsResponse `json:"limits"`
	Error        *errorResponse `json:"error"`
}

func getCapsWithToken(t *testing.T, url string, token string) capsTestResponse {
	t.Helper()
	httpReq, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+token)
	}
	httpRes, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatal(err)
	}
	defer httpRes.Body.Close()

	var res capsTestResponse
	if err := json.NewDecoder(httpRes.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	return res
}

func containsEndpoint(endpoints []string, endpoint string) bool {
	for _, item := range endpoints {
		if item == endpoint {
			return true
		}
	}
	return false
}
