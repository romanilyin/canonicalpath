package canonicalpath

import (
	"path/filepath"
	"testing"
)

func TestCanonicalOutputsRemainCanonical(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "spec", "testdata", "*_cases.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("shared vectors unavailable: %v", err)
	}
	for _, file := range files {
		for _, testCase := range readVectorFile(t, file).Cases {
			if testCase.Operation != "normalize" || testCase.Expected == "" {
				continue
			}
			t.Run(testCase.ID, func(t *testing.T) {
				actual, err := Normalize(testCase.Expected, Options{SourceHost: HostCanonical})
				if err != nil || string(actual) != testCase.Expected {
					t.Fatalf("canonical round trip: %q -> %q, %v", testCase.Expected, actual, err)
				}
			})
		}
	}
}

func TestCanonicalRelativeJoinRoundTrips(t *testing.T) {
	for _, testCase := range []struct{ root, target string }{
		{"/repo", `/repo/a\b`},
		{"/repo", "/repo/C:/nested"},
		{"/repo", "/repo/C:foo"},
		{"c:/repo", "c:/repo/C:foo"},
		{"//server/share", "//server/share/repo/file"},
		{"//?/c:/repo", "//?/c:/repo/file"},
		{"//?/UNC/server/share", "//?/UNC/server/share/repo/file"},
		{"/repo/cafe\u0301", "/repo/cafe\u0301/😀/file"},
	} {
		rel, err := Relative(Path(testCase.root), Path(testCase.target))
		if err != nil {
			t.Fatal(err)
		}
		joined, err := Join(Path(testCase.root), rel)
		if err != nil || string(joined) != testCase.target {
			t.Fatalf("%q + %q = %q, want %q: %v", testCase.root, rel, joined, testCase.target, err)
		}
	}
}

func TestCanonicalJoinDoesNotRelaxRawFilesystemValidation(t *testing.T) {
	for _, raw := range []string{`a\b`, `\\server\share`, "/absolute", "c:/absolute", "C:relative", "../outside", "bad\x00path"} {
		if _, err := NormalizeRelative(raw); err == nil {
			t.Fatalf("raw filesystem path accepted: %q", raw)
		}
	}
	if actual, err := Join("/repo", `a\b`); err != nil || actual != `/repo/a\b` {
		t.Fatalf("canonical literal component lost: %q, %v", actual, err)
	}
}

func TestCanonicalJoinCleanedSelfPreservesRoot(t *testing.T) {
	for _, root := range []Path{".", "relative", "./C:root", "/repo", "c:/repo", "//server/share", "//?/c:/repo", "//?/UNC/server/share"} {
		for _, rel := range []RelativePath{".", "./", "./.", "a/..", "a/.././"} {
			actual, err := Join(root, rel)
			if err != nil || actual != root {
				t.Fatalf("%q + %q = %q, want original root: %v", root, rel, actual, err)
			}
		}
		if _, err := Join(root, ""); err == nil {
			t.Fatalf("empty raw relative accepted under %q", root)
		}
	}
	for _, root := range []Path{"c:/repo", "//server/share", "//?/c:/repo", "//?/UNC/server/share"} {
		if _, err := Join(root, `a\b/../file`); err == nil {
			t.Fatalf("discarded literal-backslash component accepted under %q", root)
		}
	}
	for _, raw := range []string{"./", "a/.."} {
		if _, err := NormalizeRelative(raw); err == nil {
			t.Fatalf("strict raw relative validation changed for %q", raw)
		}
	}
}

func TestCanonicalSerializersRejectUncleanOperands(t *testing.T) {
	if _, err := ToPOSIX("/repo/a/../b"); err == nil {
		t.Fatal("ToPOSIX silently cleaned its canonical operand")
	}
	if _, err := ToWin32("c:/repo/a/../b"); err == nil {
		t.Fatal("ToWin32 silently cleaned its canonical operand")
	}
	if _, err := ToWSL("c:/repo/a/../b", WSLOptions{}); err == nil {
		t.Fatal("ToWSL silently cleaned its canonical operand")
	}
}

func FuzzNativePOSIXIdempotent(f *testing.F) {
	for _, raw := range []string{`/repo/a\b`, "/C:/repo", "C:/../repo", "C:foo", "file:///C:/repo", "///repo", "x/../C:foo", `\repo`} {
		f.Add(raw)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		opts := Options{SourceHost: HostPOSIX}
		first, err := Normalize(raw, opts)
		if err != nil {
			return
		}
		second, err := Normalize(string(first), opts)
		if err != nil || second != first {
			t.Fatalf("native POSIX not idempotent: %q -> %q -> %q, %v", raw, first, second, err)
		}
		canonical, err := Normalize(string(first), Options{SourceHost: HostCanonical})
		if err != nil || canonical != first {
			t.Fatalf("native output cannot round trip as canonical: %q -> %q, %v", first, canonical, err)
		}
	})
}

func FuzzCanonicalIdempotent(f *testing.F) {
	for _, raw := range []string{`/repo/a\b`, "./C:/repo", "//?/C:/a/../..", "//?/UNC/server/share/a/../..", "file://repo/a", "//server/share/repo"} {
		f.Add(raw)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		opts := Options{SourceHost: HostCanonical}
		first, err := Normalize(raw, opts)
		if err != nil {
			return
		}
		second, err := Normalize(string(first), opts)
		if err != nil || second != first {
			t.Fatalf("canonical not idempotent: %q -> %q -> %q, %v", raw, first, second, err)
		}
	})
}
