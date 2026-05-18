package canonicalfs

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
)

func TestRootRejectsSymlinkSwapRace(t *testing.T) {
	base := t.TempDir()
	project := filepath.Join(base, "project")
	inside := filepath.Join(project, "race", "inside")
	outside := filepath.Join(base, "outside")
	link := filepath.Join(project, "race", "link")
	insideLinkTarget := "inside"
	outsideLinkTarget := filepath.Join("..", "..", "outside")

	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inside, "secret.txt"), []byte("inside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(insideLinkTarget, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	var stop atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		for !stop.Load() {
			replaceSymlink(link, insideLinkTarget)
			runtime.Gosched()
			replaceSymlink(link, outsideLinkTarget)
			runtime.Gosched()
		}
	}()
	defer func() {
		stop.Store(true)
		<-done
	}()

	for i := 0; i < 2000; i++ {
		data, err := root.ReadFile("race/link/secret.txt", 1024)
		if err != nil {
			continue
		}
		switch string(data) {
		case "inside":
			continue
		case "outside":
			t.Fatal("read escaped through symlink swap race")
		default:
			t.Fatalf("unexpected read content: %q", string(data))
		}
	}
}

func replaceSymlink(link string, target string) {
	if err := os.Remove(link); err != nil && !errors.Is(err, os.ErrNotExist) {
		return
	}
	_ = os.Symlink(target, link)
}
