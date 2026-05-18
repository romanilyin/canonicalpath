package canonicalfs

// Remove removes a file or empty directory relative to the root.
func (r *Root) Remove(rel string) error {
	clean, err := cleanRelative(rel)
	if err != nil {
		return err
	}
	root, err := r.rootHandle()
	if err != nil {
		return err
	}
	return root.Remove(clean)
}
