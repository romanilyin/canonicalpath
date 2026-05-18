package canonicalfs

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractZipInsideDestination(t *testing.T) {
	project := t.TempDir()
	if err := makeZip(filepath.Join(project, "archives", "ok.zip"), []zipEntry{
		{name: "dir/", mode: os.ModeDir | 0o755},
		{name: "dir/file.txt", content: "nested"},
		{name: "root.txt", content: "root"},
	}); err != nil {
		t.Fatal(err)
	}

	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	if err := root.ExtractZip("archives/ok.zip", "safe/extract"); err != nil {
		t.Fatal(err)
	}
	assertReadFile(t, root, "safe/extract/dir/file.txt", "nested")
	assertReadFile(t, root, "safe/extract/root.txt", "root")
	assertDirectory(t, root, "safe/extract/dir")
}

func TestExtractZipRejectsDestinationTraversal(t *testing.T) {
	project := t.TempDir()
	if err := makeZip(filepath.Join(project, "archives", "slip.zip"), []zipEntry{
		{name: "a/../../outside/pwned.txt", content: "pwned"},
	}); err != nil {
		t.Fatal(err)
	}

	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	assertCode(t, root.ExtractZip("archives/slip.zip", "safe/extract"), ErrArchiveTraversal)
	if _, err := os.Stat(filepath.Join(project, "outside", "pwned.txt")); err == nil {
		t.Fatal("archive traversal wrote outside destination")
	}
}

func TestExtractZipRejectsUnsafeEntryNames(t *testing.T) {
	unsafeNames := []string{
		"",
		"/absolute.txt",
		"C:/absolute.txt",
		"dir\\file.txt",
		"safe\x00name.txt",
		".",
	}

	for _, entryName := range unsafeNames {
		entryName := entryName
		t.Run(entryName, func(t *testing.T) {
			project := t.TempDir()
			if err := makeZip(filepath.Join(project, "archives", "unsafe.zip"), []zipEntry{{name: entryName, content: "unsafe"}}); err != nil {
				t.Fatal(err)
			}

			root, err := OpenRoot(project)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()

			assertCode(t, root.ExtractZip("archives/unsafe.zip", "safe/extract"), ErrArchiveTraversal)
		})
	}
}

type zipEntry struct {
	name    string
	content string
	mode    os.FileMode
}

func makeZip(zipPath string, entries []zipEntry) error {
	if err := os.MkdirAll(filepath.Dir(zipPath), 0o755); err != nil {
		return err
	}
	file, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	defer writer.Close()
	for _, item := range entries {
		header := &zip.FileHeader{Name: item.name}
		if item.mode != 0 {
			header.SetMode(item.mode)
		} else {
			header.SetMode(0o644)
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		if item.mode.IsDir() {
			continue
		}
		if _, err := entry.Write([]byte(item.content)); err != nil {
			return err
		}
	}
	return nil
}

func assertReadFile(t *testing.T, root *Root, rel string, expected string) {
	t.Helper()
	data, err := root.ReadFile(rel, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != expected {
		t.Fatalf("expected %q, got %q", expected, string(data))
	}
}

func assertDirectory(t *testing.T, root *Root, rel string) {
	t.Helper()
	info, err := root.Stat(rel)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatalf("expected %s to be a directory", rel)
	}
}
