//go:build !unix && !windows

package main

import (
	"errors"
	"os"
)

func validateTokenFileOwner(_ os.FileInfo) error {
	return errors.New("token file ownership validation is unavailable on this platform")
}
