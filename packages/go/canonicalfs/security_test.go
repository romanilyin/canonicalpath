package canonicalfs

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRootReadWriteInside(t *testing.T) {
	rootDir := t.TempDir()
	root, err := OpenRoot(rootDir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	if err := root.MkdirAll("safe", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile("safe/README.md", []byte("ok"), OpenOptions{}); err != nil {
		t.Fatal(err)
	}
	data, err := root.ReadFile("safe/README.md", 16)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "ok" {
		t.Fatalf("expected ok, got %q", string(data))
	}
}

func TestRootRejectsLexicalEscape(t *testing.T) {
	root, err := OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	assertCode(t, root.WriteFile("../outside/pwned.txt", []byte("x"), OpenOptions{}), ErrOutsideRoot)
	_, err = root.ReadFile("/etc/passwd", 1024)
	assertCode(t, err, ErrAbsolutePath)
	_, err = root.ReadFile("safe\x00name.txt", 1024)
	assertCode(t, err, ErrNULByte)
}

func TestRootRejectsSymlinkEscape(t *testing.T) {
	base := t.TempDir()
	project := filepath.Join(base, "project")
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(project, "link_out")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	if _, err := root.ReadFile("link_out/secret.txt", 1024); err == nil {
		t.Fatal("expected symlink escape read to fail")
	}
}

func TestRootRename(t *testing.T) {
	root, err := OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	if err := root.MkdirAll("safe", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile("safe/file.txt", []byte("ok"), OpenOptions{}); err != nil {
		t.Fatal(err)
	}

	err = root.Rename("safe/file.txt", "safe/file2.txt")
	if errors.Is(err, ErrUnsupportedOperation) {
		assertCode(t, root.Rename("safe/file.txt", "../outside/file.txt"), ErrOutsideRoot)
		return
	}
	if err != nil {
		t.Fatalf("rename failed: %v", err)
	}
	data, err := root.ReadFile("safe/file2.txt", 16)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "ok" {
		t.Fatalf("expected renamed file content ok, got %q", string(data))
	}
	assertCode(t, root.Rename("safe/file2.txt", "../outside/file.txt"), ErrOutsideRoot)
}

func assertCode(t *testing.T, err error, code ErrorCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s, got nil", code)
	}
	if got := Code(err); got != code {
		t.Fatalf("expected %s, got %s (%v)", code, got, err)
	}
}
