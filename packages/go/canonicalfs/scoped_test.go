package canonicalfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScopedRootStaysPinnedAfterAnchorReplacement(t *testing.T) {
	project := t.TempDir()
	anchor := filepath.Join(project, "scope")
	if err := os.Mkdir(anchor, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(anchor, "file.txt"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	scope, err := root.OpenScopedRoot("scope", false)
	if err != nil {
		t.Fatal(err)
	}
	defer scope.Close()
	if err := os.Rename(anchor, filepath.Join(project, "moved")); err != nil {
		t.Skipf("open directory cannot be renamed: %v", err)
	}
	if err := os.Mkdir(anchor, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(anchor, "file.txt"), []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	data, err := scope.ReadFile("file.txt", 100)
	if err != nil || string(data) != "original" {
		t.Fatalf("scope followed replacement: %q %v", data, err)
	}
	if err := scope.WriteFile("file.txt", []byte("updated"), OpenOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := scope.MkdirAll("new-directory", 0700); err != nil {
		t.Fatal(err)
	}
	if err := scope.Remove("file.txt"); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(anchor, "file.txt"))
	if err != nil || string(data) != "replacement" {
		t.Fatalf("replacement changed: %q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(anchor, "new-directory")); !os.IsNotExist(err) {
		t.Fatal("mkdir followed replacement")
	}
}
