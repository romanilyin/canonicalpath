package canonicalfs

import (
	"io"
)

// ReadFile reads a file relative to the root, optionally enforcing maxBytes.
func (r *Root) ReadFile(rel string, maxBytes int64) ([]byte, error) {
	f, err := r.Open(rel)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	if maxBytes > 0 {
		data, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > maxBytes {
			return nil, newError(ErrReadLimitExceeded, "file exceeds maxBytes")
		}
		return data, nil
	}
	return io.ReadAll(f)
}
