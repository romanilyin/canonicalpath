package canonicalfsrpc

import (
	"encoding/base64"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
)

func TestScopedEndpointsRejectInProjectLinks(t *testing.T) {
	for _, v := range []struct{ scope, anchor, rel string }{
		{"knowledge", "Assets/UnityMcpKnowledge", "link/secret.txt"},
		{"unity_asset", "Assets", "Assets/link/secret.txt"},
		{"artifact", "Library/SGGUnityMcp/job-artifacts", "job-artifacts/link/secret.txt"},
		{"temp_session", "Temp/SGGUnityMcp/session-1", "session-1/link/secret.txt"},
		{"package_manifest", "Packages", "Packages/manifest.json"},
	} {
		t.Run(v.scope, func(t *testing.T) {
			project := t.TempDir()
			protected := filepath.Join(project, "ProjectSettings")
			if err := os.MkdirAll(protected, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(project, v.anchor), 0700); err != nil {
				t.Fatal(err)
			}
			secret := filepath.Join(protected, "secret.txt")
			if err := os.WriteFile(secret, []byte("protected"), 0600); err != nil {
				t.Fatal(err)
			}
			link := filepath.Join(project, v.anchor, "link")
			target := protected
			if v.scope == "package_manifest" {
				link = filepath.Join(project, "Packages", "manifest.json")
				target = secret
			}
			relative, err := filepath.Rel(filepath.Dir(link), target)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(relative, link); err != nil {
				t.Skipf("symlink unavailable: %v", err)
			}
			server, err := NewServer(ServerOptions{AllowedRoots: []string{project}, CapabilityToken: testCapabilityToken})
			if err != nil {
				t.Fatal(err)
			}
			defer server.Close()
			httpServer := httptest.NewServer(server.Handler())
			defer httpServer.Close()
			postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "probe", HostRoot: project})
			for _, op := range []string{"readFile", "writeFile", "stat", "mkdirAll", "remove"} {
				req := request{ProjectID: "probe", Scope: v.scope, Path: v.rel, DataBase64: base64.StdEncoding.EncodeToString([]byte("corrupted"))}
				if op == "mkdirAll" && v.scope != "package_manifest" {
					req.Path = filepath.ToSlash(filepath.Dir(v.rel)) + "/new-directory"
				}
				if got := post(t, httpServer.URL+"/v1/scoped/"+op, req); got.Error == nil {
					t.Fatalf("%s followed a cross-scope link", op)
				}
			}
			data, err := os.ReadFile(secret)
			if err != nil || string(data) != "protected" {
				t.Fatalf("protected file changed: %q %v", data, err)
			}
			if _, err := os.Stat(filepath.Join(protected, "new-directory")); !os.IsNotExist(err) {
				t.Fatal("mkdir escaped scope")
			}
		})
	}
}

func TestScopedFileSwapRace(t *testing.T) {
	project := t.TempDir()
	anchor := filepath.Join(project, "Assets", "UnityMcpKnowledge")
	protected := filepath.Join(project, "ProjectSettings")
	for _, dir := range []string{anchor, protected} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(protected, "secret.txt"), []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(anchor, "secret.txt")
	if err := os.Symlink("../../ProjectSettings/secret.txt", file); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	_ = os.Remove(file)
	server, err := NewServer(ServerOptions{AllowedRoots: []string{project}, CapabilityToken: testCapabilityToken})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "probe", HostRoot: project})
	var stop atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		for !stop.Load() {
			_ = os.Remove(file)
			_ = os.Symlink("../../ProjectSettings/secret.txt", file)
			runtime.Gosched()
			_ = os.Remove(file)
			_ = os.WriteFile(file, []byte("safe"), 0600)
			runtime.Gosched()
		}
	}()
	defer func() { stop.Store(true); <-done }()
	for i := 0; i < 300; i++ {
		read := post(t, httpServer.URL+"/v1/scoped/readFile", request{ProjectID: "probe", Scope: "knowledge", Path: "secret.txt", MaxBytes: 100})
		if read.Error == nil {
			data, err := base64.StdEncoding.DecodeString(read.DataBase64)
			if err != nil || string(data) == "protected" {
				t.Fatal("scope escaped during swap")
			}
		}
		post(t, httpServer.URL+"/v1/scoped/writeFile", request{ProjectID: "probe", Scope: "knowledge", Path: "secret.txt", DataBase64: "c2FmZQ=="})
	}
	data, err := os.ReadFile(filepath.Join(protected, "secret.txt"))
	if err != nil || string(data) != "protected" {
		t.Fatalf("race changed protected file: %q %v", data, err)
	}
}

func TestScopedEndpointsRejectAnchorLinks(t *testing.T) {
	for _, anchor := range []string{"Assets", "Assets/UnityMcpKnowledge", "Temp/SGGUnityMcp/session-1"} {
		t.Run(anchor, func(t *testing.T) {
			project := t.TempDir()
			protected := filepath.Join(project, "ProjectSettings")
			if err := os.MkdirAll(protected, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(protected, "secret.txt"), []byte("protected"), 0600); err != nil {
				t.Fatal(err)
			}
			link := filepath.Join(project, anchor)
			if err := os.MkdirAll(filepath.Dir(link), 0700); err != nil {
				t.Fatal(err)
			}
			rel, err := filepath.Rel(filepath.Dir(link), protected)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(rel, link); err != nil {
				t.Skipf("symlink unavailable: %v", err)
			}
			if anchor == "Temp/SGGUnityMcp/session-1" {
				assertScopedProtected(t, project, "temp_session", "session-1/secret.txt")
			} else {
				assertScopedProtected(t, project, "knowledge", "secret.txt")
			}
		})
	}
}

func assertScopedProtected(t *testing.T, project, scope, rel string) {
	t.Helper()
	server, err := NewServer(ServerOptions{AllowedRoots: []string{project}, CapabilityToken: testCapabilityToken})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "probe", HostRoot: project})
	for _, op := range []string{"readFile", "writeFile", "stat", "mkdirAll", "remove"} {
		req := request{ProjectID: "probe", Scope: scope, Path: rel, DataBase64: "Y29ycnVwdGVk"}
		if op == "mkdirAll" {
			req.Path = filepath.ToSlash(filepath.Dir(rel)) + "/new-directory"
			if filepath.Dir(rel) == "." {
				req.Path = "new-directory"
			}
		}
		if got := post(t, httpServer.URL+"/v1/scoped/"+op, req); got.Error == nil {
			t.Fatalf("%s followed anchor link", op)
		}
	}
	data, err := os.ReadFile(filepath.Join(project, "ProjectSettings", "secret.txt"))
	if err != nil || string(data) != "protected" {
		t.Fatalf("protected file changed: %q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(project, "ProjectSettings", "new-directory")); !os.IsNotExist(err) {
		t.Fatal("mkdir escaped scope")
	}
}
