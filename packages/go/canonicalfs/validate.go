package canonicalfs

import (
	"path"
	"strings"
)

func cleanRelative(rel string) (string, error) {
	if strings.ContainsRune(rel, '\x00') {
		return "", newError(ErrNULByte, "path contains NUL")
	}
	if rel == "" || rel == "." {
		return ".", nil
	}
	if isAbsolutePathLike(rel) {
		return "", newError(ErrAbsolutePath, "path must be relative to root")
	}
	if isDriveRelativePathLike(rel) {
		return "", newError(ErrDriveRelativePath, "Windows drive-relative paths are not accepted in CanonicalFS relative paths")
	}
	if strings.Contains(rel, "\\") {
		return "", newError(ErrOutsideRoot, "backslash separators are not accepted in CanonicalFS relative paths")
	}

	parts := make([]string, 0)
	for _, part := range strings.Split(rel, "/") {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(parts) == 0 {
				return "", newError(ErrOutsideRoot, "path escapes root")
			}
			parts = parts[:len(parts)-1]
		default:
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return ".", nil
	}
	return path.Join(parts...), nil
}

func isAbsolutePathLike(rel string) bool {
	if strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\\\") {
		return true
	}
	return len(rel) >= 3 && isASCIILetter(rel[0]) && rel[1] == ':' && (rel[2] == '/' || rel[2] == '\\')
}

func isDriveRelativePathLike(rel string) bool {
	return len(rel) >= 2 && isASCIILetter(rel[0]) && rel[1] == ':' && (len(rel) == 2 || rel[2] != '/' && rel[2] != '\\')
}

func isASCIILetter(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}
