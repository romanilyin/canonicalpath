//go:build unix

package main

import (
	"errors"
	"os"
	"syscall"
)

func validateTokenFileOwner(info os.FileInfo) error {
	// info comes from Stat on the same descriptor that readToken subsequently reads.
	stat, ok := info.Sys().(*syscall.Stat_t)
	uid := os.Geteuid()
	if !ok || stat == nil || uid < 0 {
		return errors.New("cannot determine token file owner")
	}
	if uint64(stat.Uid) != uint64(uid) {
		return errors.New("token file must be owned by the daemon effective user")
	}
	return nil
}
