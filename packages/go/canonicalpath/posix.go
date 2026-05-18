package canonicalpath

import "strings"

// ToPOSIX serializes a canonical POSIX or relative path for POSIX consumers.
func ToPOSIX(path Path) (string, error) {
	value := string(path)
	if strings.ContainsRune(value, '\x00') {
		return "", newError(ErrNULByte, "path contains NUL")
	}
	if hasDriveRoot(value) {
		return "", newError(ErrInvalidPath, "win32 drive paths require an explicit host mapping such as ToWSL")
	}
	if strings.Contains(value, "\\") {
		return "", newError(ErrInvalidPath, "canonical paths must use slash separators")
	}
	return value, nil
}
