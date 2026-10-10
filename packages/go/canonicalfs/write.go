package canonicalfs

// WriteFile writes data to a regular file relative to the root.
// The opened type is checked before truncation or writes; special files are rejected.
func (r *Root) WriteFile(rel string, data []byte, opts OpenOptions) error {
	if !opts.Append {
		opts.Truncate = true
	}
	opts.Create = true
	f, err := r.openRegularFile(rel, openFlags(opts), openMode(opts))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}
