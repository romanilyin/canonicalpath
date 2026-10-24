package canonicalpath

import "strings"

// splitRoot parses canonical grammar only. It never infers a host path from
// a backslash, URI-looking component, or POSIX drive-looking component.
func splitRoot(value string) (prefix string, rest string, err error) {
	switch {
	case strings.HasPrefix(value, "//?/"):
		tail := value[4:]
		if hasDriveRoot(tail) {
			prefix, rest = value[:7], value[7:]
		} else if strings.HasPrefix(tail, "UNC/") {
			prefix, rest, err = splitUNCRoot(value, "//?/UNC/")
		} else {
			err = newError(ErrInvalidPath, "extended root requires an absolute drive or UNC server and share")
		}
	case hasDriveRoot(value):
		prefix, rest = value[:3], value[3:]
	case strings.HasPrefix(value, "//"):
		prefix, rest, err = splitUNCRoot(value, "//")
	case strings.HasPrefix(value, "/"):
		prefix, rest = "/", value[1:]
	case isDriveRelative(value):
		err = newError(ErrDriveRelativePath, "Windows drive-relative paths are not canonical")
	default:
		rest = value
	}
	if err == nil && isWindowsRoot(prefix) && strings.ContainsRune(value, '\\') {
		err = newError(ErrInvalidPath, "Windows canonical components cannot contain a literal backslash")
	}
	return
}

func splitUNCRoot(value, leader string) (string, string, error) {
	parts := strings.SplitN(value[len(leader):], "/", 3)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" ||
		parts[0] == "." || parts[0] == ".." || parts[1] == "." || parts[1] == ".." {
		return "", "", newError(ErrInvalidPath, "UNC root requires non-dot server and share components")
	}
	rest := ""
	if len(parts) == 3 {
		rest = parts[2]
	}
	return leader + parts[0] + "/" + parts[1], rest, nil
}

func isWindowsRoot(prefix string) bool {
	return prefix != "" && prefix != "/"
}

func isDriveRoot(prefix string) bool {
	return hasDriveRoot(prefix) || (strings.HasPrefix(prefix, "//?/") && hasDriveRoot(prefix[4:]))
}

func lowercaseDrive(value string) string {
	if hasDriveRoot(value) {
		return strings.ToLower(value[:1]) + value[1:]
	}
	if strings.HasPrefix(value, "//?/") && hasDriveRoot(value[4:]) {
		return value[:4] + strings.ToLower(value[4:5]) + value[5:]
	}
	return value
}

func needsRelativeMarker(value string) bool {
	return len(value) >= 2 && isASCIILetter(value[0]) && value[1] == ':'
}

func markRelative(value string) string {
	if needsRelativeMarker(value) {
		return "./" + value
	}
	return value
}

func hasRelativeMarker(value string) bool {
	return strings.HasPrefix(value, "./") && needsRelativeMarker(value[2:])
}

func withoutRelativeMarker(value string) string {
	if hasRelativeMarker(value) {
		return value[2:]
	}
	return value
}

func prepareNativePOSIX(value string) (string, error) {
	leading := len(value) - len(strings.TrimLeft(value, "/"))
	if leading == 2 {
		return "", newError(ErrInvalidPath, "native POSIX paths with exactly two leading slashes are unsupported")
	}
	if leading > 2 {
		value = "/" + value[leading:]
	}
	return markRelative(value), nil
}

func cleanNativePOSIX(value string) (string, error) {
	prepared, err := prepareNativePOSIX(value)
	if err != nil {
		return "", err
	}
	return cleanCanonical(prepared)
}

func cleanCanonical(value string) (string, error) {
	if value == "" {
		return "", newError(ErrEmptyPath, "path is empty")
	}
	if strings.ContainsRune(value, '\x00') {
		return "", newError(ErrNULByte, "path contains NUL")
	}
	prefix, rest, err := splitRoot(value)
	if err != nil {
		return "", err
	}
	prefix = lowercaseDrive(prefix)
	parts := make([]string, 0)
	for _, part := range strings.Split(rest, "/") {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(parts) > 0 {
				parts = parts[:len(parts)-1]
			} else if prefix == "" {
				return "", newError(ErrInvalidPath, "relative path escapes above its root")
			}
		default:
			parts = append(parts, part)
		}
	}
	joined := strings.Join(parts, "/")
	if prefix == "" {
		if joined == "" {
			return ".", nil
		}
		return markRelative(joined), nil
	}
	if joined == "" {
		return prefix, nil
	}
	if strings.HasSuffix(prefix, "/") {
		return prefix + joined, nil
	}
	return prefix + "/" + joined, nil
}

// parseCleanCanonical validates canonical operands without applying raw input
// rewrites. Uppercase drive letters remain accepted by host serializers.
func parseCleanCanonical(value string) (string, string, error) {
	cleaned, err := cleanCanonical(value)
	if err != nil {
		return "", "", err
	}
	if cleaned != lowercaseDrive(value) {
		return "", "", newError(ErrInvalidPath, "path is not lexically cleaned canonical input")
	}
	prefix, rest, err := splitRoot(value)
	if prefix == "" {
		if rest == "." {
			rest = ""
		} else {
			rest = withoutRelativeMarker(rest)
		}
	}
	return prefix, rest, err
}
