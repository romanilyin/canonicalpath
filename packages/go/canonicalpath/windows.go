package canonicalpath

import "strings"

// ToWin32 serializes a representable canonical path using Windows separators.
func ToWin32(path Path) (string, error) {
	value := string(path)
	prefix, _, err := parseCleanCanonical(value)
	if err != nil {
		return "", err
	}
	if prefix == "/" || strings.ContainsRune(value, '\\') || hasRelativeMarker(value) {
		return "", newError(ErrInvalidPath, "canonical path has no lossless Windows representation")
	}
	if hasDriveRoot(value) {
		value = strings.ToUpper(value[:1]) + value[1:]
	} else if strings.HasPrefix(value, "//?/") && hasDriveRoot(value[4:]) {
		value = value[:4] + strings.ToUpper(value[4:5]) + value[5:]
	}
	return strings.ReplaceAll(value, "/", "\\"), nil
}

func unwrapWindowsExtendedPrefix(value string) string {
	if strings.HasPrefix(value, "//?/UNC/") {
		return "//" + value[8:]
	}
	if strings.HasPrefix(value, "//?/") {
		return value[4:]
	}
	return value
}

func hasWindowsADS(value string) bool {
	_, rest, err := splitRoot(value)
	return err == nil && strings.ContainsRune(rest, ':')
}

func hasReservedDeviceName(value string) bool {
	_, rest, err := splitRoot(value)
	if err != nil {
		return false
	}
	for _, part := range strings.Split(rest, "/") {
		if part == "" || part == "." || part == ".." {
			continue
		}
		base := part
		if idx := strings.IndexAny(base, ".:"); idx >= 0 {
			base = base[:idx]
		}
		if isReservedDeviceBase(strings.ToUpper(base)) {
			return true
		}
	}
	return false
}

func isReservedDeviceBase(base string) bool {
	switch base {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) {
		return base[3] >= '1' && base[3] <= '9'
	}
	return false
}
