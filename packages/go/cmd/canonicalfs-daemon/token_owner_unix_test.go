//go:build unix

package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

type tokenOwnerFileInfo struct {
	os.FileInfo
	system any
}

func (info tokenOwnerFileInfo) Sys() any { return info.system }

func TestTokenFileOwnerValidation(t *testing.T) {
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte(strings.Repeat("a", 64)), 0600); err != nil {
		t.Fatal(err)
	}
	handle, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	info, err := handle.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateTokenFileAccess(handle, info); err != nil {
		t.Fatal(err)
	}

	stat := *info.Sys().(*syscall.Stat_t)
	stat.Uid ^= 1 // Always a different UID, including when the daemon runs as root.
	for _, system := range []any{&stat, nil, (*syscall.Stat_t)(nil), struct{}{}} {
		if err := validateTokenFileAccess(handle, tokenOwnerFileInfo{info, system}); err == nil {
			t.Fatalf("accepted untrusted or unknown owner: %T", system)
		}
	}
	if err := handle.Chmod(0640); err != nil {
		t.Fatal(err)
	}
	info, err = handle.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateTokenFileAccess(handle, info); err == nil {
		t.Fatal("accepted group-readable token owned by daemon user")
	}
}

func TestPrivilegedDaemonRejectsForeignOwnedTokenFile(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires root to create a foreign-owned regular file")
	}
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte(strings.Repeat("b", 64)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(file, 65534, 65534); err != nil {
		t.Fatal(err)
	}
	if _, err := readToken(file); err == nil || !strings.Contains(err.Error(), "owned by the daemon effective user") {
		t.Fatalf("foreign-owned private token not rejected: %v", err)
	}
	if err := os.Chown(file, os.Geteuid(), os.Getegid()); err != nil {
		t.Fatal(err)
	}
	if _, err := readToken(file); err != nil {
		t.Fatalf("daemon-owned private token rejected: %v", err)
	}
}
