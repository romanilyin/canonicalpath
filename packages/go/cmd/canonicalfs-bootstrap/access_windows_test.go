package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func protectTestParent(t *testing.T, name string) {
	t.Helper()
	sd, err := privateDescriptor()
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(name, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
}

func TestBootstrapRejectsPublicAndNullDACLParent(t *testing.T) {
	parent := privateTestParent(t)
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	for _, dacl := range []*windows.ACL{acl, nil} {
		if err := windows.SetNamedSecurityInfo(parent, windows.SE_FILE_OBJECT,
			windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
			t.Fatal(err)
		}
		if err := run([]string{"-out-dir", filepath.Join(parent, "launch")}, &bytes.Buffer{}); err == nil {
			t.Fatal("unprotected bootstrap parent accepted")
		}
		if _, err := os.Stat(filepath.Join(parent, "launch")); !os.IsNotExist(err) {
			t.Fatal("unprotected parent rejection created output")
		}
	}
	protectTestParent(t, parent)
}

func TestBootstrapCreatesProtectedDACLs(t *testing.T) {
	directory, err := createBootstrapDirectory(filepath.Join(privateTestParent(t), "launch"))
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	for _, name := range []string{".", "empty-secret"} {
		var file *os.File
		if name == "." {
			file, err = directory.Open(name)
		} else {
			file, err = newPrivateFile(directory, name)
		}
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		sd, err := windows.GetSecurityInfo(windows.Handle(file.Fd()), windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
		if err != nil {
			t.Fatal(err)
		}
		control, _, err := sd.Control()
		if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
			t.Fatalf("new %s DACL is not protected against inherited grants: %v", name, err)
		}
	}
}
