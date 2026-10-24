//go:build go1.26

package canonicalfs

// Rename renames a path relative to the root using os.Root.Rename.
func (r *Root) Rename(oldRel string, newRel string) error {
	if err := requireSupportedPlatform(); err != nil {
		return err
	}
	oldClean, err := cleanRelative(oldRel)
	if err != nil {
		return err
	}
	newClean, err := cleanRelative(newRel)
	if err != nil {
		return err
	}
	root, err := r.rootHandle()
	if err != nil {
		return err
	}
	return root.Rename(oldClean, newClean)
}
