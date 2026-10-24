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
	return RelativePath(markRelative(strings.Join(targetParts[len(rootParts):], "/"))), nil
}

// Join combines canonical paths without raw host-path interpretation.
func Join(root Path, rel RelativePath) (Path, error) {
	rootValue := string(root)
	prefix, rootRest, err := parseCleanCanonical(rootValue)
	if err != nil {
		return "", err
	}
	if isWindowsRoot(prefix) && strings.ContainsRune(string(rel), '\\') {
		return "", newError(ErrInvalidPath, "Windows canonical components cannot contain a literal backslash")
	}
	cleanRel, err := normalizeCanonicalRelative(string(rel))
	if err != nil {
		return "", err
	}
	if cleanRel == "." {
		return root, nil
	}
	cleanRel = withoutRelativeMarker(cleanRel)
	if prefix == "" {
		if rootRest == "" {
			return Path(markRelative(cleanRel)), nil
		}
		return Path(markRelative(rootRest + "/" + cleanRel)), nil
	}
	if strings.HasSuffix(rootValue, "/") {
		return Path(rootValue + cleanRel), nil
	}
	return Path(rootValue + "/" + cleanRel), nil
}

// Canonical relative components may contain literal backslashes. Keep this
// separate from NormalizeRelative, which validates untrusted filesystem input.
func normalizeCanonicalRelative(raw string) (string, error) {
	if raw == "" {
		return "", newError(ErrEmptyPath, "relative path is empty")
	}
	if strings.ContainsRune(raw, '\x00') {
		return "", newError(ErrNULByte, "relative path contains NUL")
	}
	if strings.HasPrefix(raw, "/") || hasDriveRoot(raw) {
		return "", newError(ErrAbsolutePath, "relative path must not be absolute")
	}
	if isDriveRelative(raw) {
		return "", newError(ErrDriveRelativePath, "drive-relative path is not allowed")
	}
	if raw == "." {
		return ".", nil
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
		return ".", nil
	}
	return markRelative(strings.Join(parts, "/")), nil
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
	prefix, rest, err := parseCleanCanonical(value)
	if err != nil {
		return "", nil, err
	}
	if prefix == "" {
		return "", nil, newError(ErrInvalidPath, "path must be canonical absolute")
	}
	if rest == "" {
		return prefix, nil, nil
	}
	return prefix, strings.Split(rest, "/"), nil
}

func isAbsolutePathLike(value string) bool {
	return strings.HasPrefix(value, "/") || strings.HasPrefix(value, "\\\\") || hasDriveRoot(strings.ReplaceAll(value, "\\", "/"))
}
