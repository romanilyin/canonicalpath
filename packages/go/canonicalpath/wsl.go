package canonicalpath

import "strings"

// WSLOptions controls mapping between WSL mount paths and Windows drives.
type WSLOptions struct {
	Enabled   bool   `json:"enabled"`
	MountRoot string `json:"mountRoot"`
}

// ToWSL serializes a canonical Windows drive path as a WSL mount path.
func ToWSL(path Path, opts WSLOptions) (string, error) {
	value := string(path)
	if strings.ContainsRune(value, '\x00') {
		return "", newError(ErrNULByte, "path contains NUL")
	}
	if !hasDriveRoot(value) {
		return value, nil
	}
	mountRoot := opts.MountRoot
	if mountRoot == "" {
		mountRoot = "/mnt"
	}
	mountRoot = strings.TrimRight(mountRoot, "/")
	drive := strings.ToLower(value[:1])
	rest := value[3:]
	if rest == "" {
		return mountRoot + "/" + drive, nil
	}
	return mountRoot + "/" + drive + "/" + rest, nil
}

func mapWSLDrive(value string, opts WSLOptions) (string, bool) {
	if !opts.Enabled {
		return "", false
	}
	mountRoot := opts.MountRoot
	if mountRoot == "" {
		mountRoot = "/mnt"
	}
	mountRoot = strings.TrimRight(mountRoot, "/")
	prefix := mountRoot + "/"
	if !strings.HasPrefix(value, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(value, prefix)
	if len(rest) < 1 || !isASCIILetter(rest[0]) {
		return "", false
	}
	if len(rest) > 1 && rest[1] != '/' {
		return "", false
	}
	drive := strings.ToLower(rest[:1])
	if len(rest) == 1 {
		return drive + ":/", true
	}
	return drive + ":/" + rest[2:], true
}
