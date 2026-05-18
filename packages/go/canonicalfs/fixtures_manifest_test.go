package canonicalfs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
)

type fsFixtureManifest struct {
	Version  int         `json:"version"`
	Fixtures []fsFixture `json:"fixtures"`
}

type fsFixture struct {
	ID        string   `json:"id"`
	Operation string   `json:"operation"`
	Path      string   `json:"path"`
	Target    string   `json:"target"`
	Expect    string   `json:"expect"`
	Error     string   `json:"error"`
	ErrorMode string   `json:"errorMode"`
	Platforms []string `json:"platforms"`
}

func TestFSFixtureManifest(t *testing.T) {
	manifest := readFSFixtureManifest(t)
	project, symlinkOK, raceOK := makeProjectFixture(t)
	root, err := OpenRoot(project)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	for _, fixture := range manifest.Fixtures {
		fixture := fixture
		if !fixtureApplies(fixture.Platforms) {
			continue
		}
		switch fixture.Operation {
		case "read", "write", "stat", "mkdir", "remove", "rename", "extract":
		default:
			continue
		}

		t.Run(fixture.ID, func(t *testing.T) {
			if fixture.Error == string(ErrSymlinkEscape) && !symlinkOK {
				t.Skip("symlink fixture unavailable")
			}
			if fixture.Error == string(ErrRaceDetected) && !raceOK {
				t.Skip("race fixture unavailable")
			}
			err := runFSFixture(root, project, fixture)
			if fixture.Expect == "allow" {
				if err != nil {
					t.Fatalf("expected allow, got %v", err)
				}
				return
			}

			if err == nil {
				t.Fatalf("expected reject %s, got nil", fixture.Error)
			}
			if fixture.ErrorMode == "reject-only" {
				return
			}
			if got := Code(err); got != ErrorCode(fixture.Error) {
				t.Fatalf("expected %s, got %s (%v)", fixture.Error, got, err)
			}
		})
	}
}

func readFSFixtureManifest(t *testing.T) fsFixtureManifest {
	t.Helper()
	path := filepath.Join("..", "..", "..", "spec", "testdata", "fs_fixtures_manifest.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var manifest fsFixtureManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	return manifest
}

func makeProjectFixture(t *testing.T) (string, bool, bool) {
	t.Helper()
	base := t.TempDir()
	project := filepath.Join(base, "project")
	outside := filepath.Join(base, "outside")
	raceInside := filepath.Join(project, "race", "inside")
	raceLink := filepath.Join(project, "race", "link")
	if err := os.MkdirAll(filepath.Join(project, "safe"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(raceInside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "safe", "README.md"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "safe", "file.txt"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "safe", "remove-me.txt"), []byte("remove"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(raceInside, "secret.txt"), []byte("inside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := makeSlipZip(filepath.Join(project, "archives", "slip.zip")); err != nil {
		t.Fatal(err)
	}
	if err := makeZip(filepath.Join(project, "archives", "safe.zip"), []zipEntry{{name: "file.txt", content: "safe"}}); err != nil {
		t.Fatal(err)
	}
	if err := makeZip(filepath.Join(project, "archives", "absolute.zip"), []zipEntry{{name: "/tmp/pwned.txt", content: "pwned"}}); err != nil {
		t.Fatal(err)
	}
	if err := makeZip(filepath.Join(project, "archives", "backslash.zip"), []zipEntry{{name: "dir\\pwned.txt", content: "pwned"}}); err != nil {
		t.Fatal(err)
	}
	if err := makeZip(filepath.Join(project, "archives", "drive-relative.zip"), []zipEntry{{name: "C:evil.txt", content: "pwned"}}); err != nil {
		t.Fatal(err)
	}
	symlinkOK := true
	if err := os.Symlink(outside, filepath.Join(project, "link_out")); err != nil {
		t.Logf("symlink fixture unavailable: %v", err)
		symlinkOK = false
	}
	raceOK := true
	if err := os.Symlink("inside", raceLink); err != nil {
		t.Logf("race fixture unavailable: %v", err)
		raceOK = false
	}
	return project, symlinkOK, raceOK
}

func fixtureApplies(platforms []string) bool {
	if len(platforms) == 0 {
		return true
	}
	for _, platform := range platforms {
		switch platform {
		case "windows":
			if runtime.GOOS == "windows" {
				return true
			}
		case "macos":
			if runtime.GOOS == "darwin" {
				return true
			}
		case "linux", "wsl":
			if runtime.GOOS == "linux" {
				return true
			}
		}
	}
	return false
}

func runFSFixture(root *Root, project string, fixture fsFixture) error {
	switch fixture.Operation {
	case "read":
		if fixture.Error == string(ErrRaceDetected) {
			return runRaceFixture(root, project, fixture.Path)
		}
		_, err := root.ReadFile(fixture.Path, 1024)
		return err
	case "write":
		return root.WriteFile(fixture.Path, []byte("test"), OpenOptions{})
	case "stat":
		_, err := root.Stat(fixture.Path)
		return err
	case "mkdir":
		return root.MkdirAll(fixture.Path, 0o755)
	case "remove":
		return root.Remove(fixture.Path)
	case "rename":
		return root.Rename(fixture.Path, fixture.Target)
	case "extract":
		target := fixture.Target
		if target == "" {
			target = "."
		}
		return root.ExtractZip(fixture.Path, target)
	default:
		return nil
	}
}

func runRaceFixture(root *Root, project string, rel string) error {
	link := filepath.Join(project, "race", "link")
	insideTarget := "inside"
	outsideTarget := filepath.Join("..", "..", "outside")

	var stop atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		for !stop.Load() {
			replaceSymlink(link, insideTarget)
			runtime.Gosched()
			replaceSymlink(link, outsideTarget)
			runtime.Gosched()
		}
	}()
	defer func() {
		stop.Store(true)
		<-done
	}()

	for i := 0; i < 2000; i++ {
		data, err := root.ReadFile(rel, 1024)
		if err != nil {
			continue
		}
		switch string(data) {
		case "inside":
			continue
		case "outside":
			return fmt.Errorf("canonicalfs: read escaped through symlink swap race")
		default:
			return fmt.Errorf("canonicalfs: unexpected race fixture content %q", string(data))
		}
	}
	return newError(ErrRaceDetected, "symlink swap race attempt did not escape root")
}

func makeSlipZip(zipPath string) error {
	return makeZip(zipPath, []zipEntry{{name: "../outside/pwned.txt", content: "pwned"}})
}
