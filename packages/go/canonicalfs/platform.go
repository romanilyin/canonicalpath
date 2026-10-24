package canonicalfs

// requireSupportedPlatform is checked before filesystem access or caller-owned
// callbacks. A path-based os.Root is not a substitute for root confinement.
func requireSupportedPlatform() error {
	if !rootConfinementSupported {
		return ErrUnsupportedOperation
	}
	return nil
}
