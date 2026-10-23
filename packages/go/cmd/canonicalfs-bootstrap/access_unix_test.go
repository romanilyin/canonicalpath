//go:build unix

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func protectTestParent(t *testing.T, name string) {
	t.Helper()
	if err := os.Chmod(name, 0700); err != nil {
		t.Fatal(err)
	}
}

func TestBootstrapRejectsPublicParentAndMutableAncestor(t *testing.T) {
	parent := privateTestParent(t)
	if err := os.Chmod(parent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"-out-dir", filepath.Join(parent, "launch")}, &bytes.Buffer{}); err == nil {
		t.Fatal("public bootstrap parent accepted")
	}
	if _, err := os.Stat(filepath.Join(parent, "launch")); !os.IsNotExist(err) {
		t.Fatal("public parent rejection created output")
	}
	if err := os.Chmod(parent, 0777); err != nil {
		t.Fatal(err)
	}
	private := filepath.Join(parent, "private")
	if err := os.Mkdir(private, 0700); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"-out-dir", filepath.Join(private, "launch")}, &bytes.Buffer{}); err == nil {
		t.Fatal("mutable non-sticky ancestor accepted")
	}
}
