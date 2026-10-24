//go:build !aix && !android && !darwin && !dragonfly && !freebsd && !illumos && !ios && !linux && !netbsd && !openbsd && !solaris && !windows

package canonicalfs

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestUnsupportedPlatformRejectsOpenRoot(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{dir, filepath.Join(dir, "absent"), "", "bad\x00root"} {
		t.Run(name, func(t *testing.T) {
			root, err := OpenRoot(name)
			if root != nil {
				if root.root != nil {
					_ = root.root.Close()
				}
				t.Error("unsupported platform returned a root handle")
			}
			assertUnsupportedPlatform(t, err)
		})
	}
}

func TestUnsupportedPlatformRejectsAllRootMethods(t *testing.T) {
	dir := t.TempDir()
	sentinel := filepath.Join(dir, "sentinel.txt")
	if err := os.WriteFile(sentinel, []byte("unchanged"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Bypass our constructor deliberately. Every method must still reject an
	// unsafe stdlib root, so constructor-only guards cannot satisfy this test.
	raw, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()

	calls := unsupportedPlatformCalls()
	methods := reflect.TypeOf((*Root)(nil))
	if len(calls) != methods.NumMethod() {
		t.Fatalf("denial tests cover %d of %d exported Root methods", len(calls), methods.NumMethod())
	}
	for index := 0; index < methods.NumMethod(); index++ {
		if _, ok := calls[methods.Method(index).Name]; !ok {
			t.Fatalf("missing denial test for Root.%s", methods.Method(index).Name)
		}
	}

	roots := map[string]*Root{
		"nil":    nil,
		"zero":   {},
		"raw":    {root: raw},
		"scoped": {root: raw, rejectFileLinks: true},
	}
	paths := []string{"sentinel.txt", "new/subdir", ".", "../outside", "/absolute", "bad\x00path"}
	for state, root := range roots {
		t.Run(state, func(t *testing.T) {
			for name, call := range calls {
				t.Run(name, func(t *testing.T) {
					for _, rel := range paths {
						t.Run(rel, func(t *testing.T) {
							assertUnsupportedPlatform(t, call(t, root, rel))
						})
					}
				})
			}
		})
	}
	contents, err := os.ReadFile(sentinel)
	if err != nil || string(contents) != "unchanged" {
		t.Fatalf("unsupported operation changed sentinel: %q, %v", contents, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "sentinel.txt" {
		t.Fatalf("unsupported operation changed directory: %v, %v", entries, err)
	}
	if _, err := raw.Stat("."); err != nil {
		t.Fatalf("unsupported operation touched the raw handle: %v", err)
	}
}

// A nil embedded Context panics if any method is called. Rejection must precede
// context.WithTimeout, cancellation callbacks, ZIP parsing and filesystem I/O.
type untouchedUnsupportedContext struct{ context.Context }

func unsupportedPlatformCalls() map[string]func(*testing.T, *Root, string) error {
	return map[string]func(*testing.T, *Root, string) error{
		"OpenRoot": func(t *testing.T, root *Root, rel string) error {
			child, err := root.OpenRoot(rel)
			if child != nil {
				if child.root != nil {
					_ = child.root.Close()
				}
				t.Error("unsupported OpenRoot returned a child")
			}
			return err
		},
		"OpenScopedRoot": func(t *testing.T, root *Root, rel string) error {
			for _, create := range []bool{false, true} {
				child, err := root.OpenScopedRoot(rel, create)
				if child != nil {
					if child.root != nil {
						_ = child.root.Close()
					}
					t.Error("unsupported OpenScopedRoot returned a child")
				}
				assertUnsupportedPlatform(t, err)
			}
			return ErrUnsupportedOperation
		},
		"Open": func(t *testing.T, root *Root, rel string) error {
			file, err := root.Open(rel)
			if file != nil {
				_ = file.Close()
				t.Error("unsupported Open returned a file")
			}
			return err
		},
		"OpenFile": func(t *testing.T, root *Root, rel string) error {
			file, err := root.OpenFile(rel, OpenOptions{Create: true, Truncate: true})
			if file != nil {
				_ = file.Close()
				t.Error("unsupported OpenFile returned a file")
			}
			return err
		},
		"ReadFile": func(t *testing.T, root *Root, rel string) error {
			data, err := root.ReadFile(rel, 1024)
			if data != nil {
				t.Error("unsupported ReadFile returned data")
			}
			return err
		},
		"WriteFile": func(_ *testing.T, root *Root, rel string) error {
			return root.WriteFile(rel, []byte("changed"), OpenOptions{})
		},
		"MkdirAll": func(_ *testing.T, root *Root, rel string) error {
			return root.MkdirAll(rel, 0o700)
		},
		"Remove": func(_ *testing.T, root *Root, rel string) error {
			return root.Remove(rel)
		},
		"Rename": func(_ *testing.T, root *Root, rel string) error {
			return root.Rename(rel, "renamed.txt")
		},
		"Stat": func(t *testing.T, root *Root, rel string) error {
			info, err := root.Stat(rel)
			if info != nil {
				t.Error("unsupported Stat returned metadata")
			}
			return err
		},
		"Walk": func(t *testing.T, root *Root, rel string) error {
			assertUnsupportedPlatform(t, root.Walk(rel, nil))
			return root.Walk(rel, func(string, fs.FileInfo, error) error {
				t.Error("unsupported Walk invoked a callback")
				return nil
			})
		},
		"ExtractZip": func(_ *testing.T, root *Root, rel string) error {
			return root.ExtractZip(rel, "extracted")
		},
		"ExtractZipWithLimits": func(t *testing.T, root *Root, rel string) error {
			for _, ctx := range []context.Context{nil, untouchedUnsupportedContext{}} {
				assertUnsupportedPlatform(t, root.ExtractZipWithLimits(ctx, rel, "extracted", ZipLimits{}))
			}
			return root.ExtractZipWithLimits(context.Background(), rel, "extracted", ZipLimits{MaxArchiveBytes: -1})
		},
		"Close": func(_ *testing.T, root *Root, _ string) error {
			return root.Close()
		},
	}
}

func assertUnsupportedPlatform(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrUnsupportedOperation) {
		t.Fatalf("expected ErrUnsupportedOperation before any work, got %v", err)
	}
}
