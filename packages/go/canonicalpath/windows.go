package canonicalpath

import "strings"

// ToWin32 serializes a canonical path using Windows separators.
func ToWin32(path Path) (string, error) {
	value := string(path)
	if strings.ContainsRune(value, '\x00') {
		return "", newError(ErrNULByte, "path contains NUL")
	}
	if hasDriveRoot(value) {
		drive := strings.ToUpper(value[:1])
		return drive + ":\\" + strings.ReplaceAll(value[3:], "/", "\\"), nil
	}
	if strings.HasPrefix(value, "//") {
		return "\\\\" + strings.ReplaceAll(value[2:], "/", "\\"), nil
	}
	return strings.ReplaceAll(value, "/", "\\"), nil
}

func unwrapWindowsExtendedPrefix(value string) string {
	if strings.HasPrefix(value, "\\\\?\\UNC\\") {
		return "\\\\" + strings.TrimPrefix(value, "\\\\?\\UNC\\")
	}
	if strings.HasPrefix(value, "\\\\?\\") {
		return strings.TrimPrefix(value, "\\\\?\\")
	}
	return value
}

func hasWindowsADS(value string) bool {
	start := 0
	if hasDriveRoot(value) {
		start = 3
	} else if strings.HasPrefix(value, "//") {
		parts := strings.Split(value[2:], "/")
		if len(parts) >= 2 {
			start = len("//" + parts[0] + "/" + parts[1])
		}
	}
	return strings.Contains(value[start:], ":")
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
