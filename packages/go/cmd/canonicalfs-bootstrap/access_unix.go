//go:build unix

package main

import (
	"errors"
	"os"
	"syscall"
)

func makePrivateDirectory(parent *os.Root, name string) error {
	return parent.Mkdir(name, 0700)
}

func newPrivateFile(parent *os.Root, name string) (*os.File, error) {
	return parent.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
}

func validateAccess(_ *os.File, info os.FileInfo, private bool) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	uid := os.Geteuid()
	if !ok || stat == nil || uid < 0 {
		return errors.New("cannot determine bootstrap path ownership")
	}
	owned := uint64(stat.Uid) == uint64(uid)
	if private {
		if !owned || info.Mode().Perm()&0077 != 0 {
			return errors.New("bootstrap parent and files must be owned by the current user and inaccessible to other users")
		}
		return nil
	}
	// Ancestors must not permit a different user to replace the trusted parent.
	// Root/current-user owned sticky directories such as /tmp are allowed.
	if (!owned && stat.Uid != 0) || (info.Mode().Perm()&0022 != 0 && info.Mode()&os.ModeSticky == 0) {
		return errors.New("bootstrap ancestors must be owned by root/current user and protected from other-user replacement")
	}
	return nil
}
