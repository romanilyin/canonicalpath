package canonicalpath

// IsEqual normalizes two raw paths with the same options and compares them.
func IsEqual(left string, right string, opts Options) (bool, error) {
	leftPath, err := Normalize(left, opts)
	if err != nil {
		return false, err
	}
	rightPath, err := Normalize(right, opts)
	if err != nil {
		return false, err
	}
	return leftPath == rightPath, nil
}
