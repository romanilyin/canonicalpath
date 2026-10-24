package canonicalfsrpc

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFailedAllowedRootBootstrapClosesEarlierHandles(t *testing.T) {
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	countHandles := func() int {
		t.Helper()
		entries, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			t.Skipf("cannot inspect process descriptors: %v", err)
		}
		count := 0
		for _, entry := range entries {
			name, err := os.Readlink(filepath.Join("/proc/self/fd", entry.Name()))
			if err == nil && name == directory {
				count++
			}
		}
		return count
	}
	before := countHandles()
	for attempt := 0; attempt < 5; attempt++ {
		server, err := NewServer(ServerOptions{
			CapabilityToken: testCapabilityToken,
			AllowedRoots:    []string{directory, filepath.Join(t.TempDir(), "missing")},
		})
		if err == nil || server != nil {
			if server != nil {
				_ = server.Close()
			}
			t.Fatalf("bootstrap accepted a missing later root: %v", err)
		}
		if after := countHandles(); after != before {
			t.Fatalf("failed bootstrap leaked directory handles: before=%d after=%d", before, after)
		}
	}
}
