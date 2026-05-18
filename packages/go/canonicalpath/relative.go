package canonicalpath

import "strings"

// Relative returns target as a relative path inside root.
func Relative(root Path, target Path) (RelativePath, error) {
	rootPrefix, rootParts, err := canonicalParts(string(root))
	if err != nil {
		return "", err
	}
	targetPrefix, targetParts, err := canonicalParts(string(target))
	if err != nil {
		return "", err
	}
	if rootPrefix != targetPrefix || len(targetParts) < len(rootParts) {
		return "", newError(ErrOutsideRoot, "target is outside root")
	}
	for idx := range rootParts {
		if targetParts[idx] != rootParts[idx] {
			return "", newError(ErrOutsideRoot, "target is outside root")
		}
	}
	if len(targetParts) == len(rootParts) {
		return ".", nil
	}
	return RelativePath(strings.Join(targetParts[len(rootParts):], "/")), nil
}

// Join combines a canonical root and canonical relative path.
func Join(root Path, rel RelativePath) (Path, error) {
	cleanRel, err := NormalizeRelative(string(rel))
	if err != nil {
		return "", err
	}
	rootValue := string(root)
	if strings.ContainsRune(rootValue, '\x00') {
		return "", newError(ErrNULByte, "root contains NUL")
	}
	if cleanRel == "." {
		return root, nil
	}
	if rootValue == "/" || strings.HasSuffix(rootValue, "/") {
		return Path(rootValue + string(cleanRel)), nil
	}
	return Path(rootValue + "/" + string(cleanRel)), nil
}

// NormalizeRelative validates and cleans a relative path without allowing root escape.
func NormalizeRelative(raw string) (RelativePath, error) {
	if raw == "" {
		return "", newError(ErrEmptyPath, "relative path is empty")
	}
	if raw == "." {
		return ".", nil
	}
	if strings.ContainsRune(raw, '\x00') {
		return "", newError(ErrNULByte, "relative path contains NUL")
	}
	if isAbsolutePathLike(raw) {
		return "", newError(ErrAbsolutePath, "relative path must not be absolute")
	}
	if isDriveRelative(raw) {
		return "", newError(ErrDriveRelativePath, "drive-relative path is not allowed")
	}
	if strings.Contains(raw, "\\") {
		return "", newError(ErrInvalidPath, "relative path must use slash separators")
	}

	parts := make([]string, 0)
	for _, part := range strings.Split(raw, "/") {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(parts) == 0 {
				return "", newError(ErrOutsideRoot, "relative path escapes root")
			}
			parts = parts[:len(parts)-1]
		default:
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return "", newError(ErrEmptyPath, "relative path is empty after cleaning")
	}
	return RelativePath(strings.Join(parts, "/")), nil
}

func canonicalParts(value string) (string, []string, error) {
	if strings.ContainsRune(value, '\x00') {
		return "", nil, newError(ErrNULByte, "path contains NUL")
	}
	prefix, rest, err := splitRoot(value)
	if err != nil {
		return "", nil, err
	}
	if prefix == "" {
		return "", nil, newError(ErrInvalidPath, "path must be canonical absolute")
	}
	parts := make([]string, 0)
	for _, part := range strings.Split(rest, "/") {
		if part == "" {
			continue
		}
		if part == "." || part == ".." {
			return "", nil, newError(ErrInvalidPath, "path is not lexically cleaned")
		}
		parts = append(parts, part)
	}
	return prefix, parts, nil
}

func isAbsolutePathLike(value string) bool {
	return strings.HasPrefix(value, "/") || strings.HasPrefix(value, "\\\\") || hasDriveRoot(strings.ReplaceAll(value, "\\", "/"))
}
