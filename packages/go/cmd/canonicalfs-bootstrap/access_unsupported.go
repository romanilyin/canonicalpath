//go:build !unix && !windows

package main

import (
	"errors"
	"os"
)

var errUnsupportedAccess = errors.New("private bootstrap access validation is unavailable on this platform")

func makePrivateDirectory(_ *os.Root, _ string) error        { return errUnsupportedAccess }
func newPrivateFile(_ *os.Root, _ string) (*os.File, error)  { return nil, errUnsupportedAccess }
func validateAccess(_ *os.File, _ os.FileInfo, _ bool) error { return errUnsupportedAccess }
