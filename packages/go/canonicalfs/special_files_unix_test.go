//go:build unix

package canonicalfs

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestSpecialFileWorker(t *testing.T) {
	mode := os.Getenv("CANONICALFS_TEST_SPECIAL_MODE")
	if mode == "" {
		return
	}
	r, err := OpenRoot(os.Getenv("CANONICALFS_TEST_SPECIAL_ROOT"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	switch mode {
	case "read":
		_, err = r.ReadFile("pipe", 100)
	case "write":
		err = r.WriteFile("pipe", bytes.Repeat([]byte("x"), 1<<20), OpenOptions{})
	case "archive":
		err = r.ExtractZipWithLimits(context.Background(), "pipe", "dest", ZipLimits{MaxDuration: 50 * time.Millisecond})
	}
	if err == nil {
		t.Fatal("special file was accepted")
	}
}

func TestSpecialFilesRejectWithoutBlocking(t *testing.T) {
	for _, mode := range []string{"read", "write", "archive"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			if err := syscall.Mkfifo(filepath.Join(dir, "pipe"), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSpecialFileWorker$", "-test.timeout=5s")
			child.Env = append(os.Environ(), "CANONICALFS_TEST_SPECIAL_MODE="+mode, "CANONICALFS_TEST_SPECIAL_ROOT="+dir)
			out, err := child.CombinedOutput()
			if err != nil {
				t.Fatalf("%s did not reject promptly: %v (deadline=%v)\n%s", mode, err, ctx.Err(), out)
			}
		})
	}
}
