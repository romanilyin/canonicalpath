package canonicalfs

import "io/fs"

// WalkFunc is called for each entry visited by Walk.
type WalkFunc func(path string, info fs.FileInfo, err error) error

// Stat returns file information for a path relative to the root.
func (r *Root) Stat(rel string) (fs.FileInfo, error) {
	clean, err := cleanRelative(rel)
	if err != nil {
		return nil, err
	}
	root, err := r.rootHandle()
	if err != nil {
		return nil, err
	}
	return root.Stat(clean)
}

// Walk traverses a tree relative to the root.
func (r *Root) Walk(rel string, fn WalkFunc) error {
	clean, err := cleanRelative(rel)
	if err != nil {
		return err
	}
	root, err := r.rootHandle()
	if err != nil {
		return err
	}
	return fs.WalkDir(root.FS(), clean, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return fn(path, nil, err)
		}
		info, err := d.Info()
		return fn(path, info, err)
	})
}
