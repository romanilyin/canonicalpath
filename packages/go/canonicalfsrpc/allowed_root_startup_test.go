package canonicalfsrpc

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/romanilyin/canonicalpath/packages/go/canonicalfs"
)

func requireClosedAllowedRoot(t *testing.T, handle *canonicalfs.Root) {
	t.Helper()
	if _, err := handle.Stat("."); !errors.Is(err, os.ErrClosed) {
		t.Fatalf("failed binding retained a usable root: %v", err)
	}
}

func TestAllowedRootBindingRejectsDifferentDirectory(t *testing.T) {
	// This exercises the identity check even on hosts where open directories
	// cannot be renamed or creating symlinks requires additional privileges.
	handle, err := canonicalfs.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	bound, err := bindAllowedRoot(t.TempDir(), handle)
	if !errors.Is(err, errAllowedRootChanged) || bound.handle != nil {
		t.Fatalf("different directory accepted as the opened root: %+v %v", bound, err)
	}
	requireClosedAllowedRoot(t, handle)
}

func TestAllowedRootBindingRejectsStartupNamespaceReplacement(t *testing.T) {
	for _, replaceAncestor := range []bool{false, true} {
		name := "root"
		if replaceAncestor {
			name = "ancestor"
		}
		t.Run(name, func(t *testing.T) {
			base := t.TempDir()
			parent := filepath.Join(base, "parent")
			alias := filepath.Join(parent, "allowed")
			if err := os.MkdirAll(alias, 0o700); err != nil {
				t.Fatal(err)
			}
			handle, err := canonicalfs.OpenRoot(alias)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = handle.Close() })
			// Pause at the real acquisition/binding boundary. The constructor
			// must never authorize a different object found through this name.
			replaced := alias
			if replaceAncestor {
				replaced = parent
			}
			if err := os.Rename(replaced, filepath.Join(base, "moved")); err != nil {
				t.Skipf("host cannot rename an open directory: %v", err)
			}
			if err := os.MkdirAll(alias, 0o700); err != nil {
				t.Fatal(err)
			}
			bound, err := bindAllowedRoot(alias, handle)
			if !errors.Is(err, errAllowedRootChanged) || bound.handle != nil {
				t.Fatalf("replacement root became authority: %+v %v", bound, err)
			}
			requireClosedAllowedRoot(t, handle)
		})
	}
}

func TestAllowedRootBindingRejectsRetargetedStartupAlias(t *testing.T) {
	trusted, outside := t.TempDir(), t.TempDir()
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(trusted, alias); err != nil {
		t.Skipf("host cannot create directory symlink: %v", err)
	}
	handle, err := canonicalfs.OpenRoot(alias)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, alias); err != nil {
		t.Fatal(err)
	}
	bound, err := bindAllowedRoot(alias, handle)
	if !errors.Is(err, errAllowedRootChanged) || bound.handle != nil {
		t.Fatalf("retargeted alias became authority: %+v %v", bound, err)
	}
	requireClosedAllowedRoot(t, handle)
}

func TestAllowedRootBindingFailureClosesAcquiredHandle(t *testing.T) {
	handle, err := canonicalfs.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	bound, err := bindAllowedRoot(filepath.Join(t.TempDir(), "missing"), handle)
	if err == nil || bound.handle != nil {
		t.Fatalf("missing alias accepted: %+v %v", bound, err)
	}
	requireClosedAllowedRoot(t, handle)
}

func TestAllowedRootBindingRetainsTheAcquiredHandle(t *testing.T) {
	alias := t.TempDir()
	if err := os.WriteFile(filepath.Join(alias, "identity"), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, err := canonicalfs.OpenRoot(alias)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	bound, err := bindAllowedRoot(alias, handle)
	if err != nil {
		t.Fatal(err)
	}
	if bound.handle != handle {
		t.Fatal("binding replaced the acquired authority handle")
	}
	data, err := bound.handle.ReadFile("identity", 16)
	if err != nil || string(data) != "original" {
		t.Fatalf("bound handle does not access original root: %q %v", data, err)
	}
}

func TestNewServerAllowedRootsAreValidatedAndDeduplicated(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, []byte("not a root"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, roots := range [][]string{
		nil,
		{""},
		{" \t "},
		{"bad\x00root"},
		{filepath.Join(t.TempDir(), "missing")},
		{file},
		{directory, file},
		{directory, "bad\x00root"},
	} {
		server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: roots})
		if err == nil || server != nil {
			if server != nil {
				_ = server.Close()
			}
			t.Fatalf("invalid allowed roots accepted: %q %v", roots, err)
		}
	}
	server, err := NewServer(ServerOptions{CapabilityToken: testCapabilityToken, AllowedRoots: []string{directory, " " + directory + " "}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	if len(server.allowedRoots) != 1 {
		t.Fatalf("duplicate alias retained %d handles", len(server.allowedRoots))
	}
	handle := server.allowedRoots[0].handle
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	requireClosedAllowedRoot(t, handle)
}
