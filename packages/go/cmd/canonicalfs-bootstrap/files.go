package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func createBootstrapDirectory(outDir string) (*os.Root, error) {
	absolute, err := filepath.Abs(outDir)
	if err != nil {
		return nil, err
	}
	volume := filepath.VolumeName(absolute)
	// This bootstrap is local. UNC shares/device namespaces are not accepted.
	if len(volume) > 2 {
		return nil, errors.New("bootstrap directory must be on a local filesystem")
	}
	anchor := volume + string(filepath.Separator)
	relative, err := filepath.Rel(anchor, absolute)
	if err != nil || relative == "." || !filepath.IsLocal(relative) {
		return nil, errors.New("bootstrap directory must be a new child of a private parent")
	}
	parts := strings.Split(relative, string(filepath.Separator))
	parent, err := os.OpenRoot(anchor)
	if err != nil {
		return nil, err
	}
	defer func() { _ = parent.Close() }()
	for i, part := range parts[:len(parts)-1] {
		child, err := openPinnedDirectory(parent, part)
		if err != nil {
			return nil, err
		}
		_ = parent.Close()
		parent = child
		if err := validateDirectory(parent, i == len(parts)-2); err != nil {
			return nil, err
		}
	}
	// A filesystem root itself is never accepted as the private parent.
	if len(parts) == 1 {
		return nil, errors.New("bootstrap parent must be a private directory below the filesystem root")
	}
	name := parts[len(parts)-1]
	if err := makePrivateDirectory(parent, name); err != nil {
		return nil, fmt.Errorf("cannot create a new private bootstrap directory (existing paths are refused): %w", err)
	}
	directory, err := openPinnedDirectory(parent, name)
	if err != nil {
		return nil, err
	}
	if err := validateDirectory(directory, true); err != nil {
		_ = directory.Close()
		return nil, err
	}
	return directory, nil
}

func openPinnedDirectory(parent *os.Root, name string) (*os.Root, error) {
	info, err := parent.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
		return nil, errors.New("bootstrap path must not contain links or special files")
	}
	child, err := parent.OpenRoot(name)
	if err != nil {
		return nil, err
	}
	opened, err := child.Stat(".")
	if err != nil || !os.SameFile(info, opened) {
		_ = child.Close()
		return nil, errors.New("bootstrap path changed during opening")
	}
	return child, nil
}

func validateDirectory(root *os.Root, private bool) error {
	file, err := root.Open(".")
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.IsDir() {
		return errors.New("bootstrap parent is not a directory")
	}
	return validateAccess(file, info, private)
}

func writePrivateFile(directory *os.Root, name string, data []byte) (resultErr error) {
	file, err := newPrivateFile(directory, name)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, file.Close()) }()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("bootstrap output is not a regular file")
	}
	// Check the opened descriptor before the first secret byte is written.
	if err := validateAccess(file, info, true); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	return file.Sync()
}
