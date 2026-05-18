package canonicalfs

import (
	"errors"
	"io/fs"
	"os"
	"strings"
)

// MkdirAll creates a directory path relative to the root.
func (r *Root) MkdirAll(rel string, mode os.FileMode) error {
	clean, err := cleanRelative(rel)
	if err != nil {
		return err
	}
	if mode == 0 {
		mode = 0o755
	}
	root, err := r.rootHandle()
	if err != nil {
		return err
	}
	if clean == "." {
		return nil
	}

	current := ""
	for _, part := range strings.Split(clean, "/") {
		if current == "" {
			current = part
		} else {
			current += "/" + part
		}
		if err := root.Mkdir(current, mode); err != nil {
			if !errors.Is(err, fs.ErrExist) {
				return err
			}
			info, statErr := root.Stat(current)
			if statErr != nil {
				return err
			}
			if !info.IsDir() {
				return err
			}
		}
	}
	return nil
}
