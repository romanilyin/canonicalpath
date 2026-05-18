//go:build !go1.26

package canonicalfs

// Rename renames a path relative to the root when supported by the Go runtime.
func (r *Root) Rename(oldRel string, newRel string) error {
	if _, err := cleanRelative(oldRel); err != nil {
		return err
	}
	if _, err := cleanRelative(newRel); err != nil {
		return err
	}
	return ErrUnsupportedOperation
}
