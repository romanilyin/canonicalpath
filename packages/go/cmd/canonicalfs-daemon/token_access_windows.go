package main

import (
	"errors"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Inspect the descriptor on the already-open file, never on a separately
// resolved path. Fail closed for absent/null DACLs and unfamiliar ACE types.
func validateTokenFileAccess(file *os.File, _ os.FileInfo) error {
	invalid := errors.New("Windows token file must have a private DACL granting access only to the current user, SYSTEM or Administrators")
	sd, err := windows.GetSecurityInfo(windows.Handle(file.Fd()), windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return invalid
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil {
		return invalid
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return invalid
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return invalid
	}
	admins, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err != nil {
		return invalid
	}
	trusted := func(sid *windows.SID) bool {
		return sid.Equals(user.User.Sid) || sid.Equals(system) || sid.Equals(admins)
	}
	if !trusted(owner) {
		return invalid
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil {
		return invalid
	}
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(acl, i, &ace) != nil || ace == nil {
			return invalid
		}
		if ace.Header.AceFlags&windows.INHERIT_ONLY_ACE != 0 {
			continue
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return invalid
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !trusted(sid) && ace.Mask != 0 {
			return invalid
		}
	}
	return nil
}
