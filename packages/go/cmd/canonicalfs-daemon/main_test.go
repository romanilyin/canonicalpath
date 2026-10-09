package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemoteListenerRequiresTLS(t *testing.T) {
	for _, address := range []string{"0.0.0.0:8765", "[::]:8765", "192.168.1.5:8765", ":8765", "evil.test:8765"} {
		if validateListener(address, "", "") == nil {
			t.Fatalf("accepted plaintext %s", address)
		}
	}
	for _, address := range []string{"127.0.0.1:8765", "[::1]:8765", "localhost:8765"} {
		if err := validateListener(address, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := validateListener("0.0.0.0:8765", "cert", "key"); err != nil {
		t.Fatal(err)
	}
	if validateListener("127.0.0.1:8765", "cert", "") == nil {
		t.Fatal("incomplete TLS accepted")
	}
}
func TestTokenSourcesRejectSamples(t *testing.T) {
	for _, token := range []string{"", "dev-token", "change-me", "test-token"} {
		t.Setenv("CANONICALFS_DAEMON_TOKEN", token)
		if _, err := readToken(""); err == nil {
			t.Fatal("sample token accepted")
		}
	}
	token := strings.Repeat("a", 64)
	t.Setenv("CANONICALFS_DAEMON_TOKEN", token)
	if got, err := readToken(""); err != nil || got != token {
		t.Fatal("valid token rejected")
	}
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte(token+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := readToken(file); err != nil || got != token {
		t.Fatal("private token file rejected")
	}
}
