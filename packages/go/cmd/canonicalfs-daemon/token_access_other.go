//go:build !windows

package main

import (
	"errors"
	"os"
)

func validateTokenFileAccess(_ *os.File, info os.FileInfo) error {
	if info.Mode().Perm()&0o077 != 0 {
		return errors.New("token file must only be accessible to its owner")
	}
	return validateTokenFileOwner(info)
}
