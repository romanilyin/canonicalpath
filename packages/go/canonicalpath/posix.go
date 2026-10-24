package canonicalpath

// ToPOSIX serializes a canonical POSIX or relative path without reinterpreting
// literal component data or removing a relative drive marker.
func ToPOSIX(path Path) (string, error) {
	value := string(path)
	prefix, _, err := parseCleanCanonical(value)
	if err != nil {
		return "", err
	}
	if isWindowsRoot(prefix) {
		return "", newError(ErrInvalidPath, "Windows roots require an explicit host mapping")
	}
	return value, nil
}
