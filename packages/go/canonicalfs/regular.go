package canonicalfs

import (
	"errors"
	"os"
)

// Open without truncation, then check the opened descriptor before any I/O.
// O_NONBLOCK ensures a FIFO cannot strand a worker before its type is known.
func (r *Root) openRegularFile(rel string, flags int, mode os.FileMode) (*os.File, error) {
	if !regularFilesSupported {
		return nil, ErrUnsupportedOperation
	}
	clean, err := cleanRelative(rel)
	if err != nil {
		return nil, err
	}
	handle, err := r.rootHandle()
	if err != nil {
		return nil, err
	}
	var before os.FileInfo
	if r.rejectFileLinks {
		before, err = handle.Lstat(clean)
		if err == nil && !before.Mode().IsRegular() {
			return nil, newError(ErrSymlinkEscape, "scoped file must be a regular file without links")
		}
		if err != nil && (!errors.Is(err, os.ErrNotExist) || flags&os.O_CREATE == 0) {
			return nil, err
		}
		if before == nil {
			// A missing leaf must be created exclusively; never follow a raced link.
			flags |= os.O_EXCL
		}
	}
	f, err := handle.OpenFile(clean, (flags&^os.O_TRUNC)|regularOpenFlags, mode)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err == nil && !info.Mode().IsRegular() {
		err = ErrUnsupportedOperation
	}
	if err == nil && before != nil && !os.SameFile(before, info) {
		err = newError(ErrRaceDetected, "scoped file changed during opening")
	}
	if err == nil && flags&os.O_TRUNC != 0 {
		err = f.Truncate(0)
	}
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}
