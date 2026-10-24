package canonicalpath

import "strings"

// WSLOptions controls mapping between WSL mount paths and Windows drives.
type WSLOptions struct {
	Enabled   bool   `json:"enabled"`
	MountRoot string `json:"mountRoot"`
}

// ToWSL serializes an ordinary Windows drive path as a WSL mount path.
func ToWSL(path Path, opts WSLOptions) (string, error) {
	mountRoot, err := normalizeMountRoot(opts.MountRoot)
	if err != nil {
		return "", err
	}
	value := string(path)
	prefix, _, err := parseCleanCanonical(value)
	if err != nil {
		return "", err
	}
	if isWindowsRoot(prefix) && !hasDriveRoot(prefix) {
		return "", newError(ErrInvalidPath, "WSL mapping requires an ordinary Windows drive root")
	}
	if !hasDriveRoot(prefix) {
		return value, nil
	}
	result := strings.TrimSuffix(mountRoot, "/") + "/" + strings.ToLower(value[:1])
	if rest := value[3:]; rest != "" {
		result += "/" + rest
	}
	return result, nil
}

func normalizeMountRoot(value string) (string, error) {
	if strings.ContainsRune(value, '\x00') {
		return "", newError(ErrNULByte, "WSL mount root contains NUL")
	}
	if value == "" {
		value = "/mnt"
	}
	if !strings.HasPrefix(value, "/") {
		return "", newError(ErrInvalidPath, "WSL mount root must be an absolute native POSIX path")
	}
	return cleanNativePOSIX(value)
}

// opts.MountRoot has already passed normalizeMountRoot at the API boundary.
func mapWSLDrive(value string, opts WSLOptions) (string, bool) {
	if !opts.Enabled {
		return "", false
	}
	prefix := strings.TrimSuffix(opts.MountRoot, "/") + "/"
	if !strings.HasPrefix(value, prefix) {
		return "", false
	}
	rest := value[len(prefix):]
	if len(rest) < 1 || !isASCIILetter(rest[0]) || (len(rest) > 1 && rest[1] != '/') {
		return "", false
	}
	drive := strings.ToLower(rest[:1]) + ":/"
	if len(rest) == 1 {
		return drive, true
	}
	return drive + rest[2:], true
}
