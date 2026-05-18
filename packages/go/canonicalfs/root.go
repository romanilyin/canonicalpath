package canonicalfs

import "os"

// Root holds a root-bound filesystem handle.
type Root struct {
	root *os.Root
}

// OpenOptions controls root-bound OpenFile and WriteFile behavior.
type OpenOptions struct {
	Create    bool
	Truncate  bool
	Append    bool
	Exclusive bool
	Mode      uint32
}

// OpenRoot opens hostRoot as a root-bound filesystem handle.
func OpenRoot(hostRoot string) (*Root, error) {
	if hostRoot == "" {
		return nil, newError(ErrOutsideRoot, "root path is empty")
	}
	if containsNUL(hostRoot) {
		return nil, newError(ErrNULByte, "root contains NUL")
	}
	root, err := os.OpenRoot(hostRoot)
	if err != nil {
		return nil, err
	}
	return &Root{root: root}, nil
}

// Close closes the underlying root handle.
func (r *Root) Close() error {
	if r == nil || r.root == nil {
		return nil
	}
	return r.root.Close()
}

// Open opens a file relative to the root.
func (r *Root) Open(rel string) (*os.File, error) {
	clean, err := cleanRelative(rel)
	if err != nil {
		return nil, err
	}
	root, err := r.rootHandle()
	if err != nil {
		return nil, err
	}
	return root.Open(clean)
}

// OpenFile opens a file relative to the root with explicit options.
func (r *Root) OpenFile(rel string, opts OpenOptions) (*os.File, error) {
	clean, err := cleanRelative(rel)
	if err != nil {
		return nil, err
	}
	root, err := r.rootHandle()
	if err != nil {
		return nil, err
	}
	return root.OpenFile(clean, openFlags(opts), openMode(opts))
}

func (r *Root) rootHandle() (*os.Root, error) {
	if r == nil || r.root == nil {
		return nil, os.ErrInvalid
	}
	return r.root, nil
}

func openFlags(opts OpenOptions) int {
	flag := os.O_RDONLY
	if opts.Create || opts.Truncate || opts.Append || opts.Exclusive {
		flag = os.O_RDWR
	}
	if opts.Create || opts.Exclusive {
		flag |= os.O_CREATE
	}
	if opts.Truncate {
		flag |= os.O_TRUNC
	}
	if opts.Append {
		flag |= os.O_APPEND
	}
	if opts.Exclusive {
		flag |= os.O_EXCL
	}
	return flag
}

func openMode(opts OpenOptions) os.FileMode {
	if opts.Mode == 0 {
		return 0o644
	}
	return os.FileMode(opts.Mode)
}

func containsNUL(value string) bool {
	for _, r := range value {
		if r == '\x00' {
			return true
		}
	}
	return false
}
