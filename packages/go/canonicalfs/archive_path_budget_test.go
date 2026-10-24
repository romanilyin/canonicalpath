//go:build aix || android || darwin || dragonfly || freebsd || illumos || ios || linux || netbsd || openbsd || solaris || windows

package canonicalfs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestZipPathBudgetsPreflightBeforeOutput(t *testing.T) {
	tests := []struct {
		name    string
		dest    string
		entries []zipEntry
		limits  ZipLimits
	}{
		{"raw-name", "out", []zipEntry{{name: "a//b"}}, ZipLimits{MaxEntryNameBytes: 3}},
		{"name-bytes-not-runes", "out", []zipEntry{{name: "яя"}}, ZipLimits{MaxEntryNameBytes: 3}},
		{"raw-destination", "out//x", []zipEntry{{name: "a"}}, ZipLimits{MaxEntryNameBytes: 5}},
		{"file-depth-includes-destination", "out", []zipEntry{{name: "a/b/c"}}, ZipLimits{MaxPathDepth: 3}},
		{"directory-depth", "out", []zipEntry{{name: "a/b/c/", mode: os.ModeDir | 0755}}, ZipLimits{MaxPathDepth: 3}},
		{"destination-depth", "out/a/b", []zipEntry{{name: "c"}}, ZipLimits{MaxPathDepth: 2}},
		{"implicit-directories", "out", []zipEntry{{name: "a/b/file"}}, ZipLimits{MaxDirectories: 2}},
		{"explicit-directory", "out", []zipEntry{{name: "a/b/", mode: os.ModeDir | 0755}}, ZipLimits{MaxDirectories: 2}},
		{"directory-components-count-as-objects", "out", []zipEntry{{name: "a/b/file"}}, ZipLimits{MaxObjects: 3}},
		{"files-count-as-objects", "out", []zipEntry{{name: "a"}, {name: "b"}}, ZipLimits{MaxObjects: 2}},
		{"repeated-prefix-work", "out", []zipEntry{{name: "a/b"}, {name: "a/c"}}, ZipLimits{MaxTotalPathComponents: 4}},
		{"repeated-prefix-directories", "out", []zipEntry{{name: "a/b"}, {name: "a/c"}}, ZipLimits{MaxDirectories: 2}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			project := t.TempDir()
			if err := makeZip(filepath.Join(project, "archive.zip"), test.entries); err != nil {
				t.Fatal(err)
			}
			root, err := OpenRoot(project)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			assertCode(t, root.ExtractZipWithLimits(context.Background(), "archive.zip", test.dest, test.limits), ErrReadLimitExceeded)
			if _, err := os.Lstat(filepath.Join(project, "out")); !os.IsNotExist(err) {
				t.Fatalf("path budget rejection created output: %v", err)
			}
		})
	}
}

func TestZipPathBudgetsAcceptExactBoundaries(t *testing.T) {
	for _, directory := range []bool{false, true} {
		name := "file"
		entry := zipEntry{name: "a/яя", content: "exact"}
		limits := ZipLimits{MaxEntryNameBytes: 6, MaxPathDepth: 3, MaxTotalPathComponents: 3, MaxDirectories: 2, MaxObjects: 3}
		if directory {
			name = "directory"
			entry = zipEntry{name: "a/b/", mode: os.ModeDir | 0755}
			limits.MaxEntryNameBytes = 4
			limits.MaxDirectories = 3
		}
		t.Run(name, func(t *testing.T) {
			project := t.TempDir()
			if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{entry}); err != nil {
				t.Fatal(err)
			}
			root, err := OpenRoot(project)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			if err := root.ExtractZipWithLimits(context.Background(), "archive.zip", "out", limits); err != nil {
				t.Fatal(err)
			}
			if directory {
				assertDirectory(t, root, "out/a/b")
			} else {
				assertReadFile(t, root, "out/a/яя", "exact")
			}
		})
	}
}

func TestZipPathWorkBudgetCountsExistingPrefixes(t *testing.T) {
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, "out", "shared"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{{name: "shared/a"}, {name: "shared/b"}}); err != nil {
		t.Fatal(err)
	}
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	assertCode(t, root.ExtractZipWithLimits(context.Background(), "archive.zip", "out", ZipLimits{MaxTotalPathComponents: 4}), ErrReadLimitExceeded)
	entries, err := os.ReadDir(filepath.Join(project, "out", "shared"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("work budget rejection changed existing directory: entries=%d, err=%v", len(entries), err)
	}
}

func TestZipDefaultPathDepthRejectsBeforeOutput(t *testing.T) {
	defaults, err := defaultZipLimits(ZipLimits{})
	if err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{{name: strings.Repeat("a/", defaults.MaxPathDepth) + "file"}}); err != nil {
		t.Fatal(err)
	}
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	assertCode(t, root.ExtractZip("archive.zip", "out"), ErrReadLimitExceeded)
	if _, err := os.Lstat(filepath.Join(project, "out")); !os.IsNotExist(err) {
		t.Fatal("default path-depth limit created output before rejection")
	}
}

// Cancel when the walk has actually created one component. This exercises a
// cancellation boundary between filesystem operations without timing a race or
// introducing a mutable production test hook.
type cancelOnCreatedDirectory struct {
	context.Context
	cancel context.CancelFunc
	path   string
}

func (c cancelOnCreatedDirectory) Err() error {
	if _, err := os.Lstat(c.path); err == nil {
		c.cancel()
	}
	return c.Context.Err()
}

func TestZipDirectoryWalkStopsOnCancellation(t *testing.T) {
	project := t.TempDir()
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	observed := cancelOnCreatedDirectory{Context: ctx, cancel: cancel, path: filepath.Join(project, "first")}
	child, err := root.openZipDestination(observed, "first/second/third")
	if child != nil {
		_ = child.Close()
		t.Fatal("cancelled walk returned a root")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	assertDirectory(t, root, "first")
	if _, err := os.Lstat(filepath.Join(project, "first", "second")); !os.IsNotExist(err) {
		t.Fatal("walk kept creating components after cancellation")
	}
}

func TestZipFailurePreservesExistingAndCompleteOutput(t *testing.T) {
	project := t.TempDir()
	if err := os.Mkdir(filepath.Join(project, "out"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "out", "existing"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{{name: "new/complete", content: "done"}, {name: "existing/child"}}); err != nil {
		t.Fatal(err)
	}
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.ExtractZip("archive.zip", "out"); err == nil {
		t.Fatal("extraction through an existing regular file succeeded")
	}
	assertReadFile(t, root, "out/existing", "keep")
	assertReadFile(t, root, "out/new/complete", "done")
}
