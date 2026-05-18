package canonicalpath

import "testing"

func FuzzNormalizeIdempotent(f *testing.F) {
	seeds := []string{
		"C:\\Users\\Alice\\Repo",
		"c:/Users/Alice/Repo/src/../README.md",
		"/home/alice/repo/src/../README.md",
		"file:///c%3A/Users/Alice/Repo",
		"file:///tmp/a%252Fb",
		"/mnt/c/Users/Alice/Repo",
		"src/./lib/../index.ts",
	}
	for _, seed := range seeds {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, raw string) {
		first, err := Normalize(raw, DefaultOptions())
		if err != nil {
			return
		}
		second, err := Normalize(string(first), DefaultOptions())
		if err != nil {
			t.Fatalf("normalizing canonical output failed: %q: %v", first, err)
		}
		if second != first {
			t.Fatalf("not idempotent: %q -> %q -> %q", raw, first, second)
		}
	})
}
