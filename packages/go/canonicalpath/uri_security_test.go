package canonicalpath

import "testing"

func TestDirectURIParserRejectsDecodedNUL(t *testing.T) {
	opts := Options{URI: URIOptions{AllowFileURI: true, AllowVSCodeFileURI: true}}
	for _, uri := range []string{"file:///tmp/a%00b", "file://host%00/share/a", "vscode-file://app%00/tmp/a"} {
		if _, err := ParseFileURI(uri, opts); Code(err) != ErrNULByte {
			t.Fatalf("%s: %v", uri, err)
		}
	}
}
