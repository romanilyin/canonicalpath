package canonicalfs

import (
	"archive/zip"
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestZipBudgetCountsActualMetadata(t *testing.T) {
	project := t.TempDir()
	name := filepath.Join(project, "forged.zip")
	if err := makeZip(name, []zipEntry{{name: "a", content: "a"}, {name: "b", content: "b"}}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	// Lie about the number of central-directory headers in the end record.
	binary.LittleEndian.PutUint16(data[len(data)-14:len(data)-12], 1)
	binary.LittleEndian.PutUint16(data[len(data)-12:len(data)-10], 1)
	if err := os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	assertCode(t, root.ExtractZipWithLimits(context.Background(), "forged.zip", "dest", ZipLimits{MaxEntries: 1}), ErrReadLimitExceeded)
	if _, err := os.Stat(filepath.Join(project, "dest")); !os.IsNotExist(err) {
		t.Fatal("forged metadata created output before rejection")
	}
}

func TestZipExtractionBudgets(t *testing.T) {
	tests := []struct {
		name    string
		limits  ZipLimits
		entries []zipEntry
	}{
		{"count", ZipLimits{MaxEntries: 1}, []zipEntry{{name: "a", content: "a"}, {name: "b", content: "b"}}},
		{"entry", ZipLimits{MaxEntryBytes: 3}, []zipEntry{{name: "a", content: "large"}}},
		{"total", ZipLimits{MaxTotalBytes: 3}, []zipEntry{{name: "a", content: "aa"}, {name: "b", content: "bb"}}},
		{"compressed", ZipLimits{MaxArchiveBytes: 1}, []zipEntry{{name: "a", content: "a"}}},
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
			assertCode(t, root.ExtractZipWithLimits(context.Background(), "archive.zip", "dest", test.limits), ErrReadLimitExceeded)
			if _, err := os.Stat(filepath.Join(project, "dest")); !os.IsNotExist(err) {
				t.Fatal("budget rejected only after output creation")
			}
		})
	}
}

func TestZipRejectsCompressionBombAndCancellation(t *testing.T) {
	project := t.TempDir()
	file, err := os.Create(filepath.Join(project, "bomb.zip"))
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("bomb")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte(strings.Repeat("a", 100000)))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	assertCode(t, root.ExtractZipWithLimits(context.Background(), "bomb.zip", "dest", ZipLimits{MaxCompressionRatio: 2}), ErrReadLimitExceeded)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := root.ExtractZipWithLimits(ctx, "bomb.zip", "dest", ZipLimits{}); err == nil {
		t.Fatal("cancelled extraction succeeded")
	}
}

func TestZipCannotTraversePreexistingInRootLinks(t *testing.T) {
	for _, target := range []string{"destination", "member-parent"} {
		t.Run(target, func(t *testing.T) {
			project := t.TempDir()
			if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{{name: "link/pwned", content: "bad"}}); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(project, "sibling"), 0700); err != nil {
				t.Fatal(err)
			}
			link := filepath.Join(project, "dest")
			linkTarget := "sibling"
			if target == "member-parent" {
				if err := os.Mkdir(link, 0700); err != nil {
					t.Fatal(err)
				}
				link = filepath.Join(link, "link")
				linkTarget = "../../sibling"
			}
			if err := os.Symlink(linkTarget, link); err != nil {
				t.Skip(err)
			}
			root, err := OpenRoot(project)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			if err := root.ExtractZip("archive.zip", "dest"); err == nil {
				t.Fatal("symlink extraction accepted")
			}
			if _, err := os.Stat(filepath.Join(project, "sibling", "pwned")); !os.IsNotExist(err) {
				t.Fatal("write crossed extraction destination")
			}
		})
	}
}

func TestZipRejectsSymlinkEntries(t *testing.T) {
	project := t.TempDir()
	if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{{name: "link", content: "../sibling", mode: os.ModeSymlink | 0777}}); err != nil {
		t.Fatal(err)
	}
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	assertCode(t, root.ExtractZip("archive.zip", "dest"), ErrArchiveTraversal)
}

func TestZipActualByteBudgetRemovesPartialOutput(t *testing.T) {
	project := t.TempDir()
	if err := makeZip(filepath.Join(project, "archive.zip"), []zipEntry{{name: "a", content: "oversized"}}); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.OpenReader(filepath.Join(project, "archive.zip"))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	_, err = extractZipFile(context.Background(), root, reader.File[0], "partial", 3)
	assertCode(t, err, ErrReadLimitExceeded)
	if _, err := os.Stat(filepath.Join(project, "partial")); !os.IsNotExist(err) {
		t.Fatal("partial expanded output retained")
	}
}
