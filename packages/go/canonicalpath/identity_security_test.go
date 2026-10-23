package canonicalpath

import (
	"regexp"
	"strings"
	"testing"
)

func TestGitRefV2RejectsInvalidUTF8(t *testing.T) {
	for _, raw := range []string{"\x80", "\xc0\xaf", "\xed\xa0\x80", "\xf4\x90\x80\x80", "\xe2\x82", "ok\xff"} {
		if _, err := EncodeGitRef(raw); Code(err) != ErrInvalidComponent {
			t.Fatalf("raw bytes %x: expected invalid component, got %v", raw, err)
		}
	}
}

func TestGitRefV2BoundsSlugAndKeepsRawIdentity(t *testing.T) {
	prefix := strings.Repeat("a", 240)
	a, err := EncodeGitRef(prefix + "/one")
	if err != nil {
		t.Fatal(err)
	}
	b, err := EncodeGitRef(prefix + "/two")
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 149 || !regexp.MustCompile(`^v2-a{80}--[0-9a-f]{64}$`).MatchString(a) || a == b {
		t.Fatalf("bounded full-input identity contract violated: %q / %q", a, b)
	}
}
