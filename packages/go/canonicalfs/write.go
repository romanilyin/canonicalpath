package canonicalfs

// WriteFile writes data to a file relative to the root.
func (r *Root) WriteFile(rel string, data []byte, opts OpenOptions) error {
	if !opts.Append {
		opts.Truncate = true
	}
	opts.Create = true
	f, err := r.OpenFile(rel, opts)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}
