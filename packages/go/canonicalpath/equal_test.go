package canonicalpath

import "testing"

func TestIsEqualNormalizesInputs(t *testing.T) {
	equal, err := IsEqual("/home//alice/./repo", "/home/alice/repo", Options{SourceHost: HostPOSIX, TargetProfile: TargetPOSIX})
	if err != nil {
		t.Fatal(err)
	}
	if !equal {
		t.Fatal("expected normalized paths to compare equal")
	}
}

func TestIsEqualDetectsDifferentPaths(t *testing.T) {
	equal, err := IsEqual("c:/repo", "c:/repo-evil", Options{SourceHost: HostWin32, TargetProfile: TargetWin32Drive})
	if err != nil {
		t.Fatal(err)
	}
	if equal {
		t.Fatal("expected different canonical paths to compare unequal")
	}
}

func TestIsEqualReturnsNormalizeError(t *testing.T) {
	_, err := IsEqual("", "/tmp/repo", Options{SourceHost: HostPOSIX, TargetProfile: TargetPOSIX})
	if got := errorCode(err); got != string(ErrEmptyPath) {
		t.Fatalf("expected %s, got %s (%v)", ErrEmptyPath, got, err)
	}
}
