package canonicalpath

import "testing"

var allocationPathSink Path
var allocationRelativeSink RelativePath
var allocationStringSink string
var allocationBoolSink bool

func TestCanonicalPathAllocationBudget(t *testing.T) {
	cases := []struct {
		name string
		max  float64
		fn   func()
	}{
		{
			name: "normalize-posix",
			max:  32,
			fn: func() {
				allocationPathSink = mustNormalizeAlloc("/repo/src/../README.md", Options{})
			},
		},
		{
			name: "normalize-win32",
			max:  32,
			fn: func() {
				allocationPathSink = mustNormalizeAlloc(`C:\Repo\src\..\README.md`, Options{SourceHost: HostWin32})
			},
		},
		{
			name: "relative",
			max:  32,
			fn: func() {
				allocationRelativeSink = mustRelativeAlloc("/repo", "/repo/src/file.txt")
			},
		},
		{
			name: "join",
			max:  32,
			fn: func() {
				allocationPathSink = mustJoinAlloc("/repo", "src/file.txt")
			},
		},
		{
			name: "to-win32",
			max:  16,
			fn: func() {
				allocationStringSink = mustStringAlloc(ToWin32("c:/Repo/src/file.txt"))
			},
		},
		{
			name: "to-wsl",
			max:  16,
			fn: func() {
				allocationStringSink = mustStringAlloc(ToWSL("c:/Repo/src/file.txt", WSLOptions{}))
			},
		},
		{
			name: "is-equal",
			max:  48,
			fn: func() {
				allocationBoolSink = mustBoolAlloc(IsEqual("/repo/./src", "/repo/src", Options{}))
			},
		},
	}

	for _, item := range cases {
		item := item
		t.Run(item.name, func(t *testing.T) {
			got := testing.AllocsPerRun(1000, item.fn)
			if got > item.max {
				t.Fatalf("expected at most %.0f allocs/run, got %.2f", item.max, got)
			}
		})
	}
}

func mustNormalizeAlloc(raw string, opts Options) Path {
	path, err := Normalize(raw, opts)
	if err != nil {
		panic(err)
	}
	return path
}

func mustRelativeAlloc(root Path, target Path) RelativePath {
	rel, err := Relative(root, target)
	if err != nil {
		panic(err)
	}
	return rel
}

func mustJoinAlloc(root Path, rel RelativePath) Path {
	path, err := Join(root, rel)
	if err != nil {
		panic(err)
	}
	return path
}

func mustStringAlloc(value string, err error) string {
	if err != nil {
		panic(err)
	}
	return value
}

func mustBoolAlloc(value bool, err error) bool {
	if err != nil {
		panic(err)
	}
	return value
}
