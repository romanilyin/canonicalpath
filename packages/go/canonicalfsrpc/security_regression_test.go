package canonicalfsrpc

import (
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRegistrationUsesBootstrapHandleAfterRename(t *testing.T) {
	parent := t.TempDir()
	allowed := filepath.Join(parent, "allowed")
	if err := os.Mkdir(allowed, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(allowed, "identity"), []byte("trusted"), 0600); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{allowed}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	moved := filepath.Join(parent, "moved")
	if err := os.Rename(allowed, moved); err != nil {
		t.Skipf("cannot rename open directory: %v", err)
	}
	if err := os.Mkdir(allowed, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(allowed, "identity"), []byte("untrusted"), 0600); err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "p", HostRoot: allowed})
	handle, err := server.root("p")
	if err != nil {
		t.Fatal(err)
	}
	data, err := handle.ReadFile("identity", 16)
	if err != nil || string(data) != "trusted" {
		t.Fatalf("reopened global namespace: %q %v", data, err)
	}
}

func TestRegistrationCannotFollowOutsideSymlink(t *testing.T) {
	allowed, outside := t.TempDir(), t.TempDir()
	link := filepath.Join(allowed, "project")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip(err)
	}
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{allowed}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	for _, host := range []string{link, outside, filepath.Join(outside, "missing"), filepath.Join(allowed, "missing"), "bad\x00path"} {
		response := post(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "p", HostRoot: host})
		if response.Error == nil || response.Error.Code != "ERR_ROOT_NOT_ALLOWED" || response.Error.Message != "host_root is not allowed" {
			t.Fatalf("nonuniform failure: %+v", response)
		}
	}
}

func TestRegistrationQuotasAreAtomicAndLeasesReclaimed(t *testing.T) {
	allowed := t.TempDir()
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{allowed}, MaxProjects: 2, ProjectIdleTimeout: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	var wait sync.WaitGroup
	for i := 0; i < 12; i++ {
		wait.Add(1)
		go func(id int) {
			defer wait.Done()
			post(t, httpServer.URL+"/v1/projects/open", request{ProjectID: fmt.Sprint(id), HostRoot: allowed})
		}(i)
	}
	wait.Wait()
	if len(server.roots) != 2 {
		t.Fatalf("quota retained %d roots", len(server.roots))
	}
	long := post(t, httpServer.URL+"/v1/projects/open", request{ProjectID: strings.Repeat("a", 129), HostRoot: allowed})
	if long.Error == nil {
		t.Fatal("overlong ID accepted")
	}
	var expiredID string
	for id := range server.roots {
		expiredID = id
		break
	}
	expired := server.roots[expiredID]
	server.lastUsed[expiredID] = time.Now().Add(-2 * time.Minute)
	postOK(t, httpServer.URL+"/v1/projects/open", request{ProjectID: "replacement", HostRoot: allowed})
	if _, err := expired.ReadFile("anything", 16); err == nil {
		t.Fatal("expired root still usable")
	}
	if len(server.roots) != 2 {
		t.Fatal("lease failed to reclaim quota")
	}
}

func TestRegistrationRejectsSwappedDescendant(t *testing.T) {
	allowed, outside := t.TempDir(), t.TempDir()
	safe := filepath.Join(allowed, "safe")
	if err := os.Mkdir(safe, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(safe, "identity"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "identity"), []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(allowed, "project")
	if err := os.Symlink("safe", link); err != nil {
		t.Skip(err)
	}
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{allowed}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	done := make(chan struct{})
	var wait sync.WaitGroup
	wait.Add(1)
	go func() {
		defer wait.Done()
		for {
			select {
			case <-done:
				return
			default:
			}
			_ = os.Remove(link)
			_ = os.Symlink(outside, link)
			_ = os.Remove(link)
			_ = os.Symlink("safe", link)
		}
	}()
	defer func() { close(done); wait.Wait() }()
	for i := 0; i < 500; i++ {
		handle, err := server.openAuthorizedRoot(link)
		if err != nil {
			continue
		}
		data, err := handle.ReadFile("identity", 16)
		_ = handle.Close()
		if err == nil && string(data) != "safe" {
			t.Fatalf("namespace race crossed allowlist: %q", data)
		}
	}
}
