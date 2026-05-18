//go:build go1.26

package canonicalfs

import "os"

// Rename renames a path relative to the root using os.Root.Rename.
func (r *Root) Rename(oldRel string, newRel string) error {
	oldClean, err := cleanRelative(oldRel)
	if err != nil {
		return err
	}
	newClean, err := cleanRelative(newRel)
	if err != nil {
		return err
	}
	if r == nil || r.root == nil {
		return os.ErrInvalid
	}
	return r.root.Rename(oldClean, newClean)
}
