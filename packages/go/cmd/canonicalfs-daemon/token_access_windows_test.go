package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func tokenUserSID(t *testing.T) string {
	t.Helper()
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	return user.User.Sid.String()
}

func setTestDACL(t *testing.T, file, sddl string) {
	t.Helper()
	sd, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(file, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
}

func protectTestTokenFile(t *testing.T, file string) {
	t.Helper()
	setTestDACL(t, file, "D:P(A;;FA;;;"+tokenUserSID(t)+")(A;;FA;;;SY)(A;;FA;;;BA)")
}

func TestWindowsTokenACL(t *testing.T) {
	file := filepath.Join(t.TempDir(), "token")
	token := strings.Repeat("a", 64)
	if err := os.WriteFile(file, []byte(token), 0600); err != nil {
		t.Fatal(err)
	}
	private := "D:P(A;;FA;;;" + tokenUserSID(t) + ")(A;;FA;;;SY)(A;;FA;;;BA)"
	for _, suffix := range []string{"", "(A;;FR;;;WD)", "(A;;FW;;;BU)", "(A;;WD;;;AU)"} {
		setTestDACL(t, file, private+suffix)
		_, err := readToken(file)
		if (err == nil) != (suffix == "") {
			t.Fatalf("incorrect ACL decision for %q: %v", suffix, err)
		}
	}
	if err := windows.SetNamedSecurityInfo(file, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := readToken(file); err == nil {
		t.Fatal("NULL DACL accepted")
	}
	protectTestTokenFile(t, file)
}
